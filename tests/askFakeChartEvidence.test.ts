// Synthetic fake-provider contract: replay must earn chart evidence too.
import { afterEach, expect, it, vi } from "vitest";
import { startAsk } from "@/lib/ask/run";
import { getRun } from "@/lib/ai/guard";
import { listMessages } from "@/lib/ask/threads";
import { getReport } from "@/lib/ask/report";
import { getTemplate } from "@/lib/ask/templates";
import { seedAccount, USER } from "./helpers";

afterEach(() => vi.unstubAllEnvs());
it.each(["weekly_pipeline", "quarter_forecast", "account_one_pager", "before_1on1", "friday_review"])("fake %s reads matching scope before storing its chart", async (templateId) => {
  vi.stubEnv("AI_FAKE", "1");
  const a = seedAccount();
  const template = getTemplate(templateId)!;
  const run = startAsk({ userId: USER, templateId, question: template.question, accountId: template.scope === "account" ? a.accountId : null });
  await vi.waitFor(() => expect(getRun(run.runId)?.status).toBe("done"));
  const answer = listMessages(run.threadId).find((m) => m.role === "assistant")!;
  const report = getReport(answer.reportDocId!)!;
  expect(report.report.sections[1]?.chart?.kind).toBe(templateId === "weekly_pipeline" ? "movement" : "pipeline_by_quarter");
  if (templateId === "weekly_pipeline") expect(answer.steps.some((s) => /movement|moved/i.test(s))).toBe(true);
});
