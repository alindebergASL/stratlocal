// Synthetic data only. The briefing, the sealed connections, the scheduler's
// lease and the morning digest (DECISIONS #99).
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { seedAccount, USER } from "./helpers";
import { applyEntityChange } from "@/lib/proposals/apply";
import { db } from "@/lib/db";
import { open, seal, sealingReady, SecretKeyMissing } from "@/lib/crypto/secretBox";
import { checkWebhookUrl, payload } from "@/lib/notify/webhook";
import { listConnections, saveConnection, sendToPerson } from "@/lib/integrations";
import { briefingSince, buildBriefing, digestText, gatherBriefing, type BriefingInput } from "@/lib/briefing";
import { LEASE_MS, releaseLease, takeLease, tick } from "@/lib/assistants/scheduler";
import { dueForDigest, runMorningDigest } from "@/lib/assistants/morningDigest";
import { getPref, setPref } from "@/lib/prefs";
import { saveAssistant } from "@/lib/assistants/settings";

let server: Server | null = null;
const received: unknown[] = [];

beforeEach(() => {
  vi.stubEnv("INTEGRATIONS_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("NOTIFY_ALLOW_PRIVATE_URLS", "1");
  received.length = 0;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  if (server) await new Promise((r) => server!.close(r));
  server = null;
});

async function fakeHook(status = 200): Promise<string> {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push(JSON.parse(body));
      res.statusCode = status;
      res.end("ok");
    });
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/hook`;
}

it("seals a secret so only the key opens it, and refuses without a key", () => {
  const sealed = seal("https://hooks.slack.com/services/T0/B0/synthetic");
  expect(sealed).not.toContain("hooks.slack.com");
  expect(open(sealed)).toBe("https://hooks.slack.com/services/T0/B0/synthetic");
  const [v, iv, tag, body] = sealed.split(".");
  const flipped = Buffer.from(body!, "base64");
  flipped[0] = flipped[0]! ^ 1;
  expect(() => open([v, iv, tag, flipped.toString("base64")].join("."))).toThrow();
  vi.stubEnv("INTEGRATIONS_KEY", "");
  expect(sealingReady()).toBe(false);
  expect(() => seal("x")).toThrow(SecretKeyMissing);
});

it("accepts only the hosts Slack and Teams use, over https", () => {
  vi.stubEnv("NOTIFY_ALLOW_PRIVATE_URLS", "");
  expect(checkWebhookUrl("slack", "https://hooks.slack.com/services/T/B/x").hostname).toBe("hooks.slack.com");
  expect(checkWebhookUrl("teams", "https://synthetic.webhook.office.com/webhookb2/x").hostname).toBe("synthetic.webhook.office.com");
  expect(checkWebhookUrl("teams", "https://prod-01.westus.logic.azure.com/workflows/x").hostname).toContain("logic.azure.com");
  expect(() => checkWebhookUrl("slack", "http://hooks.slack.com/x")).toThrow(/https/);
  expect(() => checkWebhookUrl("slack", "https://example.test/hook")).toThrow(/hooks.slack.com/);
  expect(() => checkWebhookUrl("teams", "https://hooks.slack.com/x")).toThrow();
  expect(() => checkWebhookUrl("slack", "http://127.0.0.1:9/x")).toThrow();
  expect(payload("slack", { text: "Hi", link: { label: "Open", url: "https://app.example.test/" } })).toEqual({ text: "Hi\n<https://app.example.test/|Open>" });
  expect(JSON.stringify(payload("teams", { text: "Hi" }))).toContain("AdaptiveCard");
});

const empty: BriefingInput = { sinceMs: 0, closing: false, findings: [], partners: [], deals: [], calendar: { toAdd: 0, questions: 0 }, meetings: [], prepOn: false, overdue: 0, dueToday: 0, ready: 0, inbox: { total: 0, quick: 0 }, cleared: 0 };

it("builds the briefing from counts, and says nothing when there is nothing", () => {
  expect(buildBriefing(empty).sections).toEqual([]);
  const b = buildBriefing({
    ...empty,
    findings: [{ accountId: "a1", accountName: "Synthetic One", documentId: "d", findings: 3, touching: 0, signals: 1 }],
    deals: [{ dealId: "d1", name: "Synthetic platform", accountId: "a1", accountName: "Synthetic One", fields: ["stage"] }],
    meetings: [{ id: "m", title: "Synthetic sync", heldAt: "2026-10-26", heldTime: "10:00", inProgress: false, accountId: "a1", accountName: "Synthetic One", hasBrief: false, hasNotes: false, attendees: 2, href: "/accounts/a1/meetings/m" }],
    prepOn: true,
    overdue: 2,
    inbox: { total: 12, quick: 5 },
  });
  const text = b.sections.flatMap((s) => s.lines.map((l) => l.text));
  expect(text).toEqual(["3 new findings on 1 account", "1 deal moved", "1 meeting · briefs being prepared", "2 late", "12 waiting in your Inbox · 5 quick to accept"]);
  expect(b.sections.map((s) => s.title)).toEqual(["Since you last looked", "Today", "Waiting on you"]);
  expect(buildBriefing({ ...empty, closing: true, cleared: 4 }).sections[0]!.lines[0]!.text).toBe("4 cleared today · close the day");
  // The digest: counts only, unless names were asked for.
  const input = { ...empty, findings: [{ accountId: "a1", accountName: "Synthetic One", documentId: "d", findings: 3, touching: 0, signals: 0 }] };
  expect(digestText(buildBriefing(input), input, { names: false })).not.toContain("Synthetic One");
  expect(digestText(buildBriefing(input), input, { names: true })).toContain("Accounts: Synthetic One");
});

it("'since you last looked' holds through reloads and starts again after a gap", () => {
  const me = "synthetic-since";
  const t0 = new Date("2026-10-26T08:00:00Z");
  expect(briefingSince(me, t0, true)).toBe(t0.getTime() - 24 * 3_600_000);
  // Never more than a day back, even on a first visit.
  const later = new Date(t0.getTime() + 30 * 60_000);
  expect(briefingSince(me, later, true)).toBe(later.getTime() - 24 * 3_600_000);
  // Within a few hours of a visit, the start stays where it was.
  const soon = new Date(t0.getTime() + 60 * 60_000);
  setPref(me, "today_since", String(t0.getTime() - 3_600_000));
  expect(briefingSince(me, soon, true)).toBe(t0.getTime() - 3_600_000);
  const nextDay = new Date(t0.getTime() + 20 * 3_600_000);
  expect(briefingSince(me, nextDay, true)).toBe(soon.getTime());
});

it("counts a deal someone else moved since you looked, not your own", () => {
  const { accountId, dealId } = seedAccount({ name: "Synthetic Moves" });
  const since = Date.now() - 1000;
  applyEntityChange({ accountId, entityType: "deal", op: "update", entityId: dealId, payload: { stage: 5 }, actorUserId: "someone-else" });
  applyEntityChange({ accountId, entityType: "deal", op: "update", entityId: dealId, payload: { status: "won" }, actorUserId: USER });
  const moves = gatherBriefing(USER, new Date(), since).deals.filter((d) => d.dealId === dealId);
  expect(moves).toEqual([expect.objectContaining({ accountName: "Synthetic Moves", fields: ["stage"] })]);
});

it("one tick at a time: a held lease skips the tick until it runs out", () => {
  const at = Date.now();
  releaseLease();
  expect(takeLease(at)).toBe(true);
  expect(takeLease(at + 1000)).toBe(false);
  expect(tick(new Date(at + 1000)).skipped).toBe("busy");
  expect(takeLease(at + LEASE_MS + 1)).toBe(true);
  releaseLease();
  expect(tick(new Date(at + LEASE_MS + 2)).skipped).toBeUndefined();
});

it("sends the morning digest once a day to whoever connected and asked, and records a failure", async () => {
  const me = "synthetic-digest";
  db().prepare(`INSERT OR IGNORE INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, 'x', ?)`).run(me, "digest@example.test", "Synthetic Digest", Date.now());
  const url = await fakeHook();
  saveConnection(me, "slack", url);
  expect(listConnections(me)).toEqual([expect.objectContaining({ kind: "slack", host: "127.0.0.1" })]);
  expect(JSON.stringify(db().prepare(`SELECT * FROM integrations WHERE user_id = ?`).get(me))).not.toContain("/hook");
  const now = new Date("2026-10-26T08:00:00Z");
  expect(dueForDigest(now)).not.toContain(me);
  setPref(me, "digest_on", "1");
  expect(dueForDigest(now)).toContain(me);
  const r = runMorningDigest("schedule", null, now)!;
  await r.sending;
  expect(received.length).toBe(1);
  expect(String((received[0] as { text: string }).text)).toMatch(/^Today\n/);
  expect(getPref(me, "digest_sent_day")).toBe("2026-10-26");
  expect(dueForDigest(now)).not.toContain(me);
  expect(listConnections(me)[0]!.lastOkAt).toBeTruthy();

  // A webhook that refuses is recorded, not retried.
  await new Promise((res) => server!.close(res));
  const bad = await fakeHook(404);
  saveConnection(me, "slack", bad);
  expect(await sendToPerson(me, { text: "x" })).toEqual([{ kind: "slack", ok: false, error: "Slack answered 404" }]);
  expect(listConnections(me)[0]!.lastError).toBe("Slack answered 404");
});

it("the scheduler sends the digest only when it is on its own", () => {
  saveAssistant("morning_digest", { mode: "ask", monthlyCents: 0 }, USER);
  releaseLease();
  expect(tick(new Date("2026-10-26T08:00:00Z")).ran.some((r) => r.assistant === "morning_digest")).toBe(false);
});
