import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle, parseJson } from "@/lib/http";
import { BudgetError } from "@/lib/ai/guard";
import { writeAccount, writeToday, writerOn } from "@/lib/assistants/writer";

export const runtime = "nodejs";

// A page found its written text out of date (DECISIONS #106): start the
// Writer on it in the background, when the Writer is on. Starting is all this
// does; it never waits, and it writes nothing itself.
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requireUser(req);
    const body = await parseJson<{ place?: string; id?: string }>(req, 512);
    if (!writerOn()) return NextResponse.json({ started: false, reason: "off" });
    try {
      const run = body.place === "today" ? writeToday(user.id) : body.place === "account" && body.id ? writeAccount(body.id, user.id) : null;
      return NextResponse.json({ started: !!run });
    } catch (e) {
      if (e instanceof BudgetError) return NextResponse.json({ started: false, reason: e.message });
      throw e;
    }
  });
}
