import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle, parseJson } from "@/lib/http";
import { getMeeting } from "@/lib/queries/meetings";
import { BriefStartConflict, BudgetError, startBriefRun } from "@/lib/meetings/run";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = requireUser(req);
    const { id } = await ctx.params;
    const meeting = getMeeting(id);
    if (!meeting) return NextResponse.json({ error: "meeting not found" }, { status: 404 });
    const body = await parseJson<{ baseVersion?: unknown; replaceHumanEdits?: unknown } | null>(req, 2048);
    if (!body || !Number.isSafeInteger(body.baseVersion) || Number(body.baseVersion) < 0 || typeof body.replaceHumanEdits !== "boolean") {
      return NextResponse.json({ error: "Reload the meeting before preparing it: a rendered version and replacement intent are required." }, { status: 400 });
    }
    try {
      return NextResponse.json({ runId: startBriefRun(meeting, user.id, { baseVersion: body.baseVersion as number, replaceHumanEdits: body.replaceHumanEdits }) });
    } catch (e) {
      if (e instanceof BriefStartConflict) return NextResponse.json({ error: e.message }, { status: 409 });
      if (e instanceof BudgetError) return NextResponse.json({ error: e.message }, { status: 429 });
      throw e;
    }
  });
}
