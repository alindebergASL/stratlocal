import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle, parseJson } from "@/lib/http";
import { getAccount } from "@/lib/queries/accounts";
import { BudgetError } from "@/lib/ai/guard";
import { startInviteRun } from "@/lib/meetings/run";
import { z } from "zod";

export const runtime = "nodejs";

const Body = z.object({ text: z.string().max(50_000) });

// Reading a pasted invite. The run writes nothing — its result goes back to
// the New meeting form, and the person presses Create.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = requireUser(req);
    const { id } = await ctx.params;
    if (!getAccount(id)) return NextResponse.json({ error: "account not found" }, { status: 404 });
    const body = Body.parse(await parseJson(req));
    try {
      return NextResponse.json({ runId: startInviteRun(id, body.text, user.id) });
    } catch (e) {
      if (e instanceof BudgetError) return NextResponse.json({ error: e.message }, { status: 429 });
      throw e;
    }
  });
}
