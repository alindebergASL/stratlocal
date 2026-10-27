import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { getMeeting } from "@/lib/queries/meetings";
import { BudgetError, startRecapRun } from "@/lib/meetings/run";

export const runtime = "nodejs";

// Drafts the follow-up email from the meeting's saved notes. The draft is
// returned on the run; nothing is written to the account and nothing is sent.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = requireUser(req);
    const { id } = await ctx.params;
    const meeting = getMeeting(id);
    if (!meeting || meeting.archived_at) return NextResponse.json({ error: "meeting not found" }, { status: 404 });
    if ((meeting.raw_notes ?? "").trim().length < 20) return NextResponse.json({ error: "Write the meeting notes first: the recap is drafted from them." }, { status: 400 });
    try {
      return NextResponse.json({ runId: startRecapRun(meeting, user.id) });
    } catch (e) {
      if (e instanceof BudgetError) return NextResponse.json({ error: e.message }, { status: 429 });
      throw e;
    }
  });
}
