// What we know about this account, by topic.
//
// The count and the findings it counts used to be two blocks: a grid saying
// "Technology: 9 findings" directly above a list of forty findings you then
// had to go and find the nine in. The card carries both, so the two things
// that can now disagree are the heading and its own contents — which is the
// bounded-list lie DECISIONS #20 exists to stop: a card that says "3" over
// three rows while nine were kept.
//
// So the assertions here are mostly about that seam, plus the two properties
// that make the layout worth having at all: a topic with nothing in it still
// gets a card, and the cap never silently loses a finding.
import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { DOSSIER_TOPICS, researchCoverage } from "@/lib/research/coverage";
import { ResearchDossier } from "@/components/ResearchDossier";
import { TOPIC_LABELS, type ResearchFinding, type Topic } from "@/lib/research/schema";

const finding = (topic: ResearchFinding["topic"], n: number): ResearchFinding => ({
  topic,
  text: `Synthetic ${topic} fact ${n}.`,
  quote: `Synthetic ${topic} fact ${n}.`,
  url: `https://example.com/${topic}/${n}`,
  date: null,
  confidence: "medium",
});

function render(findings: ResearchFinding[], max?: number, moreHref = "/more") {
  const html = renderToStaticMarkup(
    createElement(ResearchDossier, { findings, coverage: researchCoverage(findings), max, moreHref }),
  );
  return { html, document: parseHTML(html).document };
}

/** The count each topic card prints in its own heading. */
function headings(document: Document) {
  const out: Record<string, string> = {};
  for (const card of document.querySelectorAll('[data-testid="research-dossier"] .grid > div')) {
    const label = card.querySelector("h4")?.textContent ?? "";
    out[label] = card.querySelector("h4 + span")?.textContent ?? "";
  }
  return out;
}

it("gives every dossier topic a card, including the ones this pass found nothing on", () => {
  // The more useful half of coverage, and the half a list of non-zero numbers
  // cannot say: we have looked and there is nothing here.
  const { document } = render([finding("technology", 1)]);
  const h = headings(document);
  for (const t of DOSSIER_TOPICS) expect(h, `${t} should have a card`).toHaveProperty(TOPIC_LABELS[t]);
  expect(h[TOPIC_LABELS.technology]).toBe("1 finding");
  expect(h[TOPIC_LABELS.leadership]).toBe("No findings in this pass");
  // "Other" is not a dossier topic; an empty card for it is a shrug.
  expect(h).not.toHaveProperty(TOPIC_LABELS.other as string);
});

it("tells the truth about Other, which no coverage count covers", () => {
  // `other` is deliberately not a dossier topic, so `researchCoverage` has no
  // count for it — and the card fell back to the number of rows it happened to
  // be showing. That is the capped number: nine findings behind a cap of three
  // read "3 findings", with no way to the rest, because the more-link is gated
  // on the count exceeding the rows.
  const findings = [
    ...Array.from({ length: 9 }, (_, i) => finding("other", i)),
    finding("org", 99),
  ];
  const { document, html } = render(findings, 4);
  expect(headings(document)[TOPIC_LABELS.other as string]).toBe("9 findings");
  expect(html).toContain("View all 9");
});

it("counts the whole topic in the heading even when the card is showing fewer", () => {
  // The heading is the count of what was kept, not of what fitted. A card
  // reading "3 findings" above three rows while nine exist is a page that
  // under-reports and looks complete doing it.
  const findings = Array.from({ length: 9 }, (_, i) => finding("technology", i));
  const { document, html } = render(findings, 3);
  expect(headings(document)[TOPIC_LABELS.technology]).toBe("9 findings");
  // Two, not three: a preview is capped per topic as well as in total, so one
  // topic cannot spend the whole page budget on itself.
  expect(document.querySelectorAll('[data-testid="research-dossier"] li')).toHaveLength(2);
  // And it says where the rest are, rather than leaving seven findings with no
  // route to them.
  expect(html).toContain("View all 9");
  // Both numbers, said once, from the whole set — so the grid cannot look like
  // the account's whole answer while being a fifth of it.
  expect(html).toContain("Showing 2 of 9 retained findings");
});

it("spends the cap across the topics rather than down them", () => {
  // The cap used to be filled in topic order, which is right for one list read
  // top to bottom and wrong for a grid: a note whose first topics hold more
  // findings than the whole budget filled those cards and left every later
  // topic printing its count over nothing.
  //
  // The fixture interleaves on purpose. Written as four org rows followed by
  // four technology rows, both allocations give the same answer, so the test
  // would pass with the old behaviour put back.
  const findings = Array.from({ length: 8 }, (_, i) => finding(i % 2 === 0 ? "org" : "technology", i));
  const { document, html } = render(findings, 6);
  const h = headings(document);
  expect(h[TOPIC_LABELS.org]).toBe("4 findings");
  expect(h[TOPIC_LABELS.technology]).toBe("4 findings");
  const rowsIn = (label: string) =>
    [...document.querySelectorAll('[data-testid="research-dossier"] .grid > div')].find((d) => d.querySelector("h4")?.textContent === label)
      ?.querySelectorAll("li").length ?? 0;
  // Two each, not four and two: every topic that has something shows
  // something, and a preview stops at two per topic even when the cap of six
  // would allow more.
  expect(rowsIn(TOPIC_LABELS.org)).toBe(2);
  expect(rowsIn(TOPIC_LABELS.technology)).toBe(2);
  expect(document.querySelectorAll('[data-testid="research-dossier"] li')).toHaveLength(4);
  expect(html).toContain("View all 4");
  // Every topic label appears exactly once, however the cap falls.
  for (const t of DOSSIER_TOPICS) {
    expect(html.split(`>${TOPIC_LABELS[t]}<`).length - 1, `${t} should be named once`).toBe(1);
  }
});

it("says nothing about a page it cannot send you to", () => {
  // A cap with no way to the rest is missing data wearing a number.
  const findings = Array.from({ length: 5 }, (_, i) => finding("risk", i));
  const html = renderToStaticMarkup(
    createElement(ResearchDossier, { findings, coverage: researchCoverage(findings), max: 2 }),
  );
  expect(html).not.toContain("View all");
  // The heading still tells the truth about how many there are.
  expect(html).toContain("5 findings");
});

it("keeps the honest words about what coverage is and is not", () => {
  const broad = DOSSIER_TOPICS.map((t, i) => finding(t as Topic, i));
  expect(render(broad).html).toContain("Broad topic coverage");
  expect(render(broad).html).toContain("not independent verification");
  const partial = render([finding("procurement", 1)]).html;
  expect(partial).toContain("Partial account research");
});

it("carries the reasons a pass was partial, which is where truncation is admitted", () => {
  const findings = DOSSIER_TOPICS.map((t, i) => finding(t as Topic, i));
  const coverage = researchCoverage(findings, { status: "partial", reasons: ["max_tokens"] });
  const html = renderToStaticMarkup(createElement(ResearchDossier, { findings, coverage }));
  expect(html).toContain("output limit");
});
