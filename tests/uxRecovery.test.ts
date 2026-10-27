// The three rules this slice added: an ambiguous write is never reported as
// a refusal, a long review has controls for its selection, and a run's cost is
// legible before it is spent.
//
// The decisions are tested through the functions the components decide with,
// and the screens through what they render — statically, or mounted in
// linkedom where a reply has to arrive. The lost-reply branches themselves
// (dropped connection, 502 after a commit, an empty 200, a lost batch) are
// walked against a real server in a real browser by `e2e/ux-recovery.mjs`.
// SYNTHETIC ONLY.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { checkBulk, httpFailureOutcome, originLabel, outcomeOf, ProposalReview, reconcile, retryable, type ProposalView } from "@/components/ProposalReview";
import { NoteReview, type NoteView } from "@/app/accounts/[id]/research/NoteReview";
import { ResearchForm } from "@/app/accounts/[id]/research/ResearchForm";
import { BriefFollowUp } from "@/components/BriefFollowUp";
import type { ResearchFinding } from "@/lib/research/schema";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const dom = (html: string) => parseHTML(`<html><body>${html}</body></html>`).document;

describe("an outcome nobody knows is not reported as a refusal", () => {
  it("a refusal the server explained still says nothing was applied", () => {
    expect(httpFailureOutcome(409, { error: "changed since proposed: stage" }, "accept")).toEqual({
      kind: "error",
      message: "changed since proposed: stage The server refused this; nothing was applied.",
    });
    // NoteReview's own wording for this is checked in a browser by
    // e2e/ux-recovery.mjs ("an explained refusal says nothing was saved").
  });
});

// These run the functions the component decides with, rather than reading the
// file they live in: a regex over the source cannot tell whether a 200 with an
// empty body ends up reported as an acceptance.
describe("only a status the server actually sent decides anything", () => {
  it("reports the decisions the apply layer returns", () => {
    expect(outcomeOf("accepted", undefined, "accept")).toEqual({ kind: "accepted" });
    expect(outcomeOf("rejected", undefined, "reject")).toEqual({ kind: "rejected" });
    expect(outcomeOf("conflict", "changed since proposed: stage", "accept")).toEqual({ kind: "conflict", fields: "stage" });
    expect(outcomeOf("failed", "Account missing or archived", "accept")).toEqual({ kind: "error", message: "Account missing or archived" });
  });

  it("treats an empty, absent or unrecognised status as unknown, never as the action asked for", () => {
    for (const body of [{}, null, undefined, { status: null }, { status: "ok" }, { status: 200 }, { message: "done" }]) {
      const o = outcomeOf((body as { status?: unknown })?.status, (body as { message?: unknown })?.message, "accept");
      expect(o.kind, `${JSON.stringify(body)} was read as ${o.kind}`).toBe("unknown");
    }
    // The old code defaulted to the action, which is the false success this
    // whole state exists to prevent.
    expect(outcomeOf(undefined, undefined, "reject").kind).toBe("unknown");
  });

  it("does not read an HTTP status as proof that nothing was written", () => {
    // A commit followed by a gateway giving up, and a timeout: both unknown.
    for (const status of [500, 502, 503, 504, 408]) {
      const o = httpFailureOutcome(status, { error: "Bad gateway" }, "accept");
      expect(o.kind, `${status} was read as ${o.kind}`).toBe("unknown");
      expect(JSON.stringify(o)).not.toMatch(/Nothing was applied/);
    }
    // A 4xx the application did not explain is not a refusal either.
    expect(httpFailureOutcome(400, null, "accept").kind).toBe("unknown");
    expect(httpFailureOutcome(404, { error: "   " }, "accept").kind).toBe("unknown");
    expect(httpFailureOutcome(400, { error: "action must be accept or reject" }, "accept").kind).toBe("error");
  });

  it("reconciles only the statuses a proposal row can hold, and hands a pending row back", () => {
    expect(reconcile("accepted")).toBe("accepted");
    expect(reconcile("rejected")).toBe("rejected");
    expect(reconcile("pending")).toBe("pending");
    // The fourth status the column can hold. A decide whose reply was lost
    // after the server recorded a conflict has to be settleable by reading,
    // or the row — and the Refresh hold it placed — stays unknown for good.
    expect(reconcile("conflict")).toBe("conflict");
    for (const s of [undefined, null, "", "superseded", 7]) expect(reconcile(s)).toBe("unknown");
  });
});

describe("the origin line is read against the text it sits over", () => {
  const ai = { kind: "ai", origin: "ai_generated", quote: "Agree a technical review date before the call ends." };
  it("calls a suggestion AI-generated only while the text is the model's", () => {
    expect(originLabel({ payload: { text: "Agree a technical review date before the call ends." }, source_ref: ai })).toMatch(/^AI-generated suggestion/);
    expect(originLabel({ payload: { text: " Agree a technical review date before the call ends.  " }, source_ref: ai })).toMatch(/^AI-generated suggestion/);
  });
  it("says the wording is the person's once it is, and keeps the model's words beside it", () => {
    const label = originLabel({ payload: { text: "Book the technical review for the week of the 12th." }, source_ref: ai });
    expect(label).toMatch(/wording here is the person's/);
    expect(label).not.toMatch(/not a user-authored statement/);
  });
  it("says nothing for a user-authored proposal", () => {
    expect(originLabel({ payload: { text: "Anything" }, source_ref: { kind: "user" } })).toBeNull();
    expect(originLabel({ payload: { text: "Anything" }, source_ref: null })).toBeNull();
  });
});

describe("an explained refusal hands the decision back", () => {
  it("keeps Accept and Reject on a row the server refused with a reason, and on no other outcome", () => {
    expect(retryable(undefined)).toBe(true);
    expect(retryable(httpFailureOutcome(400, { error: "Acknowledge source review for this unverified report excerpt" }, "accept"))).toBe(true);
    for (const o of [{ kind: "accepted" }, { kind: "rejected" }, { kind: "conflict", fields: "" }, httpFailureOutcome(502, null, "accept")] as const)
      expect(retryable(o as Parameters<typeof retryable>[0]), o.kind).toBe(false);
  });
  it("renders Accept and Reject on undecided rows, and holds an unacknowledged excerpt back", () => {
    const proposal = (id: string, verification?: string): ProposalView => ({
      id, entity_type: "action_item", entity_id: null, entity_label: null, op: "create", payload: { text: `Synthetic follow-up ${id}` }, before: null, rationale: null,
      source_ref: verification ? { kind: "research_note", id: "synthetic-note", quote: "A synthetic excerpt from the generated report.", url: "https://example.test/source", verification } : { kind: "user" },
      origin_kind: "meeting",
    });
    const doc = dom(renderToStaticMarkup(createElement(ProposalReview, { accountId: "synthetic", proposals: [proposal("plain"), proposal("excerpt", "report_excerpt")] })));
    const row = (id: string) => doc.querySelector(`[data-proposal-id="${id}"]`)!;
    expect(row("plain").querySelector('[data-testid="row-accept"]')?.hasAttribute("disabled")).toBe(false);
    expect(row("plain").querySelector('[data-testid="row-reject"]')?.hasAttribute("disabled")).toBe(false);
    expect(row("plain").querySelector('input[type="checkbox"]')).toBeNull();
    // The excerpt needs its acknowledgement ticked before it, or the batch,
    // can be accepted; rejecting it needs nothing.
    expect(row("excerpt").textContent).toContain("unverified report excerpt");
    expect(row("excerpt").querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(row("excerpt").querySelector('[data-testid="row-accept"]')?.hasAttribute("disabled")).toBe(true);
    expect(row("excerpt").querySelector('[data-testid="row-reject"]')?.hasAttribute("disabled")).toBe(false);
    const all = doc.querySelector('[data-testid="accept-all"]')!;
    expect(all.textContent).toBe("Accept all 2");
    expect(all.hasAttribute("disabled")).toBe(true);
    const plainOnly = dom(renderToStaticMarkup(createElement(ProposalReview, { accountId: "synthetic", proposals: [proposal("plain")] })));
    expect(plainOnly.querySelector('[data-testid="accept-all"]')?.hasAttribute("disabled")).toBe(false);
  });
  // That an unknown outcome is settled by a fresh GET (no cache, no POST), and
  // that accept-all sends the ids on screen, are walked in e2e/ux-recovery.mjs
  // ("the recheck wrote nothing", "the recheck resolves it to what the server
  // has", "the batch reads as applied"); the route's refusal of an id-less
  // batch is tests/acceptAllRoute.test.ts.
});

describe("a batch reply has to account for the batch", () => {
  const sent = ["p1", "p2", "p3"];
  const row = (id: string, status = "accepted") => ({ id, status });

  it("accepts a complete, once-each list of known outcomes", () => {
    const r = checkBulk(sent, { outcomes: [row("p1"), row("p2", "conflict"), row("p3", "failed")] });
    expect(r.ok).toBe(true);
    expect(r.unresolved).toEqual([]);
    expect(r.valid.map((v) => v.id)).toEqual(sent);
  });

  it("keeps what was confirmed and leaves the rest unresolved", () => {
    const short = checkBulk(sent, { outcomes: [row("p1")] });
    expect(short.ok).toBe(false);
    expect(short.valid.map((v) => v.id)).toEqual(["p1"]);
    expect(short.unresolved).toEqual(["p2", "p3"]);

    for (const body of [{}, null, { outcomes: null }, "nope"]) {
      const r = checkBulk(sent, body);
      expect(r.ok).toBe(false);
      expect(r.unresolved).toEqual(sent);
    }
  });

  it("refuses a list with duplicates, strangers or statuses it cannot read", () => {
    expect(checkBulk(sent, { outcomes: [row("p1"), row("p1"), row("p2"), row("p3")] }).unresolved).toEqual(["p1"]);
    const contradictory = checkBulk(["p1"], { outcomes: [row("p1"), row("p1", "rejected")] });
    expect(contradictory.valid).toEqual([]);
    expect(contradictory.unresolved).toEqual(["p1"]);
    expect(checkBulk(sent, { outcomes: [row("p1"), row("p1"), row("p2"), row("p3")] }).ok).toBe(false);
    expect(checkBulk(sent, { outcomes: [row("p1"), row("p2"), row("p3"), row("someone-elses")] }).ok).toBe(false);
    const odd = checkBulk(sent, { outcomes: [row("p1"), row("p2"), { id: "p3", status: "maybe" }] });
    expect(odd.ok).toBe(false);
    expect(odd.unresolved).toEqual(["p3"]);
  });
});

const finding = (topic: ResearchFinding["topic"], n: number): ResearchFinding =>
  ({ topic, text: `Synthetic finding ${n}.`, quote: `Synthetic quoted evidence ${n}.`, url: `https://example.test/source-${n}`, date: "2026-09-01", confidence: "medium" }) as ResearchFinding;
const note = (over: Partial<NoteView> = {}): NoteView => ({
  id: "synthetic-note", title: "Synthetic dossier", summary: "Synthetic summary.", prose: "Synthetic report prose.", sources: ["https://example.test/source-1"],
  findings: [finding("technology", 1), finding("technology", 2), finding("leadership", 3)], openQuestions: [], generatedAt: "2026-09-02", focus: null, depth: "deep", dropped: [],
  ...over,
});
const testid = (doc: Document, id: string) => doc.querySelector(`[data-testid="${id}"]`);

describe("a long review can be selected without fifty clicks", () => {
  it("counts what is selected out of the whole, and defaults a draft to all kept", () => {
    const doc = dom(renderToStaticMarkup(createElement(NoteReview, { note: note() })));
    expect(testid(doc, "selection-count")?.textContent).toBe("3 of 3 findings selected");
    expect(doc.querySelectorAll('[data-testid="keep-finding"][checked]')).toHaveLength(3);
    expect(testid(doc, "select-all")?.hasAttribute("disabled")).toBe(true);
    expect(testid(doc, "clear-selection")?.hasAttribute("disabled")).toBe(false);
    expect(testid(doc, "note-accept")?.textContent).toBe("Accept 3 of 3");
  });

  it("starts a re-review from what was retained, with both controls live", () => {
    const doc = dom(renderToStaticMarkup(createElement(NoteReview, { note: note({ acceptedIndexes: [1] }) })));
    expect(testid(doc, "selection-count")?.textContent).toBe("1 of 3 findings selected");
    expect(testid(doc, "select-all")?.hasAttribute("disabled")).toBe(false);
    expect(testid(doc, "clear-selection")?.hasAttribute("disabled")).toBe(false);
    expect(doc.body.textContent).toContain("Nothing is saved until you press Save selections.");
  });

  it("says that ticking is not saving and not verifying", () => {
    const text = dom(renderToStaticMarkup(createElement(NoteReview, { note: note() }))).body.textContent;
    expect(text).toContain("Nothing is saved until you press Accept.");
    expect(text).toContain("Keeping a finding is not verifying it");
  });
});

describe("what a research run will spend is legible before it is spent", () => {
  const depths = { standard: { searches: 5, fetches: 4, cents: 5 }, deep: { searches: 15, fetches: 10, cents: 15 } };
  it("keeps deep as the default and names both scopes with their search cost", () => {
    const doc = dom(renderToStaticMarkup(createElement(ResearchForm, { accountId: "synthetic", depths })));
    expect(testid(doc, "research-deep")?.hasAttribute("checked")).toBe(true);
    const plan = testid(doc, "research-plan")!.textContent!.replace(/\s+/g, " ");
    expect(plan).toContain("up to 15 searches and 10 pages fetched · about $0.15");
    expect(doc.body.textContent).toContain("Untick for a quicker look: up to 5 searches and 4 pages fetched, about $0.05");
  });

  it("does not claim the search figure is the total", () => {
    const limits = testid(dom(renderToStaticMarkup(createElement(ResearchForm, { accountId: "synthetic", depths }))), "research-cost-limits")!.textContent!.replace(/\s+/g, " ");
    expect(limits).toContain("plus model use");
    expect(limits).toContain("floor, not a total");
  });
});

// Mounted, so a reply can arrive. The fetch and the server action are the
// only fakes; state, transitions and rendering are React's own.
describe("a reply the screen cannot read locks the way to write again", () => {
  let root: Root;
  let container: HTMLElement;
  beforeEach(() => {
    const { window } = parseHTML("<html><body></body></html>");
    vi.stubGlobal("window", window); vi.stubGlobal("document", window.document); vi.stubGlobal("navigator", window.navigator); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = window.document.createElement("div"); window.document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
  const q = (id: string) => container.querySelector(`[data-testid="${id}"]`);

  it("a note save answered 200 without its status is unknown, keeps the ticks and locks save and discard", async () => {
    // e2e/ux-recovery.mjs drives the dropped-connection version of this; an
    // empty 200 is the branch only a mounted component reaches.
    const fetch = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(createElement(NoteReview, { note: note({ acceptedIndexes: [0, 2] }) })));
    await act(async () => (q("note-accept") as HTMLButtonElement).click());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(q("note-unknown-outcome")?.textContent).toMatch(/Outcome unknown/);
    expect(q("note-unknown-outcome")?.textContent).not.toMatch(/Nothing was saved/);
    expect(q("note-unknown-outcome")?.textContent).toContain("Reload the page");
    expect(q("selection-count")?.textContent).toBe("2 of 3 findings selected");
    expect(q("note-accept")?.hasAttribute("disabled")).toBe(true);
    expect(q("note-discard")?.hasAttribute("disabled")).toBe(true);
    await act(async () => (q("note-accept") as HTMLButtonElement).click());
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  const plain = (id: string): ProposalView => ({
    id, entity_type: "action_item", entity_id: null, entity_label: null, op: "create", payload: { text: `Synthetic follow-up ${id}` }, before: null, rationale: null, source_ref: { kind: "user" }, origin_kind: "meeting",
  });

  it("a lost batch offers a real reload, not a refresh of the copy it cannot trust", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network"); }));
    const reload = vi.fn();
    Object.defineProperty(window, "location", { value: { reload }, configurable: true });
    await act(async () => root.render(createElement(ProposalReview, { accountId: "synthetic", proposals: [plain("a"), plain("b")], batchId: "synthetic-batch" })));
    await act(async () => (q("accept-all") as HTMLButtonElement).click());
    expect(q("accept-all-unknown")).not.toBeNull();
    await act(async () => (q("accept-all-reload") as HTMLButtonElement).click());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a recheck that finds the record changed shows the row as not applied", async () => {
    const fetch = vi.fn(async (_url: string, init?: { method?: string }) =>
      init?.method === "POST" ? new Response("", { status: 200 }) : new Response(JSON.stringify({ status: "conflict" }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(createElement(ProposalReview, { accountId: "synthetic", proposals: [plain("a")], refresh: false })));
    await act(async () => (q("row-accept") as HTMLButtonElement).click());
    expect(q("recheck-outcome")).not.toBeNull();
    await act(async () => (q("recheck-outcome") as HTMLButtonElement).click());
    const row = container.querySelector('[data-proposal-id="a"]')!;
    expect(row.textContent).toContain("not applied");
    expect(q("recheck-outcome")).toBeNull();
    // A read, never a second decision.
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("a saved brief follow-up never shows a raw user id in place of a name", async () => {
    // FormData over a linkedom form is not something Node's FormData accepts;
    // the action below ignores what it is handed.
    vi.stubGlobal("FormData", class {});
    const record = { id: "synthetic-item", text: "Send the synthetic sizing outline.", owner: null, ownerUserId: "synthetic-removed-user", due: null, archivedAt: null, evidence: [] };
    const action = vi.fn(async () => ({ ok: true, status: "created", record }));
    await act(async () => root.render(createElement(BriefFollowUp, { action, suggestion: record.text, fingerprint: "0123456789abcdef", meetingId: "synthetic-meeting", owners: [{ id: "synthetic-user", name: "Synthetic User" }], evidence: [], needsAck: false })));
    await act(async () => (q("brief-follow-up-open") as HTMLButtonElement).click());
    const form = q("brief-follow-up")!;
    await act(async () => { form.dispatchEvent(new (window as unknown as { Event: typeof Event }).Event("submit", { bubbles: true, cancelable: true })); });
    expect(action).toHaveBeenCalledTimes(1);
    const saved = q("brief-follow-up-saved")!.textContent!;
    expect(saved).toContain("Owner: one of you");
    expect(saved).not.toContain("synthetic-removed-user");
  });
});
