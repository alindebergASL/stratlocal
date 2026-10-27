import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, parseJson } from "@/lib/http";
import { BudgetError } from "@/lib/ai/guard";
import { ApplyError } from "@/lib/proposals/apply";
import { startAsk } from "@/lib/ask/run";
import { parseFocus } from "@/lib/ask/focus";

export const runtime = "nodejs";

// Ask a question (lib/ask/run.ts). Returns the thread and the run at once;
// the page polls /api/ai-runs/[runId] for the steps and then the answer.
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requireUser(req);
    try {
      const body = z
        .object({
          question: z.string().min(2).max(4000),
          threadId: z.string().uuid().optional(),
          accountId: z.string().uuid().optional(),
          save: z.boolean().optional(),
          focus: z.string().max(620).optional(),
          templateId: z.string().max(80).optional(),
        })
        .strict()
        .parse(await parseJson(req, 16_384));
      return NextResponse.json(startAsk({ userId: user.id, question: body.question, threadId: body.threadId, accountId: body.accountId, save: body.save, focus: parseFocus(body.focus), templateId: body.templateId }));
    } catch (e) {
      if (e instanceof BudgetError) return NextResponse.json({ error: e.message }, { status: 429 });
      if (e instanceof ApplyError) return NextResponse.json({ error: e.message }, { status: 400 });
      if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues.map((i) => i.message).join("; ") }, { status: 400 });
      throw e;
    }
  });
}
