import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { BudgetError } from "@/lib/ai/guard";
import { startArchetypeSuggestion } from "@/lib/playbook/archetype";
export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = requireUser(req);
    const { id } = await ctx.params;
    try {
      return NextResponse.json({ runId: startArchetypeSuggestion(id, user.id) });
    } catch (e) {
      if (e instanceof BudgetError) return NextResponse.json({ error: e.message }, { status: 409 });
      throw e;
    }
  });
}
