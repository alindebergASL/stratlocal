// SYNTHETIC ONLY: invented accounts, plays, findings and example.com sources.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { seedAccount, USER, type Seed } from "./helpers";
import { nextToWatch, playVocab, runAccountWatch, setWatched, terms, touches, watchDrafts, watchedAccounts, WATCH_QUESTION } from "@/lib/assistants/accountWatch";
import { onlyNewFindings, NEWS_DAYS } from "@/lib/research/run";
import { listNotes } from "@/lib/research/notes";
import { saveAssistant } from "@/lib/assistants/settings";
import { tick } from "@/lib/assistants/scheduler";
import { urlKey, WebResearchInput } from "@/lib/ai/runWebResearch";

const finding = (text: string, url = "https://www.example.com/a", date: string | null = null) => ({ text, quote: text, url, date });

describe("what touches a play, decided by shared words", () => {
  const plays = [
    { id: "p1", title: "EHR platform defense", words: terms("EHR platform defense keep the clinical records system") },
    { id: "p2", title: "Depot fleet electrification", words: terms("Depot fleet electrification charging sizing for the bus depots") },
  ];

  it("matches on a word from the play's title, or two from its thesis, and says which", () => {
    expect(touches(finding("The hospital group tendered a new EHR contract this month."), plays)).toEqual([{ playId: "p1", playTitle: "EHR platform defense", words: ["ehr"] }]);
    expect(touches(finding("A synthetic transit agency approved charging at three bus depots."), plays).map((t) => t.playId)).toEqual(["p2"]);
    expect(touches(finding("The company appointed a new chief financial officer."), plays)).toEqual([]);
  });

  it("ignores filler words that would make everything match", () => {
    expect([...terms("The company announced a new platform programme for the team this year")]).toEqual(["announced"]);
  });

  it("reads plays and their deals from the account", () => {
    const seed = seedAccount();
    const vocab = playVocab(seed.accountId);
    expect(vocab.map((p) => p.title)).toEqual(["EHR platform defense"]);
    // The linked deal's name is part of the play's vocabulary.
    expect(vocab[0]!.words.has("refresh")).toBe(true);
  });
});

describe("only what is new", () => {
  it("cuts a source shown before and anything older than the news window, and lists why", () => {
    const seen = new Set([urlKey("https://www.example.com/old")!]);
    const r = onlyNewFindings([finding("Seen", "https://www.example.com/old"), finding("Stale", "https://www.example.com/x", "2026-06-01"), finding("Fresh", "https://www.example.com/y", "2026-10-10"), finding("Undated", "https://www.example.com/z")], seen, "2026-10-21");
    expect(r.kept.map((f) => f.text)).toEqual(["Fresh", "Undated"]);
    expect(r.cut).toEqual(["Shown before: Seen", `Older than ${NEWS_DAYS} days (2026-06-01): Stale`]);
  });

  it("asks a question that carries no account data", () => {
    expect(WebResearchInput.safeParse({ companyName: "Synthetic Orchard Lab", focusQuestion: WATCH_QUESTION, depth: "standard" }).success).toBe(true);
  });
});

describe("Account watch on the clock", () => {
  let seed: Seed;
  beforeEach(() => {
    vi.stubEnv("AI_FAKE", "1");
    seed = seedAccount();
  });
  afterEach(() => vi.useRealTimers());
  const done = async () => vi.waitFor(() => expect(db().prepare("SELECT COUNT(*) AS n FROM ai_runs WHERE status = 'running'").get()).toEqual({ n: 0 }));

  it("looks only at accounts a person chose, charges its own budget, and leaves a draft to review", async () => {
    expect(runAccountWatch("manual", USER)).toMatchObject({ started: false, reason: "No account is being watched yet." });
    setWatched(seed.accountId, true, USER);
    const r = runAccountWatch("manual", USER)!;
    expect(r).toMatchObject({ started: true, accountId: seed.accountId });
    await done();
    expect(db().prepare("SELECT assistant, kind, status FROM ai_runs WHERE account_id = ?").get(seed.accountId)).toEqual({ assistant: "account_watch", kind: "research", status: "done" });
    expect(listNotes(seed.accountId, "draft")).toHaveLength(1);
    expect(watchDrafts()).toMatchObject([{ accountId: seed.accountId }]);
  });

  it("waits while a draft is unreviewed, and says nothing when there is nothing new", async () => {
    setWatched(seed.accountId, true, USER);
    runAccountWatch("manual", USER);
    await done();
    expect(runAccountWatch("manual", USER)).toMatchObject({ started: false, reason: expect.stringContaining("note waiting for review") });
    // Kept or dropped, the same sources are not news the second time.
    db().prepare("UPDATE documents SET status = 'accepted' WHERE kind = 'research_note'").run();
    runAccountWatch("manual", USER);
    await done();
    expect(listNotes(seed.accountId, "draft")).toEqual([]);
    expect((db().prepare("SELECT result_json FROM ai_runs WHERE account_id = ? ORDER BY started_at DESC LIMIT 1").get(seed.accountId) as { result_json: string }).result_json).toContain("Shown before");
  });

  it("looks at each watched account once a week, one per tick, from seven in the morning", () => {
    const other = seedAccount({ name: "Synthetic Juniper Lab", dealId: "SYN-DEAL-002" });
    setWatched(seed.accountId, true, USER);
    setWatched(other.accountId, true, USER);
    saveAssistant("account_watch", { mode: "auto", monthlyCents: 3000 }, USER);
    const at = (iso: string) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(iso));
      return new Date();
    };
    expect(tick(at("2026-10-21T13:30:00Z")).ran.filter((r) => r.assistant === "account_watch")).toEqual([]); // 06:30 local
    expect(tick(at("2026-10-21T14:05:00Z")).ran.filter((r) => r.assistant === "account_watch")).toHaveLength(1);
    // The second waits for the first account's run to end, not just for the next tick.
    db().prepare("UPDATE ai_runs SET status = 'done' WHERE status = 'running'").run();
    tick(at("2026-10-21T14:10:00Z"));
    db().prepare("UPDATE ai_runs SET status = 'done' WHERE status = 'running'").run();
    db().prepare("UPDATE documents SET status = 'accepted' WHERE kind = 'research_note'").run();
    expect(tick(at("2026-10-21T14:15:00Z")).ran.filter((r) => r.assistant === "account_watch")).toEqual([]);
    expect(nextToWatch(Date.parse("2026-10-28T15:00:00Z"))).not.toBeNull();
    expect(watchedAccounts().every((w) => w.lastLook)).toBe(true);
  });

  it("is not set off by an account archived since it was chosen", () => {
    setWatched(seed.accountId, true, USER);
    db().prepare("UPDATE accounts SET archived_at = '2026-10-20' WHERE id = ?").run(seed.accountId);
    expect(watchedAccounts()).toEqual([]);
    expect(() => setWatched(seed.accountId, true, USER)).toThrow(/current customer/);
  });
});
