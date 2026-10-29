import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ImportReportDetails, ImportSourcePreview } from "@/components/local/ImportDetails";
import type { Artifact } from "@/lib/local/store";

it("shows reported deal detail without treating missing coverage as zero or executing source markup", () => {
  const html = renderToStaticMarkup(createElement(ImportReportDetails, { report: {
    account: { name: "Synthetic College" },
    deals: [{ name: "Synthetic refresh", owner: "Synthetic owner", stage_label: "Discovery", close_date: "2026-12-01", next_step: "Validate funding", custom: "<script>alert(1)</script>" }],
  } }));
  expect(html).toContain("Validate funding");
  expect(html).toContain("Discovery");
  expect(html).toContain("not verified CRM totals");
  expect(html).toContain("does not establish that none exist");
  expect(html).not.toContain("<script>");
});

it("bounds source previews and retains navigation to full evidence and original bytes", () => {
  const source: Artifact = { id: "synthetic-source", sha256: "unused", filename: "brief.md", mime: "text/markdown", storage_path: "unused", byte_size: 15000, warnings_json: "[]", created_at: 0,
    segments_json: JSON.stringify([{label: "Stakeholders", locator: "section:1", text: "x".repeat(13000) + "TAIL_MARKER"}]) };
  const html = renderToStaticMarkup(createElement(ImportSourcePreview, {name: "brief.md", source}));
  expect(html).toContain("Preview limited");
  expect(html).not.toContain("TAIL_MARKER");
  expect(html).toContain("/evidence/synthetic-source");
  expect(html).toContain("/api/local/files/synthetic-source");
});
