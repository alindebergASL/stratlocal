import { NextRequest, NextResponse } from "next/server";
import { HttpError, requireUser } from "@/lib/auth";
import { handle, parseJson } from "@/lib/http";
import { listPendingProposals } from "@/lib/queries/accounts";
import { acceptProposal, ApplyError } from "@/lib/proposals/apply";
import { reviewOrder } from "@/lib/proposals/order";

export const runtime = "nodejs";

// Far above any review list a person can read, and well inside the body cap.
const MAX_IDS = 5000;

// Accepts every pending proposal for the account, creates before the plays
// that link to them. One failure does not stop the rest; it is reported.
// An optional batchId narrows this to one extraction's proposals, so the
// button on a meeting page cannot sweep in another screen's pending review.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = requireUser(req);
    const { id } = await ctx.params;
    // A body that cannot be read is refused before anything is written. It
    // used to be caught and replaced with `{}` — no selection, no batch — so
    // a request too large to read (420 ids is past the old 16 KB cap) or one
    // malformed in transit accepted everything pending on the account.
    const parsed = await parseJson<unknown>(req, 256 * 1024);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new HttpError(400, { error: "Send the proposals to accept, by id." });
    const body = parsed as { batchId?: unknown; ids?: unknown };
    // The ids the person actually saw, and nothing else. Without them "all"
    // is whatever is pending at the moment the request lands, which can
    // include a proposal that arrived after the list was drawn — applied by a
    // button that never showed it. So a list is required, not optional.
    if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > MAX_IDS || !body.ids.every((x) => typeof x === "string" && x.length > 0 && x.length <= 128)) {
      throw new HttpError(400, { error: "Send the proposals to accept, by id." });
    }
    if (body.batchId !== undefined && typeof body.batchId !== "string") throw new HttpError(400, { error: "batchId must be a string." });
    const shown = new Set(body.ids as string[]);
    const all = listPendingProposals(id);
    const scoped = body.batchId ? all.filter((p) => p.batch_id === body.batchId) : all;
    const pending = reviewOrder(scoped.filter((p) => shown.has(p.id)));
    const summary = {
      accepted: 0,
      conflict: 0,
      failed: [] as Array<{ id: string; error: string }>,
      outcomes: [] as Array<{ id: string; status: string; message?: string }>,
    };
    for (const p of pending) {
      try {
        const r = acceptProposal(p.id, user.id);
        summary.outcomes.push({ id: p.id, status: r.status, message: r.message });
        if (r.status === "accepted") summary.accepted++;
        else summary.conflict++;
      } catch (e) {
        const error = e instanceof ApplyError ? e.message : "failed";
        summary.outcomes.push({ id: p.id, status: "failed", message: error });
        summary.failed.push({ id: p.id, error });
      }
    }
    return NextResponse.json(summary);
  });
}
