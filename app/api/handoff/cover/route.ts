import { NextRequest, NextResponse } from "next/server";
import { listUsers, requireUser } from "@/lib/auth";
import { handle, parseJson } from "@/lib/http";
import { BudgetError } from "@/lib/ai/guard";
import { isRealDay } from "@/lib/clock";
import { buildCover } from "@/lib/handoff/cover";
import { startCoverDraft } from "@/lib/handoff/writer";

export const runtime = "nodejs";

// Drafts a cover note for someone's time off, from what falls in it. Either
// of you may ask for it: the one going away, or the one covering.
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requireUser(req);
    const body = await parseJson<{ userId?: string; from?: string; to?: string; by?: string }>(req);
    const who = listUsers().find((u) => u.id === body.userId);
    if (!who) return NextResponse.json({ error: "Whose time off is this?" }, { status: 400 });
    if (!body.from || !body.to || !isRealDay(body.from) || !isRealDay(body.to) || body.to < body.from) return NextResponse.json({ error: "Give the first and last day away." }, { status: 400 });
    try {
      return NextResponse.json({ runId: startCoverDraft(buildCover(who.id, { from: body.from, to: body.to }, undefined, body.by ?? null), user.id) });
    } catch (e) {
      if (e instanceof BudgetError) return NextResponse.json({ error: e.message }, { status: 429 });
      throw e;
    }
  });
}
