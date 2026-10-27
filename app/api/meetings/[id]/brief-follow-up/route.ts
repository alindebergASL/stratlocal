import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { getMeeting } from "@/lib/queries/meetings";
import { briefFollowUpOutcome } from "@/lib/meetings/briefFollowUp";
import { BriefFingerprint } from "@/lib/meetings/briefFollowUpOutcome";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Outcome recovery is a read, never a replay. No follow-up text in the URL.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const response = await handle(async () => {
    requireUser(req);
    const query = req.nextUrl.searchParams;
    const parsed = BriefFingerprint.safeParse(query.get("fingerprint"));
    if (!parsed.success || query.getAll("fingerprint").length !== 1 || [...query.keys()].some((k) => k !== "fingerprint")) {
      return NextResponse.json({ error: "Invalid brief fingerprint query." }, { status: 400 });
    }
    const { id } = await ctx.params;
    const meeting = getMeeting(id);
    if (!meeting) return NextResponse.json({ error: "Meeting not found." }, { status: 404 });
    const record = briefFollowUpOutcome(meeting.account_id, id, parsed.data);
    return NextResponse.json(record
      ? { ok: true, status: "found", fingerprint: parsed.data, record }
      : { ok: true, status: "absent", fingerprint: parsed.data });
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
