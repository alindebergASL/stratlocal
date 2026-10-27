import { expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { readFileSync } from "node:fs";
import { Card, Section } from "@/components/ui";
import { DisclosureSection } from "@/components/OpenOnHash";
import { ResearchDossier } from "@/components/ResearchDossier";
import { researchCoverage } from "@/lib/research/coverage";

it("gives section headings an explicit zone without promoting nested evidence", () => {
  const child = h("details", null, h("summary", null, "Evidence"), "Complete evidence");
  const doc = parseHTML(renderToStaticMarkup(h(Section, { title: "Work", id: "work", empty: true, children: child }))).document;
  expect(doc.querySelector("#work")?.className).toContain("border-line");
  expect(doc.querySelector("#work")?.className).toContain("section-empty");
  expect(doc.querySelectorAll(".section-heading")).toHaveLength(1);
  expect(doc.querySelector(".section-heading h2")?.textContent).toBe("Work");
  expect(doc.querySelector("details")?.hasAttribute("open")).toBe(false);
  expect(doc.querySelector("summary")?.className).toBe("");
  expect(renderToStaticMarkup(h(Card, { children: "Plain" }))).not.toContain("section-heading");
});

it("keeps native section disclosure behavior and all controls", () => {
  const doc = parseHTML(renderToStaticMarkup(h(DisclosureSection, { id: "extra", title: "Details", aside: h("button", null, "Add"), children: "All details" }))).document;
  expect(doc.querySelector("details")?.hasAttribute("open")).toBe(false);
  expect(doc.querySelector("details > summary.section-heading")?.textContent).toBe("Details");
  expect(doc.querySelector("button")?.textContent).toBe("Add");
  expect(doc.querySelector("details")?.textContent).toContain("All details");
});

it("bounds reading topics once, preserving plain findings, dates, counts and exact links", () => {
  const findings = [0, 1].map(i => ({ topic: "technology" as const, text: `Synthetic fact ${i}.`, quote: "Synthetic evidence.", url: "https://example.test/source", date: "2026-09-01", confidence: "medium" as const }));
  const href = "/accounts/synthetic/research?note=original&finding=7#finding-original-7";
  const doc = parseHTML(renderToStaticMarkup(h(ResearchDossier, { reading: true, findings, coverage: researchCoverage(findings), max: 10, findingHref: () => href }))).document;
  expect(doc.querySelectorAll(".research-topic")).toHaveLength(1);
  expect(doc.querySelector(".research-topic-heading h3")?.textContent).toBe("Technology");
  expect(doc.querySelector(".research-topic-heading span")?.textContent).toBe("2 findings");
  expect(doc.querySelectorAll(".research-topic li")).toHaveLength(2);
  expect(doc.querySelectorAll("li .research-topic, li .section-heading")).toHaveLength(0);
  expect(doc.querySelector(".grid")?.className).toContain("md:grid-cols-2");
  expect([...doc.querySelectorAll("a")].some(a => a.getAttribute("href") === href)).toBe(true);
  expect(doc.toString()).toContain("2026-09-01");
  expect(doc.toString()).toContain("Synthetic evidence.");
});

it("uses quiet component-scoped section labels", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const zone = css.match(/\.section-heading \{([^}]+)\}/)?.[1] ?? "";
  // A label with a hairline, not a shaded bar: the overhaul's calmer chrome.
  expect(zone).toContain("background: transparent");
  expect(zone).toContain("var(--color-line)");
  expect(zone).not.toContain("border-left");
  expect(zone).not.toMatch(/warning|accent|violet/);
  expect(css).toContain(".research-topic > .research-topic-heading");
  // A 16px base (DECISIONS #95): the 15px one read as dense.
  expect(css).toContain("--text-body: 1rem");
});
