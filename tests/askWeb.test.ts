// Synthetic data only. Ask's one way to the web (DECISIONS #101): what may
// leave, what comes back, and that nothing is proposed from it.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getRun } from "@/lib/ai/guard";
import { guardWebQuestion, OutboundRefused } from "@/lib/ai/outboundGuard";
import { startAsk } from "@/lib/ask/run";
import { listMessages } from "@/lib/ask/threads";
import { listNotes } from "@/lib/research/notes";
import { listPlanDraftProposals } from "@/lib/queries/accounts";
import { resolveSources } from "@/lib/ask/sources";
import { seedAccount, USER } from "./helpers";

beforeEach(() => vi.stubEnv("AI_FAKE", "1"));
afterEach(() => vi.unstubAllEnvs());

it("lets a public question out, and refuses one that carries our deals, people or amounts", () => {
  const { accountId } = seedAccount({ name: "Synthetic Guarded Authority", dealId: "SYN-GUARD-1" });
  db().prepare(`INSERT INTO contacts (id, account_id, name, email, org, created_at, updated_at) VALUES ('c-guard', ?, 'Robin Example', 'robin@guarded.example', 'customer', 1, 1)`).run(accountId);
  const deal = (db().prepare(`SELECT name FROM deals WHERE deal_id = 'SYN-GUARD-1'`).get() as { name: string }).name;
  expect(guardWebQuestion("  What did they announce about digital records this year? ", accountId)).toBe("What did they announce about digital records this year?");
  for (const bad of [`Any news on ${deal}?`, "Has Robin Example moved roles?", "Did robin@guarded.example post anything?", "Is their $2.4M budget public?", "Do they have 3m set aside?", "x".repeat(301)])
    expect(() => guardWebQuestion(bad, accountId)).toThrow(OutboundRefused);
});

it("looks it up, cites the finding as unreviewed, leaves a draft to keep, and proposes nothing", async () => {
  const { accountId } = seedAccount({ name: "Synthetic Web County", dealId: "SYN-WEB-1" });
  const { threadId, runId } = startAsk({ userId: USER, question: "Look up their recent announcements and add a follow-up", accountId });
  await vi.waitFor(() => expect(getRun(runId)?.status).toBe("done"), { timeout: 20000 });
  // What was sent: the public identity and the question, nothing of ours.
  const research = db().prepare(`SELECT input_summary FROM ai_runs WHERE account_id = ? AND kind = 'research'`).get(accountId) as { input_summary: string };
  const sent = JSON.parse(research.input_summary);
  expect(sent.companyName).toBe("Synthetic Web County");
  expect(sent.focusQuestion).toBe("Look up their recent announcements and add a follow-up");
  expect(research.input_summary).not.toContain("SYN-WEB-1");
  // A draft to keep, and the answer cites it as a web finding.
  expect(listNotes(accountId, "draft")).toHaveLength(1);
  const answer = listMessages(threadId)[1]!;
  expect(answer.citations.some((c) => c.kind === "web")).toBe(true);
  const web = resolveSources(answer.citations).find((s) => s.detail === "from the web, not yet reviewed");
  expect(web?.href).toBe(`/accounts/${accountId}/research#research-review`);
  // "Add a follow-up" was asked, but nothing is proposed from the web.
  expect(listPlanDraftProposals(accountId).filter((p) => p.origin_id?.startsWith("ask:"))).toHaveLength(0);
});
