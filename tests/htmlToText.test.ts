import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { htmlToText, looksLikeHtml } from "@/lib/import/htmlToText";

const fixture = fs.readFileSync(path.join(__dirname, "fixtures", "agent-report.html"));

describe("htmlToText", () => {
  const text = htmlToText(fixture.toString("utf8"));

  it("keeps every deal id from the opportunities table", () => {
    const ids = ["SYN-DEAL-001", "SYN-DEAL-002", "SYN-DEAL-003", "SYN-DEAL-004", "SYN-DEAL-005", "SYN-DEAL-006", "SYN-DEAL-007", "SYN-DEAL-008", "SYN-DEAL-009", "SYN-DEAL-010"];
    for (const id of ids) expect(text).toContain(id);
  });

  it("renders table rows with pipe separators and multi-line cells on one row", () => {
    const lines = text.split("\n");
    const row = lines.find((l) => l.startsWith("SYN-DEAL-001 | "));
    expect(row).toBeDefined();
    // The prose mention of the same id stays on one line with its sentence.
    expect(lines.some((l) => l.includes("Deal SYN-DEAL-001 (SyntheticOrchard_EHR-Refresh - $1K) is in Stage 3"))).toBe(true);
    expect(row).toContain("3 - Tech Validation");
    expect(row).toContain("2026-12-01 / FY27 Q2");
    expect(row).toContain("$1,000");
  });

  it("keeps all eight product family rows plus the total", () => {
    for (const f of ["Enterprise Switching", "Collaboration", "Security", "Wireless", "Compute", "Data Center Networking", "Enterprise Routing", "Observability"]) {
      expect(text.split("\n").some((l) => l.startsWith(f))).toBe(true);
    }
    expect(text).toContain("TOTAL INSTALLED BASE | $800");
  });

  it("turns header metadata into label: value lines", () => {
    expect(text).toContain("Account ID & Legal Entity: SYN-ACCOUNT-001");
    expect(text).toContain("Specialist AE (DC): Avery Example (avery.example@example.com)");
  });

  it("marks headings and drops style/script", () => {
    expect(text).toContain("## Synthetic Orchard Lab");
    expect(text).not.toContain("font-family");
  });

  it("caps output", () => {
    const big = "<html><body>" + "<p>x</p>".repeat(100_000) + "</body></html>";
    expect(htmlToText(big, 500).length).toBeLessThan(600);
  });

  it("sniffs html", () => {
    expect(looksLikeHtml(fixture)).toBe(true);
    expect(looksLikeHtml(Buffer.from("%PDF-1.4"))).toBe(false);
  });
});
