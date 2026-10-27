// SYNTHETIC ONLY.
//
// The top of the account Overview: the vitals strip and "Needs you". The page
// used to say the same overdue follow-up four times and keep the open
// pipeline at the bottom; these say each thing once, most urgent first.
import { describe, expect, it } from "vitest";
import { accountVitals, NEEDS_YOU_MAX, needsYou, playDealTotals } from "@/lib/accountOverview";

const now = new Date("2026-10-21T15:00:00Z");
const today = "2026-10-21";
const deal = (over: Partial<Parameters<typeof accountVitals>[0]["deals"][number]>) => ({
  deal_id: "SYN-1",
  name: "Synthetic deal",
  status: "open",
  tcv_usd: 100,
  close_date: "2026-12-01",
  fiscal_quarter: "FY27 Q2",
  next_step: null,
  ...over,
});
const meeting = (over: Partial<{ id: string; title: string; held_at: string; held_time: string | null; raw_notes: string | null; brief_json: string | null }>) => ({
  id: "m1",
  title: "Synthetic call",
  held_at: "2026-11-04",
  held_time: "10:00",
  raw_notes: null,
  brief_json: null,
  ...over,
});
const base = { accountId: "acct", today, now, followUps: [], pending: 0, planDraft: 0, meetings: [], deals: [], plays: [], researchDrafts: 0 };

describe("accountVitals", () => {
  it("counts this quarter under either spelling, and only open deals", () => {
    const v = accountVitals({
      deals: [
        deal({ deal_id: "a", tcv_usd: 100, fiscal_quarter: "FY27 Q1" }),
        deal({ deal_id: "b", tcv_usd: 50, fiscal_quarter: "FY27Q1", next_step: "Call back" }),
        deal({ deal_id: "c", tcv_usd: 25, fiscal_quarter: "FY27 Q2", close_date: "2026-11-02" }),
        deal({ deal_id: "d", tcv_usd: 999, status: "won", fiscal_quarter: "FY27 Q1" }),
      ],
      meetings: [meeting({ held_at: "2026-09-30" }), meeting({ id: "m2", held_at: "2026-10-23" })],
      today,
      quarter: "FY27 Q1",
      now,
    });
    expect(v.openPipelineUsd).toBe(175);
    expect(v.openDeals).toBe(3);
    expect(v.thisQuarter).toEqual({ label: "FY27 Q1", usd: 150, deals: 2 });
    expect(v.withNextStep).toBe(1);
    expect(v.nextClose?.dealId).toBe("c");
    expect(v.lastMeeting).toBe("2026-09-30");
  });
});

describe("needsYou", () => {
  it("is empty when nothing is due, waiting or missing", () => {
    expect(needsYou({ ...base, meetings: [meeting({})] })).toEqual([]);
  });

  it("says several due follow-ups once, naming the earliest", () => {
    const rows = needsYou({
      ...base,
      meetings: [meeting({})],
      followUps: [
        { id: "f2", text: "Send the pricing", due: "2026-10-20" },
        { id: "f1", text: "Book the workshop", due: "2026-10-15" },
        { id: "f3", text: "Later", due: "2026-11-30" },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "follow-ups", text: "Book the workshop", tone: "danger", href: "/accounts/acct/follow-ups" });
    expect(rows[0]!.detail).toBe("2 overdue · 1 more due");
  });

  it("points one due follow-up at its own page", () => {
    const [row] = needsYou({ ...base, meetings: [meeting({})], followUps: [{ id: "f1", text: "Today's thing", due: today }] });
    expect(row).toMatchObject({ href: "/follow-ups/f1", tone: "warning", detail: "due today" });
  });

  it("sends a waiting plan draft to review, never inline", () => {
    const [row] = needsYou({ ...base, meetings: [meeting({})], pending: 9, planDraft: 7 });
    expect(row).toMatchObject({ key: "review", href: "/inbox?kind=changes&account=acct" });
    expect(row!.detail).toContain("7 from the plan draft");
  });

  it("prepares a meeting this week, asks for notes after one, or says none is booked", () => {
    expect(needsYou({ ...base, meetings: [meeting({})] })).toEqual([]);
    const soon = needsYou({ ...base, meetings: [meeting({ held_at: "2026-10-22" })] });
    // A meeting tomorrow with no brief is not "nothing": it is to prepare.
    expect(soon[0]).toMatchObject({ key: "meeting", action: "Prepare", href: "/accounts/acct/meetings/m1#brief" });
    const after = needsYou({ ...base, meetings: [meeting({ held_at: "2026-10-19", held_time: "09:00" })] });
    expect(after[0]).toMatchObject({ key: "notes", href: "/accounts/acct/meetings/m1#notes" });
    const none = needsYou({ ...base, meetings: [meeting({ held_at: "2026-12-30" })] });
    expect(none[0]).toMatchObject({ key: "no-meeting" });
  });

  it("counts open deals with no next step against all open deals", () => {
    const rows = needsYou({ ...base, meetings: [meeting({})], deals: [deal({ deal_id: "a" }), deal({ deal_id: "b", next_step: "Demo" }), deal({ deal_id: "c", status: "lost" })] });
    expect(rows[0]).toMatchObject({ key: "next-steps", text: "1 of 2 open deals have no next step", href: "/accounts/acct/deals?next=none" });
  });

  it(`never shows more than ${NEEDS_YOU_MAX}, and keeps the most urgent`, () => {
    const rows = needsYou({
      ...base,
      followUps: [{ id: "f1", text: "Overdue", due: "2026-10-01" }],
      pending: 3,
      meetings: [],
      deals: [deal({})],
      plays: [{ id: "p1", title: "Synthetic play", status: "active", next_step: "x", next_step_due: "2026-10-01" }],
      researchDrafts: 2,
    });
    expect(rows.map((r) => r.key)).toEqual(["follow-ups", "review", "no-meeting", "next-steps"]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });
});

describe("playDealTotals", () => {
  it("sums open linked deals and ignores closed or unknown ids", () => {
    const totals = playDealTotals(
      [{ id: "p", deal_ids_json: JSON.stringify(["a", "b", "gone"]) }, { id: "q", deal_ids_json: "not json" }],
      [deal({ deal_id: "a", tcv_usd: 10 }), deal({ deal_id: "b", tcv_usd: 5, status: "won" })],
    );
    expect(totals.get("p")).toEqual({ usd: 10, deals: 1 });
    expect(totals.get("q")).toEqual({ usd: 0, deals: 0 });
  });
});
