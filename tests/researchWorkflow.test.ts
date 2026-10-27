// The research workflow, from the panel on the account to what a refused
// suggestion says.
//
// Three failures this covers, all of them visible from the screen and none of
// them visible from the old tests:
//
//  1. A topic card that counted nine findings and showed none of them, because
//     the cap was spent in topic order, and offered no way to the rest because
//     the link was gated on the rows it had.
//  2. One unsupported suggestion aborting the whole batch, so a person saw
//     "Name and title must be explicit in saved evidence" and no suggestions —
//     including the eleven the evidence did support.
//  3. A review link that was always offered, whether or not anything was
//     pending, and a generation button labelled "Review".
//
// SYNTHETIC ONLY: invented people, organisations and sentences.
import { expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { DOSSIER_TOPICS, researchCoverage } from "@/lib/research/coverage";
import { ResearchDossier } from "@/components/ResearchDossier";
import { previewByTopic } from "@/components/FindingList";
import { ResearchPanel, type ResearchPanelView } from "@/app/accounts/[id]/ResearchPanel";
import { ResearchUpdates } from "@/app/accounts/[id]/research/ResearchUpdates";
import { partitionUpdates, updatesToDrafts, type WithheldSuggestion } from "@/lib/research/updates";
import { applyEntityChange } from "@/lib/proposals/apply";
import { acceptNote, researchSelection, storeDraftNote } from "@/lib/research/notes";
import { db } from "@/lib/db";
import { USER } from "./helpers";
import { TOPIC_LABELS, type ResearchFinding, type Topic } from "@/lib/research/schema";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requirePageUser: async () => ({ id: USER, name: "Synthetic User", email: "synthetic@example.test" }),
}));

const finding = (topic: Topic, n: number, text?: string): ResearchFinding => ({
  topic,
  text: text ?? `Synthetic ${topic} fact ${n}.`,
  quote: text ?? `Synthetic ${topic} fact ${n}.`,
  url: `https://example.com/${topic}/${n}`,
  date: null,
  confidence: "medium",
});

function dossier(findings: ResearchFinding[], max?: number, moreHref: string | undefined = "/all") {
  const html = renderToStaticMarkup(createElement(ResearchDossier, { findings, coverage: researchCoverage(findings), max, moreHref }));
  return { html, document: parseHTML(html).document };
}

/** Rows and link, per topic card, as the screen has them. */
function cards(document: Document) {
  const out: Record<string, { count: string; rows: number; link: string | null }> = {};
  for (const card of document.querySelectorAll('[data-testid="research-dossier"] .grid > div')) {
    out[card.querySelector("h4")?.textContent ?? ""] = {
      count: card.querySelector("h4 + span")?.textContent ?? "",
      rows: card.querySelectorAll("li").length,
      // The card's own way to the rest, not a finding's source link.
      link: [...card.querySelectorAll("a")].find((a) => (a.textContent ?? "").startsWith("View all"))?.textContent ?? null,
    };
  }
  return out;
}

it("shows something from every topic that has something, however skewed the note is", () => {
  // The reported shape: twenty-six findings in the first two topics and the
  // page's cap of twenty-four, with the later topics holding findings of their
  // own. Spent in topic order the budget never reached them.
  const findings = [
    ...Array.from({ length: 20 }, (_, i) => finding("org", i)),
    ...Array.from({ length: 6 }, (_, i) => finding("leadership", i)),
    ...Array.from({ length: 4 }, (_, i) => finding("strategy", i)),
    ...Array.from({ length: 3 }, (_, i) => finding("technology", i)),
    finding("risk", 1),
  ];
  const { document } = dossier(findings, 24);
  const c = cards(document);
  for (const topic of ["org", "leadership", "strategy", "technology", "risk"] as const) {
    expect(c[TOPIC_LABELS[topic]]!.rows, `${topic} should show a finding`).toBeGreaterThan(0);
  }
  // The counts are still the whole topic's, and the cap still binds: two rows
  // per topic, which is under the cap rather than spending all of it here.
  expect(c[TOPIC_LABELS.org]!.count).toBe("20 findings");
  expect([...document.querySelectorAll('[data-testid="research-dossier"] li')].length).toBeLessThanOrEqual(24);
  expect([...document.querySelectorAll('[data-testid="research-dossier"] li')]).toHaveLength(9);
  // And the topic holding the most behind the cap says how to reach it.
  expect(c[TOPIC_LABELS.org]!.link).toContain("View all 20");
});

it("offers the way to everything even when the cap shows nothing at all", () => {
  // The edge the old gate failed on: rows.length > 0 was the condition for the
  // link, so a card with no rows was a count with no route.
  const findings = [...Array.from({ length: 5 }, (_, i) => finding("org", i)), finding("procurement", 1)];
  for (const max of [0, 1]) {
    const c = cards(dossier(findings, max).document);
    expect(c[TOPIC_LABELS.org]!.link, `org at max=${max}`).toContain("View all 5");
    expect(c[TOPIC_LABELS.procurement]!.link, `procurement at max=${max}`).toContain("View all 1");
  }
  // Nothing is claimed to be shown that is not.
  expect(dossier(findings, 0).html).toContain("Showing 0 of 6 retained findings");
});

it("keeps a truly empty topic honest and link-free", () => {
  const c = cards(dossier([finding("technology", 1)], 24).document);
  expect(c[TOPIC_LABELS.leadership]).toEqual({ count: "No findings in this pass", rows: 0, link: null });
  // Every dossier topic still gets its card: "we looked and there is nothing"
  // is the half of coverage a list of non-zero numbers cannot say.
  for (const t of DOSSIER_TOPICS) expect(c).toHaveProperty(TOPIC_LABELS[t]);
});

it("keeps a preview to two per topic however the findings are distributed", () => {
  // 112 findings in one topic and a cap of 24 used to print 24 rows in one
  // card: the whole budget, in the one place a preview is least useful.
  const oneTopic = Array.from({ length: 112 }, (_, i) => finding("org", i));
  const c = cards(dossier(oneTopic, 24).document);
  expect(c[TOPIC_LABELS.org]!.rows).toBe(2);
  expect(c[TOPIC_LABELS.org]!.count).toBe("112 findings");
  expect(c[TOPIC_LABELS.org]!.link).toContain("View all 112");
  expect(dossier(oneTopic, 24).html).toContain("Showing 2 of 112 retained findings");

  // Spread across topics: two each, and the total shown is the honest smaller
  // number rather than the cap.
  const spread = [
    ...Array.from({ length: 20 }, (_, i) => finding("org", i)),
    ...Array.from({ length: 6 }, (_, i) => finding("leadership", i)),
    ...Array.from({ length: 4 }, (_, i) => finding("strategy", i)),
    ...Array.from({ length: 3 }, (_, i) => finding("technology", i)),
    finding("risk", 1),
  ];
  const spreadCards = cards(dossier(spread, 24).document);
  for (const t of ["org", "leadership", "strategy", "technology"] as const) expect(spreadCards[TOPIC_LABELS[t]]!.rows, t).toBe(2);
  expect(spreadCards[TOPIC_LABELS.risk]!.rows).toBe(1);
  expect(dossier(spread, 24).html).toContain("Showing 9 of 34 retained findings");
  // And the cap still binds when it is the smaller of the two.
  expect(previewByTopic(spread, 3).shown).toBe(3);
});

it("allocates a preview without losing or duplicating a finding", () => {
  const findings = [...Array.from({ length: 9 }, (_, i) => finding("org", i)), ...Array.from({ length: 2 }, (_, i) => finding("risk", i))];
  const { rows, shown, hidden } = previewByTopic(findings, 5);
  expect(shown + hidden).toBe(findings.length);
  const flat = [...rows.values()].flat();
  // Two topics, two each: under the cap of five, and every row distinct.
  expect(flat).toHaveLength(4);
  expect(shown).toBe(4);
  expect(new Set(flat.map((f) => f.url)).size).toBe(4);
  // A larger per-topic allowance still respects the cap exactly.
  expect(previewByTopic(findings, 5, 4).shown).toBe(5);
  // Without a cap it is the whole set, grouped.
  expect(previewByTopic(findings).shown).toBe(11);
});

// ---- suggested updates -------------------------------------------------------

/** A finding as saved: the model's sentence, and optionally the source excerpt behind it. */
const leadership = (text: string | { text: string; source: string }): ResearchFinding =>
  typeof text === "string" ? { ...finding("leadership", 1, text) } : { ...finding("leadership", 1, text.text), evidence: { kind: "source_excerpt", text: text.source } };

function researched(texts: Array<string | { text: string; source: string }>) {
  const accountId = applyEntityChange({ accountId: "", entityType: "account", op: "create", payload: { name: "Synthetic" }, actorUserId: USER }).entityId;
  const doc = storeDraftNote({
    accountId,
    userId: USER,
    aiRunId: "synthetic",
    note: { title: "Research", summary: "", open_questions: [], findings: texts.map(leadership) },
    prose: "Original",
    focus: null,
    depth: "standard",
    searches: 0,
    fetches: 0,
    dropped: [],
  });
  acceptNote(
    doc.id,
    texts.map((_, i) => i),
    USER,
  );
  return { accountId, doc, evidence: researchSelection(accountId).included };
}

const proposalsInDb = () => (db().prepare("SELECT COUNT(*) AS n FROM proposals").get() as { n: number }).n;

it("keeps the supported suggestions when one of their siblings is not supported", () => {
  const { accountId, evidence } = researched([
    "Dana Rivera is the chief information officer.",
    "The authority published a five-year modernisation strategy.",
  ]);
  const { drafts, withheld, suggestions, unchanged } = partitionUpdates(
    accountId,
    {
      updates: [
        { type: "contact", name: "Dana Rivera", title: "chief information officer", evidence_id: evidence[0]!.id },
        // Nowhere in the evidence. This used to abort the batch.
        { type: "contact", name: "Invented Person", title: "chief executive officer", evidence_id: evidence[1]!.id },
        { type: "follow_up", text: "Confirm the modernisation strategy with the customer.", evidence_id: evidence[1]!.id },
      ],
    },
    evidence,
  );
  expect(suggestions).toBe(3);
  expect(unchanged).toBe(0);
  expect(drafts.map((d) => d.entity_type)).toEqual(["contact", "action_item"]);
  expect(drafts.some((d) => JSON.stringify(d.payload).includes("Invented Person"))).toBe(false);
  expect(withheld).toHaveLength(1);
  expect(withheld[0]!.what).toContain("Invented Person");
  expect(withheld[0]!.reason).toMatch(/explicit/i);
  expect(withheld[0]!.next).toMatch(/cited finding/i);
  // The withheld one carries where to go and look.
  expect(withheld[0]!.noteId).toBe(evidence[1]!.noteId);
  expect(withheld[0]!.evidenceId).toBe(evidence[1]!.id);
  // Nothing here writes: proposals are a later, separate act.
  expect(proposalsInDb()).toBe(0);
});

it("says so plainly when every suggestion was withheld", () => {
  const { accountId, evidence } = researched(["Dana Rivera is the chief information officer."]);
  const { drafts, withheld } = partitionUpdates(
    accountId,
    {
      updates: [
        { type: "contact", name: "Invented Person", title: "chief executive officer", evidence_id: evidence[0]!.id },
        { type: "account", field: "hq", value: "A city nobody wrote down", evidence_id: evidence[0]!.id },
      ],
    },
    evidence,
  );
  expect(drafts).toEqual([]);
  expect(withheld.map((w) => w.reason)).toEqual(["Name and title must be explicit in saved evidence", "Account value must be explicit in saved evidence"]);
  expect(withheld[1]!.what).toContain("Headquarters");
});

it("does not let a short value ground itself inside a longer word", () => {
  // Substring grounding answered yes to both of these: "Anna Lee" inside
  // "Joanna Lee", and "US" inside "business". Neither is what the source says.
  const { accountId, evidence } = researched(["Joanna Lee is the chief information officer and the business is growing."]);
  const { drafts, withheld } = partitionUpdates(
    accountId,
    {
      updates: [
        { type: "contact", name: "Anna Lee", title: "chief information officer", evidence_id: evidence[0]!.id },
        { type: "account", field: "hq", value: "US", evidence_id: evidence[0]!.id },
      ],
    },
    evidence,
  );
  expect(drafts).toEqual([]);
  expect(withheld.map((w) => w.reason)).toEqual(["Name and title must be explicit in saved evidence", "Account value must be explicit in saved evidence"]);
});

it("still grounds a value the source states as whole words, across a line break", () => {
  const { accountId, evidence } = researched(["Joanna Lee is the chief information\nofficer; the group is headquartered in the US."]);
  const { drafts, withheld } = partitionUpdates(
    accountId,
    {
      updates: [
        { type: "contact", name: "Joanna Lee", title: "Chief Information Officer", evidence_id: evidence[0]!.id },
        { type: "account", field: "hq", value: "US", evidence_id: evidence[0]!.id },
      ],
    },
    evidence,
  );
  expect(withheld).toEqual([]);
  expect(drafts.map((d) => d.entity_type)).toEqual(["contact", "account"]);
});

it("still refuses to assert a role the evidence does not put in the present tense", () => {
  const { accountId, evidence } = researched(["Dana Rivera formerly served as chief information officer; Morgan Lee is the current chief information officer."]);
  const { drafts, withheld } = partitionUpdates(
    accountId,
    { updates: [{ type: "contact", name: "Dana Rivera", title: "chief information officer", evidence_id: evidence[0]!.id }] },
    evidence,
  );
  // Not a person, not withheld either: a question to go and ask, which is the
  // one case where the honest output is a follow-up (DECISIONS #30).
  expect(withheld).toEqual([]);
  expect(drafts).toHaveLength(1);
  expect(drafts[0]!.entity_type).toBe("action_item");
});

// The canonical excerpt, which is what the model is shown and what the checks
// read. These two cases went opposite ways before they agreed: the union of
// the paraphrase and the report quote refused a title the source really
// carried, and accepted one only the paraphrase carried.
it("supports a suggestion the source excerpt carries, even when the paraphrase does not repeat it", () => {
  const { accountId, evidence } = researched([
    { text: "The authority named a new information chief this spring.", source: "Dana Rivera, chief information officer, leads the modernisation programme." },
  ]);
  const { drafts, withheld } = partitionUpdates(
    accountId,
    { updates: [{ type: "contact", name: "Dana Rivera", title: "chief information officer", evidence_id: evidence[0]!.id }] },
    evidence,
  );
  expect(withheld).toEqual([]);
  expect(drafts).toHaveLength(1);
  expect(drafts[0]!.entity_type).toBe("contact");
  // The proposal quotes the source, and says it is one.
  expect(drafts[0]!.source_ref?.verification).toBe("source_excerpt");
  expect(drafts[0]!.source_ref?.quote).toContain("chief information officer");
});

it("withholds a title the AI prose invented and the source does not carry", () => {
  const { accountId, evidence } = researched([
    { text: "Dana Rivera is the chief technology officer.", source: "Dana Rivera, chief information officer, leads the modernisation programme." },
  ]);
  const { drafts, withheld } = partitionUpdates(
    accountId,
    { updates: [{ type: "contact", name: "Dana Rivera", title: "chief technology officer", evidence_id: evidence[0]!.id }] },
    evidence,
  );
  expect(drafts).toEqual([]);
  expect(withheld).toHaveLength(1);
  expect(withheld[0]!.reason).toMatch(/explicit in saved evidence/i);
  expect(proposalsInDb()).toBe(0);
});

it("withholds an account value the source excerpt does not carry, whatever the report said", () => {
  const { accountId, evidence } = researched([
    { text: "Synthetic is headquartered in Invented Town.", source: "The authority's registered office is at 4 Example Street, Example Town." },
  ]);
  const { withheld } = partitionUpdates(accountId, { updates: [{ type: "account", field: "hq", value: "Invented Town", evidence_id: evidence[0]!.id }] }, evidence);
  expect(withheld).toHaveLength(1);
  expect(withheld[0]!.reason).toMatch(/Account value must be explicit/i);
});

it("points a duplicate name at comparing the records, not at merging two possible people", () => {
  const { accountId, evidence } = researched([{ text: "Dana Rivera is the chief information officer.", source: "Dana Rivera is the chief information officer." }]);
  // Two records, same name, different people as far as anything here knows.
  for (const title of ["analyst", "programme lead"])
    applyEntityChange({ accountId, entityType: "contact", op: "create", payload: { name: "Dana Rivera", title, org: "customer" }, actorUserId: USER });
  const { drafts, withheld } = partitionUpdates(
    accountId,
    { updates: [{ type: "contact", name: "Dana Rivera", title: "chief information officer", evidence_id: evidence[0]!.id }] },
    evidence,
  );
  // Still refused, still nothing written: the ambiguity is fatal to the
  // suggestion. Only the advice changed.
  expect(drafts).toEqual([]);
  expect(withheld[0]!.reason).toMatch(/Ambiguous name/);
  expect(withheld[0]!.next).toMatch(/compare/i);
  expect(withheld[0]!.next).toMatch(/only if they are confirmed to be the same person/i);
  expect(proposalsInDb()).toBe(0);
});

it("keeps an invented evidence id fatal, for the batch and for the strict helper", () => {
  const { accountId, evidence } = researched(["Dana Rivera is the chief information officer."]);
  const data = {
    updates: [
      { type: "contact" as const, name: "Dana Rivera", title: "chief information officer", evidence_id: evidence[0]!.id },
      { type: "follow_up" as const, text: "Something citing evidence that does not exist.", evidence_id: "note-does-not-exist#4" },
    ],
  };
  // A response that cites evidence nobody supplied is not one bad suggestion;
  // it is a response that cannot be trusted, and neither entry survives it.
  expect(() => partitionUpdates(accountId, data, evidence)).toThrow(/unknown evidence/i);
  expect(() => updatesToDrafts(accountId, data, evidence)).toThrow(/unknown evidence/i);
  expect(proposalsInDb()).toBe(0);
});

it("counts a suggestion that changes nothing as changing nothing, not as a proposal", () => {
  const { accountId, evidence } = researched(["Synthetic is headquartered in Example Town."]);
  applyEntityChange({ accountId, entityId: accountId, entityType: "account", op: "update", payload: { hq: "Example Town" }, actorUserId: USER });
  const { drafts, unchanged, withheld } = partitionUpdates(
    accountId,
    { updates: [{ type: "account", field: "hq", value: "Example Town", evidence_id: evidence[0]!.id }] },
    evidence,
  );
  expect(drafts).toEqual([]);
  expect(withheld).toEqual([]);
  expect(unchanged).toBe(1);
});

// ---- what the screens say ----------------------------------------------------

// Cast at the seam on purpose: one of these fixtures is a run stored before
// the result grew its extra fields, which is precisely a shape today's type no
// longer describes.
const runResult = (result: unknown, status: "done" | "failed" = "done", error = "Use a supplied evidence_id") =>
  ({
    id: "run-1",
    state: { status, error: status === "failed" ? error : null, cost_cents: 12, cost_estimated: true, result },
  }) as Parameters<typeof ResearchUpdates>[0]["initialRun"];

function updatesHtml(props: Partial<Parameters<typeof ResearchUpdates>[0]> = {}) {
  return renderToStaticMarkup(createElement(ResearchUpdates, { accountId: "acc-1", included: 4, total: 9, ...props } as Parameters<typeof ResearchUpdates>[0]));
}

it("reads a stored run back as proposals, no-ops and withheld suggestions", () => {
  const withheld: WithheldSuggestion[] = [
    {
      what: "Person · Invented Person — chief executive officer",
      reason: "Name and title must be explicit in saved evidence",
      next: "Open the cited finding.",
      evidenceId: "note-1#2",
      noteId: "note-1",
      findingIndex: 2,
      url: "https://example.com/a",
    },
  ];
  const html = updatesHtml({ initialRun: runResult({ batchId: "b1", proposals: 2, included: 4, omitted: 5, suggestions: 4, unchanged: 1, withheld }) });
  expect(html).toContain("2 suggestions prepared for review");
  expect(html).toContain("1 changed nothing on file");
  expect(html).toContain("1 withheld");
  expect(html).toContain("Invented Person");
  expect(html).toContain("/accounts/acc-1/research?note=note-1&amp;finding=2#finding-note-1-2");
  // The generation button says what pressing it does, and the review link is
  // a separate act.
  expect(html).toContain("Prepare suggestions");
  expect(html).not.toContain("Review suggested account updates</button>");
});

it("never claims a review queue that is empty, and always offers one that is not", () => {
  const none = updatesHtml({ initialRun: runResult({ batchId: "b1", proposals: 0, included: 4, omitted: 5, suggestions: 2, unchanged: 0, withheld: [] }) });
  expect(none).not.toContain("pending suggestion");
  expect(none).not.toContain("/inbox?kind=changes&amp;account=acc-1");
  const pending = updatesHtml({ pending: 3 });
  expect(pending).toContain("Review 3 pending suggestions");
  expect(pending).toContain("/inbox?kind=changes&amp;account=acc-1");
  // Every suggestion refused: said as that, rather than as silence.
  const allWithheld = updatesHtml({
    initialRun: runResult({
      batchId: "b1",
      proposals: 0,
      included: 4,
      omitted: 5,
      suggestions: 1,
      unchanged: 0,
      withheld: [{ what: "Person · Invented Person — chief executive officer", reason: "Name and title must be explicit in saved evidence", next: "Open the cited finding.", evidenceId: "x#1", noteId: null, findingIndex: null, url: null }],
    }),
  });
  expect(allWithheld).toContain("every suggestion was withheld");
});

it("reads a run stored before any of this existed without inventing its numbers", () => {
  // Old `result_json`: four fields and no withheld list. Printing "0 withheld"
  // over a number nobody recorded is a claim the run never made.
  const html = updatesHtml({ initialRun: runResult({ batchId: "b1", proposals: 2, included: 4, omitted: 5 }) });
  expect(html).toContain("2 suggestions prepared for review");
  expect(html).not.toContain("withheld");
  expect(html).not.toContain("changed nothing on file");
});

it("counts pending work from the server, never from what a past run prepared", () => {
  // The state after somebody has decided: the run still says it prepared two,
  // because it did, and nothing is waiting any more. The link used to fall back
  // to the stored `proposals` and send people to an empty review queue.
  const decided = updatesHtml({ initialRun: runResult({ batchId: "b1", proposals: 2, included: 4, omitted: 5, suggestions: 2, unchanged: 0, withheld: [] }), pending: 0 });
  expect(decided).toContain("2 suggestions prepared for review");
  expect(decided).toContain("Last preparation on this account");
  expect(decided).not.toContain("pending suggestion");
  expect(decided).not.toContain("/inbox?kind=changes&amp;account=acc-1");
  // One rejected of two: the count that shows is the server's one, not the
  // run's two.
  const partly = updatesHtml({ initialRun: runResult({ batchId: "b1", proposals: 2, included: 4, omitted: 5, suggestions: 2, unchanged: 0, withheld: [] }), pending: 1 });
  expect(partly).toContain("Review 1 pending suggestion →");
  expect(partly).not.toContain("Review 2 pending");
  // An old four-field result behaves the same way: it is a record of a run,
  // not a claim about the queue.
  const legacy = updatesHtml({ initialRun: runResult({ batchId: "b1", proposals: 12, included: 4, omitted: 5 }), pending: 0 });
  expect(legacy).not.toContain("pending suggestion");
  expect(legacy).not.toContain("/inbox?kind=changes&amp;account=acc-1");
});

it("sends a withheld suggestion to the exact finding it cited", () => {
  const html = updatesHtml({
    initialRun: runResult({
      batchId: "b1",
      proposals: 0,
      included: 4,
      omitted: 5,
      suggestions: 1,
      unchanged: 0,
      withheld: [
        {
          what: "Person · Invented Person — chief executive officer",
          reason: "Name and title must be explicit in saved evidence",
          next: "Open the cited finding.",
          evidenceId: "note-1#7",
          noteId: "note-1",
          findingIndex: 7,
          url: "https://example.com/a",
        },
      ],
    }),
  });
  // The finding, at its stored index, and not the note's re-review checklist.
  expect(html).toContain("/accounts/acc-1/research?note=note-1&amp;finding=7#finding-note-1-7");
});

it("distinguishes a refusal before anything was proposed from a failure of unknown extent", () => {
  // A refusal raised while checking the model's answer: nothing could have
  // been created, and saying so is the difference between "try again" and
  // going to look for suggestions that were never made.
  const checked = updatesHtml({ initialRun: runResult(null, "failed", "Use a supplied evidence_id"), pending: 2 });
  expect(checked).toContain("Use a supplied evidence_id");
  expect(checked).toContain("No new batch of suggestions was created");
  // Proposals from an earlier run are still pending and still say so.
  expect(checked).toContain("Review 2 pending suggestions");

  // Anything else stopped somewhere this screen cannot see. It must not
  // promise that nothing was written, and must not imply the run itself went
  // unrecorded.
  const unknown = updatesHtml({ initialRun: runResult(null, "failed", "The model call failed after 3 attempts"), pending: 0 });
  expect(unknown).toContain("The model call failed after 3 attempts");
  expect(unknown).not.toContain("nothing was written");
  expect(unknown).not.toContain("No new batch of suggestions was created");
  expect(unknown).toContain("How far this attempt got is not established here");
  expect(unknown).toContain("were recorded");
});

// ---- reading one topic, and one exact finding --------------------------------

// The real page, because the defect is the page's: the card's "View all 9"
// went to `?all=1`, which opens every note in full, and "Open the cited
// finding" opened the note's re-review checklist.
async function researchHtml(accountId: string, query: Record<string, string> = {}) {
  const { default: ResearchPage } = await import("@/app/accounts/[id]/research/page");
  return renderToStaticMarkup(await ResearchPage({ params: Promise.resolve({ id: accountId }), searchParams: Promise.resolve(query) }));
}

function multiTopicNote() {
  const accountId = applyEntityChange({ accountId: "", entityType: "account", op: "create", payload: { name: "Synthetic Two" }, actorUserId: USER }).entityId;
  const findings = [
    ...Array.from({ length: 4 }, (_, i) => finding("org", i, `Synthetic organisation sentence ${i}.`)),
    ...Array.from({ length: 3 }, (_, i) => finding("leadership", i, `Synthetic leadership sentence ${i}.`)),
  ];
  const doc = storeDraftNote({
    accountId,
    userId: USER,
    aiRunId: "synthetic",
    note: { title: "Research", summary: "Model paragraph.", open_questions: [], findings },
    prose: "Original",
    focus: null,
    depth: "standard",
    searches: 0,
    fetches: 0,
    dropped: [],
  });
  return { accountId, noteId: doc.id, findings };
}

it("addresses one topic of one note, read-only, without opening the whole file", async () => {
  const { accountId, noteId } = multiTopicNote();
  acceptNote(noteId, [0, 1, 2, 3, 4, 5, 6], USER);

  // The default page reads by topic across every run: its way to the rest of
  // a topic is the topic on its own address.
  const known = await researchHtml(accountId);
  expect(known).toContain('data-testid="research-by-topic"');
  expect(known).toContain(`?topic=org"`);
  expect(known).toContain("All 4 →");
  const across = await researchHtml(accountId, { topic: "org" });
  expect(across).toContain("4 kept findings, newest first");
  for (let i = 0; i < 4; i++) expect(across).toContain(`Synthetic organisation sentence ${i}.`);
  expect(across).not.toContain("Synthetic leadership sentence 0.");

  const preview = await researchHtml(accountId, { read: noteId });
  // Inside one note, the card's way to the rest is the topic, not `all=1`.
  expect(preview).toContain(`?note=${noteId}&amp;topic=org#research-${noteId}`);
  expect(preview).toContain("View all 4");

  const topic = await researchHtml(accountId, { note: noteId, topic: "org" });
  expect(topic).toContain('data-testid="research-topic"');
  expect(topic).toContain("4 retained findings in this note");
  for (let i = 0; i < 4; i++) expect(topic).toContain(`Synthetic organisation sentence ${i}.`);
  // Reading is not adjusting: the re-review checklist stays shut.
  expect(topic).not.toContain('data-testid="research-adjust"');
  expect(topic).not.toContain('data-testid="research-rereview"');
  // `?note=` on its own still means adjusting, as it always did.
  expect(await researchHtml(accountId, { note: noteId })).toContain('data-testid="research-adjust"');
  // A topic the note has nothing under says that, rather than showing
  // somebody else's findings.
  const empty = await researchHtml(accountId, { note: noteId, topic: "risk" });
  expect(empty).toContain("keeps no findings under");
  expect(empty).not.toContain("Synthetic organisation sentence 0.");
});

it("addresses one exact finding by its stored index, and says so when it is gone", async () => {
  const { accountId, noteId } = multiTopicNote();
  acceptNote(noteId, [0, 1, 2, 3, 4, 5, 6], USER);

  const one = await researchHtml(accountId, { note: noteId, finding: "5" });
  expect(one).toContain('data-testid="research-finding"');
  expect(one).toContain("Synthetic leadership sentence 1.");
  expect(one).toContain(`id="finding-${noteId}-5"`);
  // Exactly the one asked for.
  expect(one).not.toContain("Synthetic leadership sentence 0.");
  expect(one).not.toContain('data-testid="research-adjust"');

  // Re-review drops it. The link still means finding 5, and finding 5 is no
  // longer kept: the honest answer is that it is unavailable, never the
  // finding that now sits nearby.
  acceptNote(noteId, [0, 1, 2, 3], USER);
  const gone = await researchHtml(accountId, { note: noteId, finding: "5" });
  expect(gone).toContain('data-testid="research-finding-unavailable"');
  expect(gone).toContain("no longer keeps a finding at position 6");
  expect(gone).not.toContain("Synthetic leadership sentence");
  // An index the note never had is the same honest answer, not a crash.
  expect(await researchHtml(accountId, { note: noteId, finding: "99" })).toContain('data-testid="research-finding-unavailable"');
});

it("keeps the unreviewed model paragraph behind the retained findings, and keeps it", async () => {
  const { accountId, noteId } = multiTopicNote();
  acceptNote(noteId, [0, 1, 2, 3, 4, 5, 6], USER);
  const html = await researchHtml(accountId, { read: noteId });
  const summaryAt = html.indexOf('data-testid="original-summary"');
  const dossierAt = html.indexOf('data-testid="research-dossier"');
  expect(dossierAt).toBeGreaterThan(-1);
  expect(summaryAt).toBeGreaterThan(dossierAt);
  // Still there, still whole, still labelled — one copy, behind a disclosure.
  expect(html).toContain("Model paragraph.");
  expect(html).toContain("Original model summary and sources (not reviewed)");
  expect(html.split("Model paragraph.").length - 1).toBe(1);
});

const panel = (over: Partial<ResearchPanelView> = {}) =>
  renderToStaticMarkup(
    createElement(ResearchPanel, {
      view: {
        accountId: "acc-1",
        notes: 2,
        kept: 14,
        latest: "2030-02-01",
        drafts: 0,
        pendingUpdates: 0,
        counts: Object.fromEntries(DOSSIER_TOPICS.map((t) => [t, 2])) as ResearchPanelView["counts"],
        leads: [{ noteId: "note-1", index: 4, label: "Leadership", kind: "topic", text: "Synthetic leadership fact.", url: "https://example.com/a", date: "2030-02-01", soWhat: null }],
        ...over,
      },
    }),
  );

it("previews research on the account without reprinting the research page", () => {
  const html = panel();
  expect(html).toContain("14</span> retained finding");
  expect(html).toContain("2030-02-01");
  expect(html).toContain("Synthetic leadership fact.");
  expect(html).toContain("Open research");
  // The two things that are somebody's decision are offered only when they
  // are actually waiting.
  expect(html).not.toContain("Review findings");
  expect(html).not.toContain("Review suggested updates");
  expect(panel({ drafts: 1 })).toContain("Review findings");
  expect(panel({ pendingUpdates: 2 })).toContain("Review suggested updates");
  // An account with nothing says what a run is, and offers the run.
  expect(panel({ notes: 0, kept: 0, leads: [], latest: null })).toContain("No research kept yet");
});

it("counts declined suggestions as suggestions, not as the drafts they made", async () => {
  const { declinedSuggestions } = await import("@/lib/research/updates");
  // Suggestion 0 made two drafts, suggestion 1 made one. The batch kept only
  // suggestion 1's: one suggestion was declined, not two drafts' worth.
  expect(declinedSuggestions([0, 0, 1], [2])).toBe(1);
  // Keeping either of suggestion 0's drafts means it was not declined.
  expect(declinedSuggestions([0, 0, 1], [1, 2])).toBe(0);
  expect(declinedSuggestions([0, 0, 1], [])).toBe(2);
  expect(declinedSuggestions([], [])).toBe(0);
});

it("grounds a value only where the source states it as written", async () => {
  const { statedIn } = await import("@/lib/research/updates");
  // An independent read found the first version still let a truncated
  // hyphenated name and a lower-case word stand in for an acronym, and
  // refused "C#".
  const cases: Array<[string, string, boolean]> = [
    ["Our new CTO is Jean-Luc Picard.", "Jean", false],
    ["Our new CTO is Jean-Luc Picard.", "Jean-Luc Picard", true],
    ["Mary Smith-Jones joins", "Mary Smith", false],
    ["Head of IT", "IT", true],
    ["it is what it is", "IT", false],
    ["contact us today", "US", false],
    ["growing in the US.", "US", true],
    ["Built on C# services", "C#", true],
    ["Uses C++ heavily", "C++", true],
    ["Dana Rivera's office", "Dana Rivera", true],
    ["A city.", "a", false],
  ];
  for (const [text, value, want] of cases) expect(statedIn(text, value), `${value} in ${text}`).toBe(want);
});
