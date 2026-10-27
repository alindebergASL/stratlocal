import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { csvFilename, csvResponse } from "@/lib/csv";
import { getAccount } from "@/lib/queries/accounts";
import { accountContactsSheet, accountDealsSheet, followUpsSheet, sheetToCsv, type Sheet } from "@/lib/queries/export";
import { todayISO } from "@/lib/clock";

export const runtime = "nodejs";

// One account, as three spreadsheets.
//
// Deliberately not one file with three tables in it: a CSV holds one table,
// and a spreadsheet that opens with three headers stacked in one column is
// worse than three downloads.
const SHEETS: Record<string, (accountId: string) => Sheet> = {
  deals: (id) => accountDealsSheet(id),
  contacts: (id) => accountContactsSheet(id),
  "follow-ups": (id) => followUpsSheet(id),
};

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; what: string }> }) {
  return handle(async () => {
    requireUser(req);
    const { id, what } = await ctx.params;
    // Object.hasOwn, not `in`: `in` walks the prototype, so ?what=toString
    // would pass the guard and then call a function. The same hole was found
    // on /search last phase.
    if (!Object.hasOwn(SHEETS, what)) {
      return NextResponse.json({ error: `Nothing to export called "${what}"` }, { status: 404 });
    }
    const account = getAccount(id);
    if (!account) return NextResponse.json({ error: "account not found" }, { status: 404 });
    return csvResponse(sheetToCsv(SHEETS[what]!(id)), csvFilename([account.name, what, todayISO()]));
  });
}
