import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { BudgetError } from "@/lib/ai/guard";
import { startAccountDraft } from "@/lib/handoff/writer";

export const runtime = "nodejs";

// Drafts the covering text of a handoff for another team. The draft fills the
// form on the page; creating the handoff and its link is still the person's
// press (DECISIONS #24, #28).
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = requireUser(req);
    const { id } = await ctx.params;
    try {
      return NextResponse.json({ runId: startAccountDraft(id, user.id) });
    } catch (e) {
      if (e instanceof BudgetError) return NextResponse.json({ error: e.message }, { status: 429 });
      throw e;
    }
  });
}
