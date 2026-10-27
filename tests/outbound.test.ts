// Synthetic data only. Sending (DECISIONS #103): who a draft may go to, that
// it goes once and only when a person presses Send, what each provider is
// sent, and that an unknown outcome is never retried.
import fs from "node:fs";
import path from "node:path";
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { seedAccount, USER } from "./helpers";
import { createDraft, DraftError, discardDraft, getDraft, MAX_RECIPIENTS, reopenDraft, updateDraft } from "@/lib/outbound/drafts";
import { sendDraft, SENDS_PER_DAY } from "@/lib/outbound/send";
import { rfc2822, sendOutbound } from "@/lib/outbound/providers";
import { connectMail, setCanSend } from "@/lib/mail/sync";
import { draftChaser } from "@/lib/outbound/build";
import { icsCalendar } from "@/lib/calendar/icsWrite";

vi.mock("@/lib/calendar/providers", async (orig) => ({ ...(await orig<typeof import("@/lib/calendar/providers")>()), graphAuth: async () => "graph-token", googleAuth: async () => "google-token" }));

let server: Server | null = null;
const hits: Array<{ url: string; body: unknown }> = [];
beforeEach(() => {
  vi.stubEnv("MAIL_FAKE", "1");
  hits.length = 0;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  if (server) await new Promise((r) => server!.close(r));
  server = null;
});

async function fakeProviders(status: number): Promise<void> {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hits.push({ url: req.url ?? "", body: JSON.parse(body || "{}") });
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: "provider-1" }));
    });
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  vi.stubEnv("OUTBOUND_TEST_BASE", `http://127.0.0.1:${(server.address() as { port: number }).port}`);
}

function contact(accountId: string, id: string, name: string, email: string) {
  db().prepare(`INSERT INTO contacts (id, account_id, name, email, org, created_at, updated_at) VALUES (?, ?, ?, ?, 'customer', ?, ?)`).run(id, accountId, name, email, Date.now(), Date.now());
}

function setup(tag: string) {
  const { accountId } = seedAccount({ name: `Synthetic Send ${tag}`, dealId: `SYN-SEND-${tag}` });
  contact(accountId, `c-${tag}`, "Robin Example", `robin@${tag.toLowerCase()}.example`);
  connectMail(USER, "fake", "me@team.example");
  setCanSend(USER, true);
  return accountId;
}

it("addresses only contacts on the account, or an address the person typed", () => {
  const accountId = setup("Rules");
  const other = seedAccount({ name: "Synthetic Elsewhere Send", dealId: "SYN-SEND-OTHER" });
  contact(other.accountId, "c-other", "Not Ours", "notours@other.example");
  const d = createDraft({ userId: USER, accountId, kind: "email", source: "manual", to: [{ email: "ROBIN@rules.example", name: null, contactId: null }], subject: "Hi", body: "Body" });
  expect(d.to).toEqual([{ email: "robin@rules.example", name: "Robin Example", contactId: "c-Rules" }]);
  expect(() => createDraft({ userId: USER, accountId, kind: "email", source: "manual", to: [{ email: "notours@other.example", name: null, contactId: null }], subject: "Hi", body: "B" })).toThrow(DraftError);
  expect(createDraft({ userId: USER, accountId, kind: "email", source: "manual", to: [{ email: "typed@new.example", name: null, contactId: null, typed: true }], subject: "Hi", body: "B" }).to[0]!.typed).toBe(true);
  const many = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => ({ email: `p${i}@x.example`, name: null, contactId: null, typed: true }));
  expect(() => createDraft({ userId: USER, accountId, kind: "email", source: "manual", to: many, subject: "Hi", body: "B" })).toThrow(/At most/);
  expect(() => createDraft({ userId: USER, accountId, kind: "invite", source: "manual", to: d.to, subject: "Hi", body: "B" })).toThrow(/date and time/);
});

it("sends once, when sending is on, logs it on the account, and never twice", async () => {
  const accountId = setup("Once");
  const d = createDraft({ userId: USER, accountId, kind: "email", source: "manual", to: [{ email: "robin@once.example", name: null, contactId: null }], subject: "Synthetic next steps", body: "Hello" });
  setCanSend(USER, false);
  await expect(sendDraft(d.id, USER)).rejects.toThrow(/not on/);
  setCanSend(USER, true);
  await expect(sendDraft(d.id, "someone-else")).rejects.toThrow(/not yours/);
  const sent = await sendDraft(d.id, USER);
  expect(sent.status).toBe("sent");
  await expect(sendDraft(d.id, USER)).rejects.toThrow(/already sent/);
  expect((db().prepare(`SELECT COUNT(*) n FROM fake_outbox WHERE draft_id = ?`).get(d.id) as { n: number }).n).toBe(1);
  const log = db().prepare(`SELECT new_value FROM change_log WHERE entity_type = 'outbound' AND entity_id = ?`).get(d.id) as { new_value: string };
  expect(JSON.parse(log.new_value)).toBe("Email to Robin Example: Synthetic next steps");
  expect(() => discardDraft(d.id, USER)).toThrow(/already gone/);
});

it("stops at the daily cap", async () => {
  const accountId = setup("Cap");
  db().prepare(`UPDATE outbound_drafts SET sent_at = NULL WHERE user_id = ?`).run(USER);
  for (let i = 0; i < SENDS_PER_DAY; i++) {
    db().prepare(`INSERT INTO outbound_drafts (id, user_id, account_id, kind, source, to_json, subject, body, status, created_at, updated_at, sent_at) VALUES (?, ?, ?, 'email', 'manual', '[]', 's', 'b', 'sent', ?, ?, ?)`).run(`cap-${i}`, USER, accountId, Date.now(), Date.now(), Date.now());
  }
  const d = createDraft({ userId: USER, accountId, kind: "email", source: "manual", to: [{ email: "robin@cap.example", name: null, contactId: null }], subject: "S", body: "B" });
  await expect(sendDraft(d.id, USER)).rejects.toThrow(/a day/);
  db().prepare(`DELETE FROM outbound_drafts WHERE id LIKE 'cap-%'`).run();
});

it("sends each provider what it expects, and an unclear answer is unknown, never retried", async () => {
  const accountId = setup("Wire");
  const d = createDraft({ userId: USER, accountId, kind: "email", source: "manual", to: [{ email: "robin@wire.example", name: null, contactId: null }], subject: "Ünïcode subject", body: "Line one\nLine two" });
  await fakeProviders(202);
  expect(await sendOutbound("graph", "me@team.example", "Synthetic Me", d)).toEqual({ status: "sent", providerId: null });
  expect(hits[0]!.url).toBe("/graph/users/me%40team.example/sendMail");
  expect(hits[0]!.body).toMatchObject({ message: { subject: "Ünïcode subject", toRecipients: [{ emailAddress: { address: "robin@wire.example", name: "Robin Example" } }] }, saveToSentItems: true });
  expect(await sendOutbound("gmail", "me@team.example", "Synthetic Me", d)).toEqual({ status: "sent", providerId: "provider-1" });
  const raw = Buffer.from((hits[1]!.body as { raw: string }).raw, "base64url").toString("utf8");
  expect(raw).toContain('To: "Robin Example" <robin@wire.example>');
  expect(raw).toContain("Subject: =?UTF-8?B?");
  expect(raw).not.toMatch(/\r\nBcc:/);
  const invite = createDraft({ userId: USER, accountId, kind: "invite", source: "meeting", to: d.to, subject: "Synthetic sync", body: "Agenda", startsAt: "2026-11-02T23:45", minutes: 30 });
  await sendOutbound("gmail", "me@team.example", "", invite);
  expect(hits[2]!.url).toBe("/gcal/calendars/primary/events?sendUpdates=all");
  expect(hits[2]!.body).toMatchObject({ start: { dateTime: "2026-11-02T23:45:00" }, end: { dateTime: "2026-11-03T00:15:00" }, attendees: [{ email: "robin@wire.example" }] });
  await new Promise((r) => server!.close(r));
  hits.length = 0;
  await fakeProviders(503);
  expect((await sendOutbound("graph", "me@team.example", "", d)).status).toBe("unknown");
  await new Promise((r) => server!.close(r));
  await fakeProviders(403);
  expect((await sendOutbound("graph", "me@team.example", "", d)).status).toBe("failed");
  // One request each: an unclear answer is not tried again.
  expect(hits).toHaveLength(2);
  // A header cannot be smuggled in through a name or subject.
  expect(rfc2822({ to: [{ email: "a@b.example", name: "X\r\nBcc: evil@x.example", contactId: null }], cc: [], subject: "S\r\nBcc: evil@x.example", body: "b" }, "me@team.example")).not.toMatch(/\r\nBcc:/);
});

it("an unknown outcome stays put until the person reopens it", async () => {
  const accountId = setup("Unknown");
  const d = createDraft({ userId: USER, accountId, kind: "email", source: "manual", to: [{ email: "robin@unknown.example", name: null, contactId: null }], subject: "S", body: "B" });
  db().prepare(`UPDATE outbound_drafts SET status = 'unknown', error = 'No answer' WHERE id = ?`).run(d.id);
  await expect(sendDraft(d.id, USER)).rejects.toThrow(/not known/);
  expect(() => updateDraft(d.id, USER, { subject: "x" })).toThrow(/not known/);
  reopenDraft(d.id, USER);
  expect(getDraft(d.id)!.status).toBe("draft");
});

it("drafts a chaser to the customer who owes it, by code", () => {
  const accountId = setup("Chase");
  db().prepare(`INSERT INTO action_items (id, account_id, text, owner, due, status, created_at, updated_at) VALUES ('ai-chase', ?, 'Send the signed order form', 'Robin', '2026-11-06', 'open', 1, 1)`).run(accountId);
  const d = draftChaser("ai-chase", USER, "Synthetic Me");
  expect(d.to.map((r) => r.email)).toEqual(["robin@chase.example"]);
  expect(d.body).toContain("Hi Robin,");
  expect(d.body).toContain("send the signed order form");
  expect(d.status).toBe("draft");
});

it("only a page sends: nothing scheduled or automatic imports sendDraft", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(e.name)) files.push(full);
    }
  };
  walk(path.join(root, "app"));
  walk(path.join(root, "lib"));
  walk(path.join(root, "components"));
  const callers = files.filter((f) => /\bsendDraft\b/.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(root, f));
  expect(callers.sort()).toEqual(["app/outbound/actions.ts", "lib/outbound/send.ts"]);
});

it("escapes semicolons in a calendar file", () => {
  const ics = icsCalendar("Synthetic", [{ uid: "u1", day: "2026-11-02", title: "A; B, C" }], new Date("2026-10-26T00:00:00Z"));
  expect(ics).toContain("SUMMARY:A\\; B\\, C");
});

it("Ask drafts an email to a contact it read, and never sends it", async () => {
  vi.stubEnv("AI_FAKE", "1");
  const accountId = setup("Ask");
  const { startAsk } = await import("@/lib/ask/run");
  const { getRun } = await import("@/lib/ai/guard");
  const { runId, threadId } = startAsk({ userId: USER, question: "Email Robin the next steps", accountId });
  await vi.waitFor(() => expect(getRun(runId)?.status).toBe("done"), { timeout: 10000 });
  const drafts = db().prepare(`SELECT * FROM outbound_drafts WHERE source = 'ask' AND source_id = ?`).all(threadId) as Array<{ status: string; to_json: string }>;
  expect(drafts).toHaveLength(1);
  expect(drafts[0]!.status).toBe("draft");
  expect(JSON.parse(drafts[0]!.to_json)[0].email).toBe("robin@ask.example");
  expect((db().prepare(`SELECT COUNT(*) n FROM fake_outbox o JOIN outbound_drafts d ON d.id = o.draft_id WHERE d.source = 'ask'`).get() as { n: number }).n).toBe(0);
});
