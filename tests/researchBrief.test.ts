// Synthetic accounts, findings and focus areas only. AI_FAKE replay only.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { seedAccount, USER } from "./helpers";
import { acceptNote, listNotes, storeDraftNote } from "@/lib/research/notes";
import { readFromModel, sanitizeResearchNote } from "@/lib/research/extract";
import { buildBrief, lastLooked, type BriefItem } from "@/lib/research/brief";
import { startResearchReads, unreadKept } from "@/lib/research/reads";
import { saveDirection } from "@/lib/teamDirection";
import { getRun } from "@/lib/ai/guard";
import { readOf, type ResearchFinding } from "@/lib/research/schema";

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, name: "Synthetic User", email: "synthetic@example.test" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

beforeEach(() => {
  vi.stubEnv("AI_FAKE", "1");
  vi.stubEnv("AI_DAILY_CAP_CENTS", "10000");
});
afterEach(() => vi.unstubAllEnvs());

const AREAS = ["Synthetic agents", "Synthetic observability"];
const finding = (i: number, date: string | null = "2026-09-01"): ResearchFinding => ({ text: `Synthetic kept statement ${i}.`, quote: `Synthetic quote number ${i}.`, url: `https://example.test/page/${i}`, date, confidence: "medium", topic: "strategy" });

it("keeps only reads that name our own focus areas, and an owner only for an event", () => {
  expect(readFromModel({ signal: null, fits: ["synthetic AGENTS", "Something we do not sell"], so_what: "Why it matters." }, AREAS)).toEqual({ signal: null, owner: null, fits: ["Synthetic agents"], so_what: "Why it matters." });
  expect(readFromModel({ signal: "trigger", owner: "Someone", fits: [], so_what: "Unanchored." }, AREAS)).toEqual({ signal: "trigger", owner: null, fits: [], so_what: null });
  expect(readFromModel({ signal: "compelling_event", owner: "the CIO" }, AREAS)?.owner).toBe("the CIO");
  expect(readFromModel({ signal: "maybe" as never, fits: ["Elsewhere"] }, AREAS)).toBeNull();
});

it("keeps each read beside its own finding when an earlier finding is dropped", () => {
  const prose = "Synthetic quote number 0. Synthetic quote number 1.";
  const sources = new Map([["example.test/page/1", "https://example.test/page/1"]]);
  const { note } = sanitizeResearchNote(
    {
      title: "Synthetic",
      summary: "Synthetic.",
      open_questions: [],
      findings: [
        { ...finding(0), signal: "trigger" } as ResearchFinding,
        { ...finding(1), signal: "compelling_event", fits: ["Synthetic agents"], so_what: "It funds it." } as ResearchFinding,
      ],
    },
    prose,
    sources,
    [],
    AREAS,
  );
  expect(note.findings).toHaveLength(1);
  expect(note.findings[0]).not.toHaveProperty("signal");
  expect(note.reads).toEqual({ "0": { signal: "compelling_event", owner: null, fits: ["Synthetic agents"], so_what: "It funds it." } });
});

it("builds why now, where we fit and what changed from kept findings in code", () => {
  const at = (i: number, read: BriefItem["read"], date: string | null, acceptedAt = "2026-10-01T00:00:00Z"): BriefItem => ({ noteId: "n", index: i, finding: finding(i, date), asOf: "2026-10-01", read, acceptedAt });
  const items = [
    at(0, { signal: "compelling_event", owner: "the CIO", fits: [], so_what: null }, "2027-03-01"),
    at(1, { signal: "trigger", owner: null, fits: ["Synthetic agents"], so_what: "Talk about it." }, "2026-08-01", "2026-10-20T00:00:00Z"),
    at(2, { signal: "trigger", owner: null, fits: [], so_what: null }, "2023-01-01"),
    at(3, undefined, "2026-09-15"),
  ];
  const brief = buildBrief(items, AREAS, Date.parse("2026-10-10T00:00:00Z"), "2026-10-22");
  expect(brief.events.map((k) => k.index)).toEqual([0]);
  // A trigger years old is history, not a reason to call now.
  expect(brief.triggers.map((k) => k.index)).toEqual([1]);
  expect(brief.fit).toEqual([{ area: "Synthetic agents", items: [items[1]] }, { area: "Synthetic observability", items: [] }]);
  expect(brief.changed?.map((k) => k.index)).toEqual([1]);
  expect(buildBrief(items, AREAS, null, "2026-10-22").changed).toBeNull();
});

it("remembers the visit before this one, and a reload does not empty it", () => {
  const { accountId } = seedAccount();
  const t0 = Date.parse("2026-10-01T09:00:00Z");
  expect(lastLooked(USER, accountId, t0)).toBeNull();
  const later = t0 + 3 * 3600_000;
  expect(lastLooked(USER, accountId, later)).toBe(t0);
  expect(lastLooked(USER, accountId, later + 60_000)).toBe(t0);
});

it("reads notes kept before tagging, writes an annotation and leaves the findings as they were, then shows the brief", async () => {
  saveDirection({ focusAreas: AREAS, userId: USER, basisId: null });
  const { accountId } = seedAccount({ name: "Synthetic Brief Co" });
  const doc = storeDraftNote({ accountId, userId: USER, aiRunId: "synthetic", note: { title: "Synthetic note", summary: "S.", open_questions: [], findings: [finding(0), finding(1), finding(2), finding(3)] }, prose: "P", focus: null, depth: "standard", searches: 0, fetches: 0, dropped: [] });
  acceptNote(doc.id, [0, 1, 2], USER);
  const before = listNotes(accountId, "accepted")[0]!.meta.findings;
  expect(unreadKept(accountId)).toHaveLength(3);

  const { default: ResearchPage } = await import("@/app/accounts/[id]/research/page");
  const render = async () => parseHTML(renderToStaticMarkup(await ResearchPage({ params: Promise.resolve({ id: accountId }), searchParams: Promise.resolve({}) }))).document;
  const unreadPage = await render();
  expect(unreadPage.querySelector('[data-testid="brief-why-now-empty"]')?.textContent).toContain("Not read for this yet");
  expect(unreadPage.querySelector('[data-testid="brief-read"]')?.textContent).toContain("3 kept findings have not been read");

  const runId = startResearchReads(accountId, USER);
  await vi.waitFor(() => expect(getRun(runId)?.status).toBe("done"));
  const note = listNotes(accountId, "accepted")[0]!;
  expect(note.meta.findings).toEqual(before);
  expect(note.meta.read_at).toBeTruthy();
  expect(readOf(note.meta, 0)).toMatchObject({ signal: "compelling_event", owner: "the CIO", fits: ["Synthetic agents"] });
  expect(readOf(note.meta, 3)).toBeUndefined();
  expect(unreadKept(accountId)).toHaveLength(0);
  expect(() => startResearchReads(accountId, USER)).toThrow(/already been read/);

  const page = await render();
  expect([...page.querySelectorAll('[data-testid="brief-why-now"] [data-testid="brief-line"]')].map((l) => l.textContent)).toEqual([
    expect.stringContaining("Compelling eventSynthetic kept statement 0."),
    expect.stringContaining("TriggerSynthetic kept statement 1."),
  ]);
  expect(page.querySelector('[data-testid="brief-fit"]')?.textContent).toContain("So what: This gives a reason to raise Synthetic agents.");
  expect(page.querySelector('[data-testid="brief-fit-gaps"]')?.textContent).toContain("Synthetic observability");
  expect(page.querySelector('[data-testid="brief-read"]')).toBeNull();
});
