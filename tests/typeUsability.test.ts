import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { control, controlSm, buttonClass } from "@/components/ui";
import { stageTone, PLAY_TONE, DEAL_STATUS_TONE, TONE_CALLOUT } from "@/lib/tone";
import { DealTable } from "@/components/DealTable";
import { NavLinks } from "@/components/NavLinks";
import type { DealRow } from "@/lib/db";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/pipeline", useSearchParams: () => new URLSearchParams() }));
// Only the stylesheet is read as text: its rules are its contract.
const css = () => readFileSync(join(__dirname, "..", "app/globals.css"), "utf8");

describe("bounded typography and usability", () => {
  it("gives both editable control sizes a phone 16px floor and a distinct boundary", () => {
    for (const cls of [control, controlSm]) {
      expect(cls.split(" ")).toContain("text-base");
      expect(cls.split(" ")).toContain("border-control-line");
      expect(cls).not.toMatch(/(?:^| )text-(micro|label)(?: |$)/);
      expect(cls).toContain("hover:border-accent");
    }
    expect(buttonClass("quiet")).toContain("border-control-line");
    // That the notes textarea carries this rule is checked in a browser by
    // e2e/type-usability.mjs ("long-form notes are comfortable").
    expect(css()).toMatch(/\.notes-editor\s*\{\s*font-size: 1rem; line-height: 1\.625;/);
  });
  it("keeps body size and the ordered text hierarchy", () => {
    const sheet = css();
    const size = (name: string) => Number(sheet.match(new RegExp(`--text-${name}: ([0-9.]+)rem;`))?.[1]);
    expect(size("micro")).toBe(0.8125);
    expect(size("label")).toBe(0.9375);
    expect(size("body")).toBe(1);
    const sizes = ["micro", "label", "body", "lead", "heading", "title", "display"].map(size);
    expect(sizes.every((v, i) => i === 0 || v > sizes[i - 1]!)).toBe(true);
  });
  it("does not confuse stage progression with warnings or wins", () => {
    for (const stage of [null, 1, 2, 3, 4, 5, 6]) expect(["neutral", "accent"]).toContain(stageTone(stage));
    expect(PLAY_TONE.stalled).toBe("warning");
    expect(DEAL_STATUS_TONE.won).toBe("positive");
    expect(TONE_CALLOUT.warning).toContain("text-warning");
  });
  it("keeps closed rows readable without losing status and detail links", () => {
    const at = 1_790_000_000_000;
    const deal = (deal_id: string, status: DealRow["status"]): DealRow => ({
      deal_id, account_id: "synthetic-account", name: `Synthetic ${status} deal`, stage: 4, stage_label: null, close_date: "2026-12-01", fiscal_quarter: null,
      tcv_usd: 1000, competitor: null, partner: null, architecture: null, owner: null, next_step: null, notes: null, status, created_at: at, updated_at: at,
    });
    const { document } = parseHTML(renderToStaticMarkup(createElement(DealTable, { accountId: "synthetic-account", deals: [deal("SYN/OPEN 1", "open"), deal("SYN/WON 2", "won")] })));
    const rows = [...document.querySelectorAll("li")];
    expect(rows).toHaveLength(2);
    const [open, won] = rows;
    expect(won!.textContent).toContain(" · won");
    expect(open!.textContent).not.toContain(" · open");
    expect(won!.querySelector("a")?.getAttribute("href")).toBe(`/accounts/synthetic-account/deals/${encodeURIComponent("SYN/WON 2")}`);
    // A closed row is not dimmed into illegibility.
    for (const el of [won!, ...won!.querySelectorAll("*")]) expect(el.getAttribute("class") ?? "").not.toMatch(/(?:^| )opacity-/);
  });
  it("keeps the modal and scroll-target rules the browser flow relies on", () => {
    // The palette's modal lifecycle, focus restoration, Tab containment,
    // Ctrl/Cmd+K, arrow scrolling and encoded search fallback are walked in a
    // real browser by e2e/type-usability.mjs; these are the stylesheet rules
    // that flow measures.
    const sheet = css();
    expect(sheet).toContain(".command-palette::backdrop");
    expect(sheet).toContain(".command-palette input:focus");
    expect(sheet).toContain("[id] { scroll-margin-top: 1rem; }");
  });
  it("names every main destination and marks the current one", () => {
    // Where the links sit, their reachability at 320/390px and the header's
    // phone/desktop behaviour are measured by e2e/type-usability.mjs.
    const { document } = parseHTML(renderToStaticMarkup(createElement(NavLinks)));
    const nav = document.querySelector('nav[aria-label="Main"]')!;
    const links = [...nav.querySelectorAll("a")];
    // Five daily places, the same on a phone and a desktop; everything else
    // is in the More menu and ⌘K (DECISIONS #95).
    expect(links.map((a) => a.textContent)).toEqual(["Today", "Accounts", "Pipeline", "Inbox", "Ask"]);
    expect(links.filter((a) => /max-sm:hidden/.test(a.getAttribute("class") ?? ""))).toHaveLength(0);
    expect(links.filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.getAttribute("href"))).toEqual(["/pipeline"]);
    for (const a of links) expect(a.getAttribute("class") ?? "").not.toMatch(/(?:^| )hidden(?: |$)/);
  });
});
