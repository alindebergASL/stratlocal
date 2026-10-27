// SYNTHETIC ONLY: invented account, findings, quotes and URLs.
//
// The defect these cover is only visible on a rendered page, which is why they
// render the real ones rather than the component alone: the account page and
// the research page each drew `meta.summary` as an unqualified paragraph
// beside the findings a person had kept, so a claim somebody had just rejected
// came back as the account's own answer. The prompt path was correct
// throughout and its tests passed throughout — `researchForPrompt` never saw
// the summary — so nothing short of the markup could catch this.
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { seedAccount, USER } from "./helpers";
import { acceptNote, listNotes, researchForPrompt, storeDraftNote } from "@/lib/research/notes";

vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requirePageUser: async () => ({ id: USER, name: "Synthetic User", email: "synthetic@example.test" }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const SUMMARY = "REJECTED: the replacement project is already completed.";
const KEPT = "Retained: the replacement is a proposal only.";
const REJECTED = "The replacement project completed last year.";

function note() {
  const seed = seedAccount();
  const doc = storeDraftNote({
    accountId: seed.accountId,
    userId: USER,
    aiRunId: "synthetic-run",
    note: {
      title: "Synthetic dossier",
      summary: SUMMARY,
      open_questions: [],
      findings: [
        { text: KEPT, quote: "The board papers describe a proposal.", url: "https://example.test/a", date: null, confidence: "high", topic: "strategy" },
        { text: REJECTED, quote: "An earlier target named last year.", url: "https://example.test/b", date: null, confidence: "low", topic: "strategy" },
      ],
    },
    prose: "The original saved report, kept whole.",
    focus: null,
    depth: "standard",
    searches: 0,
    fetches: 0,
    dropped: [],
  });
  return { accountId: seed.accountId, docId: doc.id };
}

async function accountHtml(accountId: string): Promise<string> {
  const { default: AccountPage } = await import("@/app/accounts/[id]/page");
  return renderToStaticMarkup(await AccountPage({ params: Promise.resolve({ id: accountId }) }));
}

async function researchHtml(accountId: string, query: { all?: string; note?: string; read?: string } = {}): Promise<string> {
  const { default: ResearchPage } = await import("@/app/accounts/[id]/research/page");
  return renderToStaticMarkup(await ResearchPage({ params: Promise.resolve({ id: accountId }), searchParams: Promise.resolve(query) }));
}

/** The labelled block, and nothing else on the page, holds the model's prose. */
function labelled(html: string): string {
  const block = /<aside[^>]*data-testid="original-summary"[^>]*>([\s\S]*?)<\/aside>/.exec(html);
  expect(block, "the page renders the labelled original-summary block").not.toBeNull();
  return block![1]!;
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

it("labels the original summary as unreviewed on the page that holds the note, and keeps it off the account overview", async () => {
  const { accountId, docId } = note();
  acceptNote(docId, [0], USER);

  {
    const html = await researchHtml(accountId, { read: docId });
    const block = labelled(html);
    // Kept, whole, and not rewritten into a summary of what survived.
    expect(block).toContain(SUMMARY);
    expect(block).toContain("Original model summary");
    expect(block).toContain("not reviewed");
    expect(block).toContain("1 of 2 findings was kept");
    // Once, inside the label. A second unqualified copy anywhere on the page
    // is the defect itself.
    expect(occurrences(html, SUMMARY)).toBe(occurrences(block, SUMMARY));
    expect(occurrences(block, SUMMARY)).toBe(1);
    // The reviewed surface is the kept finding, and the rejected one is not on
    // the page as a finding.
    expect(html).toContain(KEPT);
    expect(html).not.toContain(REJECTED);
  }

  {
    // The account overview previews research rather than reprinting it, so the
    // model's paragraph is not there at all — which is the stronger version of
    // what the label was for. What it shows is what review kept.
    const html = await accountHtml(accountId);
    expect(occurrences(html, SUMMARY)).toBe(0);
    expect(html).not.toContain('data-testid="original-summary"');
    expect(html).toContain("retained finding");
    expect(html).toContain(KEPT);
    expect(html).not.toContain(REJECTED);
  }

  // The dossier is untouched underneath: both findings still stored, the
  // original report still readable, and the prompt still sees only what was
  // kept (the assertion that already passed while the pages were wrong).
  const stored = listNotes(accountId, "accepted")[0]!;
  expect(stored.meta.findings.map((f) => f.text)).toEqual([KEPT, REJECTED]);
  expect(stored.meta.summary).toBe(SUMMARY);
  expect(stored.doc.content_text).toBe("The original saved report, kept whole.");
  expect(researchForPrompt(accountId)).toContain(KEPT);
  expect(researchForPrompt(accountId)).not.toContain(REJECTED);
});

it("says nothing was accepted when a re-review keeps no findings, and still does not present the summary as reviewed", async () => {
  const { accountId, docId } = note();
  acceptNote(docId, [0, 1], USER);
  // Re-review: the account page used to keep the original summary on screen
  // unqualified even after every finding under it had been unticked.
  acceptNote(docId, [], USER);

  {
    const html = await researchHtml(accountId, { read: docId });
    const block = labelled(html);
    expect(block).toContain(SUMMARY);
    expect(block).toContain("Nothing in this note was accepted");
    expect(block).toContain("none of this is the reviewed answer");
    expect(occurrences(html, SUMMARY)).toBe(1);
    expect(html).not.toContain(KEPT);
    expect(html).not.toContain(REJECTED);
  }

  {
    // A note whose every finding was unticked leaves the overview with nothing
    // to preview, and it must not fall back to the model's paragraph to have
    // something to say.
    const html = await accountHtml(accountId);
    expect(occurrences(html, SUMMARY)).toBe(0);
    expect(html).not.toContain(KEPT);
    expect(html).not.toContain(REJECTED);
    expect(html).toContain("0</span> retained finding");
  }
  expect(researchForPrompt(accountId)).toBe("");
  // Nothing was deleted to achieve that.
  expect(listNotes(accountId, "accepted")[0]!.meta.findings).toHaveLength(2);
});

it("follows a re-review that changes which finding is kept", async () => {
  const { accountId, docId } = note();
  acceptNote(docId, [0], USER);
  acceptNote(docId, [1], USER);

  const html = await researchHtml(accountId, { read: docId });
  const block = labelled(html);
  expect(block).toContain("1 of 2 findings was kept");
  expect(html).toContain(REJECTED);
  expect(html).not.toContain(KEPT);
  // Still the model's paragraph, still labelled as such — the re-review
  // decided which findings are true, not who wrote the summary.
  expect(occurrences(html, SUMMARY)).toBe(1);
  expect(block).toContain(SUMMARY);
});
