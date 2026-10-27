// Synthetic people and example domains only. AI_FAKE replay only.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { seedAccount, USER } from "./helpers";
import { applyEntityChange, acceptProposal } from "@/lib/proposals/apply";
import { sanitizeResearchNote } from "@/lib/research/extract";
import { startResearchRun } from "@/lib/research/run";
import { acceptNote, listNotes } from "@/lib/research/notes";
import { getRun } from "@/lib/ai/guard";
import { getAccount, listContacts, listPendingProposals } from "@/lib/queries/accounts";
import { theirSide } from "@/lib/theirSide";
import type { ResearchNote } from "@/lib/research/schema";

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, name: "Synthetic User", email: "synthetic@example.test" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn(), back: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

beforeEach(() => {
  vi.stubEnv("AI_FAKE", "1");
  vi.stubEnv("AI_DAILY_CAP_CENTS", "10000");
});
afterEach(() => vi.unstubAllEnvs());

async function research(accountId: string) {
  const runId = startResearchRun({ accountId, userId: USER, focus: null, depth: "standard" });
  await vi.waitFor(() => expect(getRun(runId)?.status).toBe("done"));
  return listNotes(accountId, "draft")[0]!;
}

it("a person stands only on a finding that names them", () => {
  const prose = "Robin Example became chief technology officer in 2026 (https://example.test/a).";
  const sources = new Map([["example.test/a", "https://example.test/a"]]);
  const note: ResearchNote = {
    title: "T",
    summary: "S.",
    findings: [{ text: "Robin Example became chief technology officer in 2026.", quote: "Robin Example became chief technology officer in 2026", url: "https://example.test/a", confidence: "high", date: null, topic: "leadership" }],
    open_questions: [],
    people: [
      { name: "Robin Example", title: "Chief technology officer", finding: 0 },
      { name: "Invented Person", title: "Director", finding: 0 },
    ],
  };
  const { note: clean } = sanitizeResearchNote(note, prose, sources);
  expect(clean.people).toEqual([{ name: "Robin Example", title: "Chief technology officer", finding: 0 }]);
});

it("research names their people as contacts to accept, once the finding is kept, and never twice", async () => {
  const { accountId } = seedAccount({ name: "Synthetic Their Side Co" });
  const draft = await research(accountId);
  const offered = listPendingProposals(accountId).filter((p) => p.origin_id === "research_people");
  expect(offered.map((p) => JSON.parse(p.payload_json))).toEqual([{ name: "Dana Rivera", title: "Chief information officer", org: "customer" }]);
  expect(theirSide(getAccount(accountId)!, listContacts(accountId)).suggested).toBe(1);
  // Not before the finding is kept.
  expect(() => acceptProposal(offered[0]!.id, USER, { ackEvidence: true })).toThrow();
  acceptNote(draft.doc.id, draft.meta.findings.map((_, i) => i), USER);
  expect(acceptProposal(offered[0]!.id, USER, { ackEvidence: true }).status).toBe("accepted");
  const dana = listContacts(accountId).find((c) => c.name === "Dana Rivera")!;
  expect(dana).toMatchObject({ org: "customer", title: "Chief information officer" });

  // A second run does not offer her again.
  await research(accountId);
  expect(listPendingProposals(accountId).filter((p) => p.origin_id === "research_people")).toEqual([]);
});

it("the card shows their priorities, ours labelled, and the roles nobody fills yet", async () => {
  const { accountId } = seedAccount({ name: "Synthetic Priorities Co" });
  const draft = await research(accountId);
  // Nothing kept: no research priority.
  expect(theirSide(getAccount(accountId)!, listContacts(accountId)).priorities.filter((p) => p.from === "research")).toEqual([]);
  acceptNote(draft.doc.id, draft.meta.findings.map((_, i) => i), USER);
  applyEntityChange({ accountId, entityType: "account", op: "update", entityId: accountId, payload: { archetype_hypothesis: "They want AI but have no policy yet." }, actorUserId: USER });
  let side = theirSide(getAccount(accountId)!, listContacts(accountId));
  expect(side.priorities[0]).toMatchObject({ from: "research" });
  expect(side.priorities[0]!.text).toContain("capital plan");
  expect(side.priorities.find((p) => p.from === "ours")?.text).toBe("They want AI but have no policy yet.");
  expect(side.rolesToFind.map((r) => r.role)).toEqual(["Chief information officer", "Procurement office"]);

  // Someone on file with the title fills the role.
  applyEntityChange({ accountId, entityType: "contact", op: "create", payload: { name: "Synthetic Person", title: "Chief Information Officer", org: "customer" }, actorUserId: USER });
  side = theirSide(getAccount(accountId)!, listContacts(accountId));
  expect(side.rolesToFind.map((r) => r.role)).toEqual(["Procurement office"]);

  const { default: Overview } = await import("@/app/accounts/[id]/page");
  const doc = parseHTML(renderToStaticMarkup(await Overview({ params: Promise.resolve({ id: accountId }) } as never))).document;
  expect(doc.querySelector('[data-testid="their-priorities"]')?.textContent).toContain("Our hypothesis, not theirs");
  expect(doc.querySelector('[data-testid="their-roles"]')?.textContent).toContain("Procurement office");
  expect(doc.querySelector('[data-testid="their-people-suggested"]')?.textContent).toContain("1 person named in research");
});
