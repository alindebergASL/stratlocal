// Each person's Slack and Teams webhooks, sealed at rest (lib/crypto/secretBox.ts).
// The URL is never shown again once saved, only its host, and never logged.
import { db } from "./db";
import { open, seal } from "./crypto/secretBox";
import { checkWebhookUrl, postWebhook, type Message, type WebhookKind } from "./notify/webhook";

export type Connection = { kind: WebhookKind; host: string; lastOkAt: number | null; lastError: string | null };

export function listConnections(userId: string): Connection[] {
  return (db().prepare(`SELECT kind, host, last_ok_at, last_error FROM integrations WHERE user_id = ? ORDER BY kind`).all(userId) as Array<{ kind: WebhookKind; host: string; last_ok_at: number | null; last_error: string | null }>).map((r) => ({
    kind: r.kind,
    host: r.host,
    lastOkAt: r.last_ok_at,
    lastError: r.last_error,
  }));
}

export function saveConnection(userId: string, kind: WebhookKind, rawUrl: string): void {
  const url = checkWebhookUrl(kind, rawUrl);
  db()
    .prepare(
      `INSERT INTO integrations (user_id, kind, secret_enc, host, last_ok_at, last_error, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, ?)
       ON CONFLICT (user_id, kind) DO UPDATE SET secret_enc = excluded.secret_enc, host = excluded.host, last_ok_at = NULL, last_error = NULL, updated_at = excluded.updated_at`,
    )
    .run(userId, kind, seal(url.toString()), url.hostname, Date.now());
}

export function removeConnection(userId: string, kind: WebhookKind): void {
  db().prepare(`DELETE FROM integrations WHERE user_id = ? AND kind = ?`).run(userId, kind);
}

/** Who has anywhere to send to. */
export function connectedUsers(): string[] {
  return (db().prepare(`SELECT DISTINCT user_id FROM integrations`).all() as Array<{ user_id: string }>).map((r) => r.user_id);
}

/** Posts to every connection the person has; records how each went. */
export async function sendToPerson(userId: string, m: Message): Promise<Array<{ kind: WebhookKind; ok: boolean; error?: string }>> {
  const rows = db().prepare(`SELECT kind, secret_enc FROM integrations WHERE user_id = ?`).all(userId) as Array<{ kind: WebhookKind; secret_enc: string }>;
  const out: Array<{ kind: WebhookKind; ok: boolean; error?: string }> = [];
  for (const r of rows) {
    let result: { ok: true } | { ok: false; error: string };
    try {
      result = await postWebhook(r.kind, open(r.secret_enc), m);
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : "Could not send" };
    }
    db()
      .prepare(`UPDATE integrations SET ${result.ok ? "last_ok_at = ?, last_error = NULL" : "last_error = ?"} WHERE user_id = ? AND kind = ?`)
      .run(result.ok ? Date.now() : result.error, userId, r.kind);
    out.push(result.ok ? { kind: r.kind, ok: true } : { kind: r.kind, ok: false, error: result.error });
  }
  return out;
}
