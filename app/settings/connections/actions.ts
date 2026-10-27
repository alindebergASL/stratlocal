"use server";
import { refresh } from "next/cache";
import { requirePageUser } from "@/lib/auth";
import { removeConnection, saveConnection, sendToPerson } from "@/lib/integrations";
import { WebhookUrlError, type WebhookKind } from "@/lib/notify/webhook";
import { SecretKeyMissing } from "@/lib/crypto/secretBox";
import { setPref } from "@/lib/prefs";
import { connectMail, disconnectMail, mailSource, readMailbox, setCanSend } from "@/lib/mail/sync";
import { MailError, type MailKind } from "@/lib/mail/types";
import { mailKinds } from "@/lib/mail/kinds";
import { runMailReader } from "@/lib/assistants/mailReader";
import { createDraft } from "@/lib/outbound/drafts";
import { OWN_WORK_ACCOUNT_ID } from "@/lib/db";

type FormResult = { ok: true } | { ok: false; error: string };
const KINDS: WebhookKind[] = ["slack", "teams"];

export async function saveConnectionAction(kind: WebhookKind, fd: FormData): Promise<FormResult> {
  const user = await requirePageUser();
  if (!KINDS.includes(kind)) return { ok: false, error: "Slack or Teams only." };
  const url = String(fd.get("url") ?? "").trim();
  if (!url) return { ok: false, error: "Paste the webhook address." };
  try {
    saveConnection(user.id, kind, url);
  } catch (e) {
    if (e instanceof WebhookUrlError || e instanceof SecretKeyMissing) return { ok: false, error: e.message };
    return { ok: false, error: "Could not save that connection." };
  }
  refresh();
  return { ok: true };
}

export async function removeConnectionAction(kind: WebhookKind): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requirePageUser();
  removeConnection(user.id, kind);
  refresh();
  return { ok: true };
}

export async function testConnectionAction(): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const user = await requirePageUser();
  const sent = await sendToPerson(user.id, { text: "Test from your account workspace: this is where your morning digest will arrive." });
  refresh();
  if (sent.length === 0) return { ok: false, error: "Nothing connected yet." };
  const bad = sent.filter((r) => !r.ok);
  return bad.length ? { ok: false, error: bad.map((r) => `${r.kind === "slack" ? "Slack" : "Teams"}: ${r.error}`).join("; ") } : { ok: true, message: "Sent. Check the channel." };
}

export async function saveDigestAction(fd: FormData): Promise<FormResult> {
  const user = await requirePageUser();
  setPref(user.id, "digest_on", fd.get("digest_on") ? "1" : "0");
  setPref(user.id, "digest_names", fd.get("digest_names") ? "1" : "0");
  refresh();
  return { ok: true };
}

export async function connectMailAction(fd: FormData): Promise<FormResult> {
  const user = await requirePageUser();
  const kind = String(fd.get("kind") ?? "");
  if (!mailKinds().includes(kind as MailKind)) return { ok: false, error: "Choose Microsoft 365 or Gmail." };
  try {
    connectMail(user.id, kind as MailKind, String(fd.get("mailbox") ?? "").trim() || user.email);
  } catch (e) {
    return { ok: false, error: e instanceof MailError ? e.message : "Could not connect that mailbox." };
  }
  refresh();
  return { ok: true };
}

export async function disconnectMailAction(): Promise<{ ok: true }> {
  const user = await requirePageUser();
  disconnectMail(user.id);
  refresh();
  return { ok: true };
}

// Reads your mailbox now, then starts reading the new threads for changes.
export async function readMailNowAction(): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const user = await requirePageUser();
  try {
    const r = await readMailbox(user.id);
    if (!r) return { ok: false, error: "Connect a mailbox first." };
    const reader = runMailReader("manual", user.id);
    refresh();
    return { ok: true, message: `${r.kept} kept, ${r.skipped} not about an account${reader ? `; ${reader.summary}` : ""}.` };
  } catch (e) {
    refresh();
    return { ok: false, error: e instanceof Error ? e.message : "Could not read the mailbox." };
  }
}

// Sending from your mailbox (DECISIONS #103): off until you turn it on.
export async function setCanSendAction(on: boolean): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const user = await requirePageUser();
  const source = mailSource(user.id);
  if (!source?.enabled) return { ok: false, error: "Connect your mailbox first." };
  setCanSend(user.id, on);
  refresh();
  return { ok: true, message: on ? "Sending is on. Nothing goes until you press Send on a draft." : "Sending is off." };
}

// A test email to yourself, to prove sending works from your mailbox before a
// customer depends on it (DECISIONS #103). It is an ordinary draft in the
// Inbox under To send: nothing goes until you press Send on it there.
export async function draftSelfTestAction(): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const user = await requirePageUser();
  const source = mailSource(user.id);
  if (!source?.enabled || !source.canSend) return { ok: false, error: "Connect your mailbox and turn sending on first." };
  try {
    createDraft({
      userId: user.id,
      accountId: OWN_WORK_ACCOUNT_ID,
      kind: "email",
      source: "manual",
      to: [{ email: source.mailbox, name: null, contactId: null, typed: true }],
      subject: "Test from Strategy",
      body: "This is a test, sent from your own mailbox after you pressed Send. If it arrived, sending works.",
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not make the test." };
  }
  refresh();
  return { ok: true, message: "A test to yourself is waiting in the Inbox under To send." };
}
