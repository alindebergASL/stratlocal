import { afterEach, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { ResearchReportView } from "@/components/ResearchReportView";

// Vitest's standalone JSX transform, unlike Next's, may use classic JSX.
vi.stubGlobal("React", React);
afterEach(() => vi.unstubAllGlobals());
it("renders the entire original report as text and only safe source links", () => {
  vi.stubGlobal("React", React);
  const text = "REPORT START\n<script>window.pwned=true</script>\n" + "A detailed public finding.\n".repeat(4000) + "REPORT END";
  const html = renderToStaticMarkup(React.createElement(ResearchReportView, {text, sources: ["https://example.com/a", "http://example.com/b", "javascript:alert(1)", "https://example.com/a"]}));
  const {document} = parseHTML(html);
  expect(document.querySelector('[data-testid="research-full-report-text"]')?.textContent).toBe(text);
  expect(document.querySelector('script')).toBeNull();
  expect([...document.querySelectorAll('a')].map(a => a.getAttribute('href'))).toEqual(["https://example.com/a", "http://example.com/b"]);
  expect(document.textContent ?? html).toContain("Unreviewed original report");
});
it("retains credential-bearing source URLs as inert text, never deceptive links", () => {
  vi.stubGlobal("React", React);
  const source = "https://public.example" + "@other.example/report";
  const html = renderToStaticMarkup(React.createElement(ResearchReportView, {text: "The original report is retained.", sources: [source]}));
  const {document} = parseHTML(html);
  expect(document.querySelector('a')).toBeNull();
  expect(html).toContain(source);
  expect(html).toContain("not linked: URL contains credentials");
});
it("makes the absence of report text explicit instead of fabricating a report", () => {
  vi.stubGlobal("React", React);
  const html = renderToStaticMarkup(React.createElement(ResearchReportView, {text: "", sources: []}));
  expect(html).toContain("No report text was returned.");
});
