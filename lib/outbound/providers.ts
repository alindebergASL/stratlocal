// The send itself, per provider (DECISIONS #103). Each answers one of three
// ways: sent (with the provider's id), failed (the provider refused it, so
// nothing went), or unknown (no answer: it may have gone). An unknown outcome
// is never retried here or anywhere else.
import { db } from "../db";
import { newId } from "../ids";
import { appTimeZone } from "../clock";
import { googleAuth, graphAuth } from "../calendar/providers";
import type { MailKind } from "../mail/types";
import type { OutboundDraft, Recipient } from "./drafts";

export type SendOutcome = { status: "sent"; providerId: string | null } | { status: "failed" | "unknown"; error: string };

const GRAPH = "https://graph.microsoft.com/v1.0";
const GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send";
const CAL_EVENTS = "https://www.googleapis.com/auth/calendar.events";

// Tests point these at a fake server on loopback; nothing else may.
const base = (name: "GRAPH" | "GMAIL" | "GCAL", real: string) => (process.env.OUTBOUND_TEST_BASE ? `${process.env.OUTBOUND_TEST_BASE}/${name.toLowerCase()}` : real);

const addr = (r: Recipient) => (r.name ? `"${r.name.replace(/["\\\r\n]/g, "")}" <${r.email}>` : r.email);

/** A plain-text RFC 2822 message, for Gmail. Headers are encoded so a name or subject cannot add a header. */
export function rfc2822(d: Pick<OutboundDraft, "to" | "cc" | "subject" | "body">, from: string): string {
  const enc = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
  const clean = (s: string) => s.replace(/[\r\n]+/g, " ");
  const lines = [
    `From: ${clean(from)}`,
    `To: ${d.to.map(addr).map(clean).join(", ")}`,
    ...(d.cc.length ? [`Cc: ${d.cc.map(addr).map(clean).join(", ")}`] : []),
    `Subject: ${enc(clean(d.subject))}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(d.body, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n"),
  ];
  return lines.join("\r\n");
}

async function post(url: string, token: string, body: unknown): Promise<SendOutcome & { json?: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(30_000) });
  } catch {
    // The request may have reached them: never assume it did not.
    return { status: "unknown", error: "No answer from the mail provider" };
  }
  if (res.status >= 500) return { status: "unknown", error: `The mail provider answered ${res.status}` };
  if (!res.ok) return { status: "failed", error: `The mail provider refused it (${res.status})` };
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: "sent", providerId: typeof json.id === "string" ? json.id : null, json };
}

async function token(get: () => Promise<string>): Promise<string | SendOutcome> {
  try {
    return await get();
  } catch (e) {
    // Nothing was sent: signing in failed.
    return { status: "failed", error: e instanceof Error ? e.message : "Could not sign in to the mail provider" };
  }
}

const people = (list: Recipient[]) => list.map((r) => ({ emailAddress: { address: r.email, ...(r.name ? { name: r.name } : {}) } }));

function endOf(startsAt: string, minutes: number): string {
  const [d, t] = startsAt.split("T") as [string, string];
  const [h, m] = t.split(":").map(Number) as [number, number];
  const total = h * 60 + m + minutes;
  const day = new Date(`${d}T00:00:00Z`);
  day.setUTCMinutes(total);
  return day.toISOString().slice(0, 16);
}

export async function sendOutbound(kind: MailKind, mailbox: string, fromName: string, d: OutboundDraft): Promise<SendOutcome> {
  if (kind === "fake") {
    const id = newId();
    db().prepare(`INSERT INTO fake_outbox (id, draft_id, payload, created_at) VALUES (?, ?, ?, ?)`).run(id, d.id, JSON.stringify({ from: mailbox, kind: d.kind, to: d.to.map((r) => r.email), cc: d.cc.map((r) => r.email), subject: d.subject, body: d.body, startsAt: d.startsAt, minutes: d.minutes }), Date.now());
    return { status: "sent", providerId: `fake-${id}` };
  }
  const zone = appTimeZone();
  if (kind === "graph") {
    const t = await token(graphAuth);
    if (typeof t !== "string") return t;
    const box = encodeURIComponent(mailbox);
    if (d.kind === "email") {
      const r = await post(`${base("GRAPH", GRAPH)}/users/${box}/sendMail`, t, { message: { subject: d.subject, body: { contentType: "Text", content: d.body }, toRecipients: people(d.to), ccRecipients: people(d.cc) }, saveToSentItems: true });
      return r.status === "sent" ? { status: "sent", providerId: null } : r;
    }
    const r = await post(`${base("GRAPH", GRAPH)}/users/${box}/events`, t, {
      subject: d.subject,
      body: { contentType: "Text", content: d.body },
      start: { dateTime: `${d.startsAt}:00`, timeZone: zone },
      end: { dateTime: `${endOf(d.startsAt!, d.minutes ?? 30)}:00`, timeZone: zone },
      ...(d.location ? { location: { displayName: d.location } } : {}),
      attendees: d.to.map((p) => ({ ...people([p])[0], type: "required" })),
    });
    return r.status === "sent" ? { status: "sent", providerId: r.providerId } : r;
  }
  // Gmail and Google Calendar, as the person (domain-wide delegation).
  if (d.kind === "email") {
    const t = await token(() => googleAuth(GMAIL_SEND, mailbox));
    if (typeof t !== "string") return t;
    const raw = Buffer.from(rfc2822(d, fromName ? `"${fromName}" <${mailbox}>` : mailbox)).toString("base64url");
    const r = await post(`${base("GMAIL", "https://gmail.googleapis.com/gmail/v1")}/users/${encodeURIComponent(mailbox)}/messages/send`, t, { raw });
    return r.status === "sent" ? { status: "sent", providerId: r.providerId } : r;
  }
  const t = await token(() => googleAuth(CAL_EVENTS, mailbox));
  if (typeof t !== "string") return t;
  const r = await post(`${base("GCAL", "https://www.googleapis.com/calendar/v3")}/calendars/primary/events?sendUpdates=all`, t, {
    summary: d.subject,
    description: d.body,
    start: { dateTime: `${d.startsAt}:00`, timeZone: zone },
    end: { dateTime: `${endOf(d.startsAt!, d.minutes ?? 30)}:00`, timeZone: zone },
    ...(d.location ? { location: d.location } : {}),
    attendees: d.to.map((p) => ({ email: p.email, ...(p.name ? { displayName: p.name } : {}) })),
  });
  return r.status === "sent" ? { status: "sent", providerId: r.providerId } : r;
}
