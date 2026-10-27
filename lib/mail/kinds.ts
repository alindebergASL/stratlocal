// Which mail providers this server can read: configured in its environment
// (lib/calendar/providers.ts), or the synthetic one under MAIL_FAKE.
import { googleConfigured, graphConfigured } from "../calendar/providers";
import { fakeMailEnabled } from "./providers/fake";
import type { MailKind } from "./types";

export const MAIL_KIND_LABEL: Record<MailKind, string> = { graph: "Microsoft 365", gmail: "Gmail", fake: "Synthetic mail (test)" };

export function mailKinds(): MailKind[] {
  return [...(graphConfigured() ? [] : (["graph"] as const)), ...(googleConfigured() ? [] : (["gmail"] as const)), ...(fakeMailEnabled() ? (["fake"] as const) : [])];
}
