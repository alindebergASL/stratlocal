import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, parseJson } from "@/lib/http";
import { BudgetError, startResearchRun, startResearchExtractionRetry } from "@/lib/research/run";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = requireUser(req);
    const { id } = await ctx.params;
    try {
      const body = z.union([
        z.object({ retryRunId: z.string().uuid() }).strict(),
        z.object({ focus: z.string().max(300).optional(), depth: z.enum(["standard", "deep"]).optional() }).strict(),
      ]).parse(await parseJson(req, 4096));
      const runId = "retryRunId" in body
        ? startResearchExtractionRetry({ accountId: id, userId: user.id, retryRunId: body.retryRunId })
        : startResearchRun({ accountId: id, userId: user.id, focus: (body.focus ?? "").trim() || null, depth: body.depth ?? "deep" });
      return NextResponse.json({ runId });
    } catch (e) {
      if (e instanceof BudgetError) return NextResponse.json({ error: e.message }, { status: 429 });
      // The input is bounded (see WebResearchInput) and the message says what
      // is wrong with it, so it is worth showing rather than swallowing.
      if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues.map((i) => i.message).join("; ") }, { status: 400 });
      throw e;
    }
  });
}
