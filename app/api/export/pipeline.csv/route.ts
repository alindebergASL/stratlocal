import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { csvFilename, csvResponse } from "@/lib/csv";
import { pipelineSheet, sheetToCsv } from "@/lib/queries/export";
import type { DealStatusFilter } from "@/lib/queries/accounts";
import { todayISO } from "@/lib/clock";
import { parseOwnerScope } from "@/lib/queries/owner";

export const runtime = "nodejs";

const STATUSES: DealStatusFilter[] = ["open", "won", "lost", "closed", "all"];

// The pipeline, as a spreadsheet.
//
// Same query parameters as /pipeline, so the link on that page exports what
// you are looking at rather than everything. "Send me your Q3 pipeline" had no
// answer in this app except a screenshot or a print of one account at a time.
export async function GET(req: NextRequest) {
  return handle(async () => {
    // Not requirePageUser(): that redirects, and a redirect thrown inside
    // handle() becomes a 500 rather than a login page.
    const user = requireUser(req);
    const p = req.nextUrl.searchParams;
    // Number(null) is 0, which fails the range check below, so an absent
    // stage is correctly "no filter" rather than stage zero.
    const stage = Number(p.get("stage"));
    const status = p.get("status");
    const sheet = pipelineSheet({
      stage: stage >= 1 && stage <= 6 ? stage : undefined,
      owner: p.get("owner") || undefined,
      accountId: p.get("account") || undefined,
      fq: p.get("fq") || undefined,
      // Validated by the same list the page offers, so an invented value
      // exports the default rather than everything.
      status: STATUSES.includes(status as DealStatusFilter) ? (status as DealStatusFilter) : undefined,
      // Whose accounts, resolved against whoever is holding the cookie — so
      // "mine" in the export means the same thing it meant on the page that
      // linked to it. An unrecognised value falls back to everything, the
      // same way an invented status does.
      scope: parseOwnerScope(p.get("who") ?? undefined, user.id),
    });
    // Everything is read synchronously above, so nothing can fail once the
    // body is being written — which matters because handle()'s error path
    // returns JSON, and JSON arriving under a filename ending in .csv is a
    // confusing way to find out something went wrong.
    return csvResponse(sheetToCsv(sheet), csvFilename(["pipeline", status, p.get("fq"), todayISO()]));
  });
}
