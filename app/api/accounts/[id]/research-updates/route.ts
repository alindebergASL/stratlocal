import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle, parseJson } from "@/lib/http";
import { startResearchUpdates } from "@/lib/research/updates";
import { BudgetError } from "@/lib/ai/guard";
export const runtime = "nodejs";
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = requireUser(req);
    const { id } = await ctx.params;
    const body = await parseJson<{ focus?: string }>(req, 2048);
    try {
      return NextResponse.json({
        runId: startResearchUpdates(id, user.id, typeof body.focus === "string" ? body.focus.slice(0, 300) : undefined),
      });
    } catch (e) {
      if (e instanceof BudgetError) return NextResponse.json({ error: e.message }, { status: 409 });
      throw e;
    }
  });
}
