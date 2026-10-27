import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle, parseJson } from "@/lib/http";
import { acceptProposal, ApplyError, getProposal, rejectProposal } from "@/lib/proposals/apply";
import { undoAccepted } from "@/lib/proposals/undo";

export const runtime = "nodejs";

// What actually happened to this proposal, read from the row itself.
//
// A POST whose reply never arrives leaves the screen unable to say whether
// anything was written — and the honest answer is not "nothing was applied",
// nor a second POST that might apply it twice. This is the read that settles
// it: no argument, no write, no billable call.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireUser(req);
    const { id } = await ctx.params;
    const row = getProposal(id);
    if (!row) return NextResponse.json({ error: "no such proposal" }, { status: 404 });
    return NextResponse.json({
      status: row.status,
      entityId: row.entity_id,
      decidedAt: row.decided_at,
    });
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = requireUser(req);
    const { id } = await ctx.params;
    const body = await parseJson<{ action?: string; ackEvidence?: boolean; edits?: unknown }>(req, 16 * 1024);
    const edits = body.edits && typeof body.edits === "object" && !Array.isArray(body.edits) ? (body.edits as Record<string, unknown>) : undefined;
    try {
      if (body.action === "accept")
        return NextResponse.json(
          acceptProposal(id, user.id, {
            ackEvidence: body.ackEvidence === true,
            edits,
          }),
        );
      if (body.action === "reject") return NextResponse.json(rejectProposal(id, user.id));
      // Undo an accept: puts back what nobody has changed since (lib/proposals/undo.ts).
      if (body.action === "undo") return NextResponse.json({ status: "undone", ...undoAccepted(id, user.id) });
      return NextResponse.json({ error: "action must be accept, reject or undo" }, { status: 400 });
    } catch (e) {
      if (e instanceof ApplyError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.code === "not_found" ? 404 : 409 });
      throw e;
    }
  });
}
