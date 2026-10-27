// Synthetic data only. Reading email (DECISIONS #102): what is kept, what is
// never stored, what it may propose, and that a hostile email moves nothing.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getRun } from "@/lib/ai/guard";
import { seedAccount, USER } from "./helpers";
import { accountMail, connectMail, purgeMailBodies, readMailbox, storeMail, threadsToRead } from "@/lib/mail/sync";
import { runMailReader } from "@/lib/assistants/mailReader";
import { listPendingProposals } from "@/lib/queries/accounts";
import { toProposalViews } from "@/lib/proposals/view";
import { isLowRisk } from "@/lib/changeDeck";
import { fromGmailMessage, parseAddresses } from "@/lib/mail/providers/gmail";
import { fromGraphMessage } from "@/lib/mail/providers/graph";
import { htmlToText } from "@/lib/mail/types";

beforeEach(() => {
  vi.stubEnv("AI_FAKE", "1");
  vi.stubEnv("MAIL_FAKE", "1");
});
afterEach(() => vi.unstubAllEnvs());

function contact(accountId: string, id: string, name: string, email: string) {
  db().prepare(`INSERT INTO contacts (id, account_id, name, email, org, created_at, updated_at) VALUES (?, ?, ?, ?, 'customer', ?, ?)`).run(id, accountId, name, email, Date.now(), Date.now());
}

it("keeps only mail that matches one account, never internal mail or newsletters", () => {
  const { accountId } = seedAccount({ name: "Synthetic Mail Kept", dealId: "SYN-MAIL-K" });
  contact(accountId, "c-kept", "Synthetic Kept Person", "kept@kept-customer.example");
  const me = "me@team.example";
  const now = Date.now();
  const msg = (id: string, from: string, to = me) => ({ id, thread: `t-${id}`, from: { email: from, name: null }, to: [{ email: to, name: null }], cc: [], subject: `S ${id}`, receivedAt: now - 1000, body: "Body text here." });
  const r = storeMail(USER, me, [msg("a", "kept@kept-customer.example"), msg("b", "someone@kept-customer.example"), msg("c", "news@newsletter.example"), msg("d", "colleague@team.example")], now);
  expect(r).toEqual({ kept: 2, skipped: 2 });
  expect(accountMail(accountId).map((m) => m.provider_id).sort()).toEqual(["a", "b"]);
  expect(db().prepare(`SELECT COUNT(*) n FROM mail_messages WHERE provider_id IN ('c','d')`).get()).toEqual({ n: 0 });
  // Reading the same mail again keeps nothing twice.
  expect(storeMail(USER, me, [msg("a", "kept@kept-customer.example")], now).kept).toBe(0);
  // Bodies go after 30 days; who, when and what about stay.
  db().prepare(`UPDATE mail_messages SET received_at = ? WHERE provider_id = 'a'`).run(now - 31 * 86400_000);
  expect(purgeMailBodies(now)).toBe(1);
  const a = accountMail(accountId).find((m) => m.provider_id === "a")!;
  expect(a.body_text).toBeNull();
  expect(a.subject).toBe("S a");
});

it("turns what an email agreed into changes to read one at a time, and a hostile email moves nothing", async () => {
  const { accountId } = seedAccount({ name: "Synthetic Mail Read", dealId: "SYN-MAIL-R" });
  contact(accountId, "c-read", "Synthetic Reader", "reader@read-customer.example");
  const stageBefore = (db().prepare(`SELECT stage, status, tcv_usd FROM deals WHERE deal_id = 'SYN-MAIL-R'`).get());
  connectMail(USER, "fake", "me@team.example");
  const read = await readMailbox(USER);
  expect(read!.kept).toBeGreaterThanOrEqual(2);
  expect(threadsToRead().some((t) => t.accountId === accountId)).toBe(true);
  const r = runMailReader("manual", USER)!;
  expect(r.summary).toMatch(/being read/);
  await vi.waitFor(() => expect(db().prepare(`SELECT COUNT(*) n FROM ai_runs WHERE kind = 'mail_extract' AND status = 'running'`).get()).toEqual({ n: 0 }), { timeout: 10000 });
  const run = db().prepare(`SELECT id FROM ai_runs WHERE kind = 'mail_extract' AND account_id = ?`).get(accountId) as { id: string };
  expect(getRun(run.id)?.status).toBe("done");
  const pending = listPendingProposals(accountId).filter((p) => p.origin_id?.startsWith("mail:"));
  expect(pending.length).toBeGreaterThan(0);
  for (const p of pending) {
    const payload = JSON.parse(p.payload_json);
    if (p.entity_type === "deal") expect(Object.keys(payload), "an email may only set a deal's next step").toEqual(["next_step"]);
    expect(["action_item", "deal", "contact"]).toContain(p.entity_type);
    expect(JSON.parse(p.source_ref_json!).kind).toBe("mail");
  }
  expect(toProposalViews(accountId, pending).some(isLowRisk)).toBe(false);
  expect(db().prepare(`SELECT stage, status, tcv_usd FROM deals WHERE deal_id = 'SYN-MAIL-R'`).get()).toEqual(stageBefore);
  // Read once: nothing left to read on the next tick.
  expect(threadsToRead().some((t) => t.accountId === accountId)).toBe(false);
});

it("reads both providers' shapes into the same message", () => {
  expect(parseAddresses('"Synthetic, Person" <A@Example.test>, b@example.test')).toEqual([{ email: "a@example.test", name: "Synthetic, Person" }, { email: "b@example.test", name: null }]);
  const data = Buffer.from("Hello from Gmail").toString("base64url");
  const g = fromGmailMessage({ id: "g1", threadId: "th", internalDate: "1700000000000", payload: { headers: [{ name: "From", value: "X <x@example.test>" }, { name: "Subject", value: "Hi" }, { name: "To", value: "me@team.example" }], mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data } }] } })!;
  expect(g).toMatchObject({ id: "g1", thread: "th", subject: "Hi", body: "Hello from Gmail", from: { email: "x@example.test" } });
  const o = fromGraphMessage({ id: "o1", conversationId: "c1", subject: "Re", receivedDateTime: "2026-10-20T10:00:00Z", from: { emailAddress: { address: "Y@Example.test", name: "Y" } }, body: { contentType: "html", content: "<p>Hi&nbsp;there</p><script>x()</script>" } })!;
  expect(o).toMatchObject({ thread: "c1", from: { email: "y@example.test" }, body: "Hi there" });
  expect(htmlToText("<div>a</div><div>b</div>")).toBe("a\nb");
});
