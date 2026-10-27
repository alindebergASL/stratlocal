// Posting to a person's own Slack or Teams channel through an incoming
// webhook (DECISIONS #99). Only to hosts those services use, over https, so a
// saved URL can never point the server at anything inside the network. The
// message is plain text and one link; nothing is fetched back.
export type WebhookKind = "slack" | "teams";
export type Message = { text: string; link?: { label: string; url: string } };

const HOSTS: Record<WebhookKind, (host: string) => boolean> = {
  slack: (h) => h === "hooks.slack.com",
  // Teams' incoming webhooks: the classic connector and Workflows (Power Automate).
  teams: (h) => h.endsWith(".webhook.office.com") || h.endsWith(".logic.azure.com") || h.endsWith(".powerplatform.com"),
};

export class WebhookUrlError extends Error {}

/** The URL, if it is one this kind of webhook uses; otherwise why not. */
export function checkWebhookUrl(kind: WebhookKind, raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new WebhookUrlError("That is not a web address.");
  }
  // Tests point at a local fake server; nothing else may.
  if (process.env.NOTIFY_ALLOW_PRIVATE_URLS === "1" && url.protocol === "http:" && url.hostname === "127.0.0.1") return url;
  if (url.protocol !== "https:") throw new WebhookUrlError("A webhook address starts with https://.");
  if (!HOSTS[kind](url.hostname.toLowerCase())) {
    throw new WebhookUrlError(kind === "slack" ? "A Slack webhook address is on hooks.slack.com." : "A Teams webhook address is on webhook.office.com or a Power Automate workflow host.");
  }
  return url;
}

export function payload(kind: WebhookKind, m: Message): unknown {
  if (kind === "slack") return { text: m.link ? `${m.text}\n<${m.link.url}|${m.link.label}>` : m.text };
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          type: "AdaptiveCard",
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          version: "1.4",
          body: m.text.split("\n").map((line) => ({ type: "TextBlock", text: line, wrap: true })),
          actions: m.link ? [{ type: "Action.OpenUrl", title: m.link.label, url: m.link.url }] : [],
        },
      },
    ],
  };
}

export async function postWebhook(kind: WebhookKind, rawUrl: string, m: Message): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = checkWebhookUrl(kind, rawUrl);
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload(kind, m)), redirect: "error", signal: AbortSignal.timeout(8000) });
    // Never the response body: it can echo the URL back.
    return res.ok ? { ok: true } : { ok: false, error: `${kind === "slack" ? "Slack" : "Teams"} answered ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === "TimeoutError" ? "No answer within 8 seconds" : "Could not reach it" };
  }
}
