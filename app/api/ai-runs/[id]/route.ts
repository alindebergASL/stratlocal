import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { getRun } from "@/lib/ai/guard";
import { runState } from "@/lib/ai/runState";

export const runtime = "nodejs";

// Polled by the page while a run is in progress.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireUser(req);
    const { id } = await ctx.params;
    const run = getRun(id);
    if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({
      id: run.id,
      kind: run.kind,
      ...runState(run),
      started_at: run.started_at,
      finished_at: run.finished_at,
    });
  });
}
