import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { DisclosureSection, revealHash } from "@/components/OpenOnHash";
import { ResearchPanel, type ResearchPanelView } from "@/app/accounts/[id]/ResearchPanel";
import { overviewLeads, type BriefItem } from "@/lib/research/brief";

it("opens only the target disclosure and its ancestors, including a repeated nested hash", () => {
  const { document } = parseHTML('<html><body><details id="deals"><summary>Deals</summary><details id="closed"><summary>Closed</summary><p id="deal space">Record</p></details></details><details id="people"><summary>People</summary></details></body></html>');
  const root = document as unknown as Document;
  expect(revealHash("#deal%20space", root)?.id).toBe("deal space");
  expect(document.querySelector("#deals")?.hasAttribute("open")).toBe(true);
  expect(document.querySelector("#closed")?.hasAttribute("open")).toBe(true);
  expect(document.querySelector("#people")?.hasAttribute("open")).toBe(false);
  document.querySelector("#deals")!.removeAttribute("open");
  revealHash("#deal%20space", root);
  expect(document.querySelector("#deals")?.hasAttribute("open")).toBe(true);
  expect(revealHash("#missing", root)).toBeNull();
  expect(revealHash("#%invalid", root)).toBeNull();
  revealHash("#people", root);
  expect(document.querySelector("#people")?.hasAttribute("open")).toBe(true);
});

it("renders a closed native disclosure while preserving its controls", () => {
  const html = renderToStaticMarkup(createElement(DisclosureSection, { id: "people", title: "People", children: createElement("button", { "data-testid": "contact-new-open" }, "Add person") }));
  const { document } = parseHTML(html);
  expect(document.querySelector("details")?.hasAttribute("open")).toBe(false);
  expect(document.querySelector("details > summary")?.textContent).toBe("People");
  expect(document.querySelector('[data-testid="contact-new-open"]')).not.toBeNull();
});

it("shows the chosen leads, full counts, date, review actions and the verification warning", () => {
  const view: ResearchPanelView = {
    accountId: "synthetic", notes: 2, kept: 102, latest: "2026-09-22", drafts: 1, pendingUpdates: 2,
    counts: {} as ResearchPanelView["counts"],
    leads: [0, 2, 3].map((i) => ({ noteId: "note", index: i, label: ["Compelling event", "Synthetic agents", "Strategy"][i === 0 ? 0 : i - 1]!, kind: i === 0 ? "why" as const : i === 2 ? "fit" as const : "topic" as const, text: `Synthetic finding ${i}`, url: "https://example.com", date: "2026-09-01", soWhat: i === 2 ? "Why it matters." : null })),
    entity: { name: "Synthetic Org", domain: "synthetic.example" },
    today: "2026-10-22",
  };
  const html = renderToStaticMarkup(createElement(ResearchPanel, { view }));
  const { document } = parseHTML(html);
  expect(document.querySelectorAll('[data-testid="research-panel-recent"] li')).toHaveLength(3);
  expect(Array.from(document.querySelectorAll('[data-testid="research-panel-recent"] a')).map(a => a.getAttribute('href'))).toEqual([0, 2, 3].map(i => `/accounts/synthetic/research?note=note&finding=${i}#finding-note-${i}`));
  expect(document.querySelectorAll('[data-testid="research-panel-recent"] p a')).toHaveLength(0);
  expect(document.querySelector('[data-testid="research-panel-recent"] a')?.getAttribute("href")).toBe("/accounts/synthetic/research?note=note&finding=0#finding-note-0");
  expect(document.querySelector('[data-testid="research-panel-counts"]')?.textContent).toBe("102 retained findings across 2 notes");
  expect(document.querySelector('[data-testid="research-panel-latest"]')?.textContent).toBe("Latest note: 2026-09-22");
  expect(document.querySelector('[data-testid="research-panel-latest"]')?.classList.contains("whitespace-nowrap")).toBe(true);
  expect(document.querySelector("h2")?.textContent).toBe("What we know");
  expect(html).toContain("not independently verified");
  expect(document.querySelector('[data-testid="research-review-findings"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="research-review-updates"]')).not.toBeNull();
  expect(document.querySelectorAll('[data-testid="research-open"]')).toHaveLength(1);
  expect(html).not.toContain("Synthetic finding 1");
  expect(document.querySelector('[data-testid="research-panel-entity"]')?.textContent).toBe("Researched as Synthetic Org · synthetic.example");
  expect(document.querySelector('[data-lead="fit"]')?.textContent).toContain("So what: Why it matters.");
  expect(document.querySelectorAll('[data-testid="source-kind"]')).toHaveLength(3);
});

it("leads with a reason to act, then where we fit, then the newest by topic, never repeating", () => {
  const item = (i: number, topic: "technology" | "strategy" | "leadership", read?: BriefItem["read"], date = "2026-09-01"): BriefItem => ({ noteId: "n", index: i, finding: { text: `F${i}`, quote: "q".repeat(8), url: "https://example.test", confidence: "medium", date, topic }, asOf: "2026-09-02", read });
  const items = [
    item(0, "technology", undefined, "2026-10-01"),
    item(1, "technology", { signal: "trigger", owner: null, fits: ["Synthetic agents"], so_what: "S." }),
    item(2, "strategy", { signal: null, owner: null, fits: ["Synthetic agents"], so_what: "T." }),
    item(3, "leadership"),
  ];
  const leads = overviewLeads(items, ["Synthetic agents"], "2026-10-22");
  expect(leads.map((l) => [l.label, l.item.index])).toEqual([["Trigger", 1], ["Synthetic agents", 2], ["Technology", 0]]);
  // Nothing read: the newest finding of each topic.
  expect(overviewLeads(items.map((i) => ({ ...i, read: undefined })), [], "2026-10-22").map((l) => l.label)).toEqual(["Technology", "Strategy", "Leadership"]);
  expect(overviewLeads([], [], "2026-10-22")).toEqual([]);
});

it.each([0, 1])("keeps zero-retained draft and pending actions with %i accepted notes", notes => {
  const view: ResearchPanelView = { accountId: "synthetic", notes, kept: 0, latest: null, drafts: 1, pendingUpdates: 2, counts: {} as ResearchPanelView["counts"], leads: [] };
  const { document } = parseHTML(renderToStaticMarkup(createElement(ResearchPanel, { view })));
  // With nothing kept, the draft is the next step: no second "Run research"
  // beside it, which would replace it.
  expect(document.querySelectorAll('[data-testid="research-open"]')).toHaveLength(notes ? 1 : 0);
  if (notes) expect(document.querySelector('[data-testid="research-open"]')?.textContent).toBe("Open research");
  expect(document.querySelector('[data-testid="research-review-findings"]')?.getAttribute("href")).toBe("/accounts/synthetic/research#research-review");
  expect(document.querySelector('[data-testid="research-review-updates"]')?.getAttribute("href")).toBe("/inbox?kind=changes&account=synthetic");
  expect(document.querySelector('[data-testid="research-panel-recent"]')).toBeNull();
  expect(document.querySelector('[data-testid="research-panel-latest"]')).toBeNull();
  if (notes) expect(document.querySelector('[data-testid="research-panel-counts"]')?.textContent).toBe("0 retained findings across 1 note");
  view.drafts = 0; view.pendingUpdates = 0;
  const empty = renderToStaticMarkup(createElement(ResearchPanel, { view }));
  expect(empty).not.toContain('research-review-findings');
  expect(empty).not.toContain('research-review-updates');
});
