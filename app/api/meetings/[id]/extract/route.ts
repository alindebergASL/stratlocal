import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { getMeeting } from "@/lib/queries/meetings";
import { BudgetError, startExtractRun } from "@/lib/meetings/run";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = requireUser(req);
    const { id } = await ctx.params;
    const meeting = getMeeting(id);
    if (!meeting) return NextResponse.json({ error: "meeting not found" }, { status: 404 });
    try {
      return NextResponse.json({ runId: startExtractRun(meeting, user.id) });
    } catch (e) {
      if (e instanceof BudgetError) return NextResponse.json({ error: e.message }, { status: 429 });
      throw e;
    }
  });
}
