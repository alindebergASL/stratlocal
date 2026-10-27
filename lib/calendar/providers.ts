// Every calendar behind one small interface: read the window, and, where the
// provider can push, start, renew and stop a watch. A watch only ever says
// "something changed"; the app then reads the window itself, so a forged
// call can cause a read but cannot put anything in (DECISIONS #42).
//
// Microsoft Graph and Google are read with the app's own credentials from the
// environment: an Entra app registration restricted to Strategy's mailbox,
// and a Google service account that sees only calendars shared with it.
import { createSign, randomUUID } from "node:crypto";
import { appTimeZone } from "../clock";
import { parseIcs } from "./ics";
import { fetchFeed } from "./fetchSafe";
import type { CalEvent, CalPerson, SyncWindow } from "./types";
import { appDayTime, wallToInstant } from "./zones";

export type SourceKind = "ics" | "graph" | "google";
export type SourceConfig = { url?: string; mailbox?: string; calendarId?: string };
export type Watch = { id: string; expiresAt: number };

export interface CalendarProvider {
  read(config: SourceConfig, window: SyncWindow): Promise<{ events: CalEvent[]; skipped: number }>;
  startWatch?(config: SourceConfig, hookUrl: string, secret: string): Promise<Watch>;
  renewWatch?(config: SourceConfig, watch: Watch, hookUrl: string, secret: string): Promise<Watch>;
  stopWatch?(config: SourceConfig, watchId: string): Promise<void>;
}

export class ProviderError extends Error {}

export function windowInstants(w: SyncWindow, zone = appTimeZone()): { start: string; end: string } {
  const [fy, fm, fd] = w.from.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = w.to.split("-").map(Number) as [number, number, number];
  return {
    start: new Date(wallToInstant({ y: fy, mo: fm, d: fd, h: 0, mi: 0, s: 0 }, zone)).toISOString(),
    end: new Date(wallToInstant({ y: ty, mo: tm, d: td, h: 23, mi: 59, s: 59 }, zone)).toISOString(),
  };
}

const dayBefore = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

export async function json<T>(res: Response, what: string): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      const body = JSON.parse(text) as { error?: { message?: string; code?: string } | string; error_description?: string };
      detail = typeof body.error === "string" ? `${body.error}${body.error_description ? `: ${body.error_description}` : ""}` : (body.error?.message ?? detail);
    } catch {
      // Not JSON; the start of the body is the best there is.
    }
    throw new ProviderError(`${what} answered ${res.status}: ${detail}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

// ---- published iCal link ---------------------------------------------------

export const icsProvider: CalendarProvider = {
  async read(config, window) {
    if (!config.url) throw new ProviderError("This calendar has no link.");
    return parseIcs(await fetchFeed(config.url), window);
  },
};

// ---- Microsoft Graph (Strategy's own Outlook calendar) ----------------------

export function graphConfigured(): string | null {
  const missing = ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET"].filter((k) => !(process.env[k] ?? "").trim());
  return missing.length ? `Outlook needs ${missing.join(", ")} in the server's environment (an Entra app registration).` : null;
}

let graphToken: { value: string; until: number } | null = null;

/** A Graph token for the app registration; mail reading uses the same one (lib/mail). */
export async function graphAuth(): Promise<string> {
  if (graphToken && graphToken.until > Date.now() + 60_000) return graphToken.value;
  const problem = graphConfigured();
  if (problem) throw new ProviderError(problem);
  const body = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID!.trim(),
    client_secret: process.env.MS_CLIENT_SECRET!.trim(),
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(process.env.MS_TENANT_ID!.trim())}/oauth2/v2.0/token`, { method: "POST", body, signal: AbortSignal.timeout(20_000) });
  const t = await json<{ access_token: string; expires_in: number }>(res, "Microsoft sign-in");
  graphToken = { value: t.access_token, until: Date.now() + t.expires_in * 1000 };
  return t.access_token;
}

type GraphPerson = { emailAddress?: { address?: string; name?: string } };
type GraphEvent = {
  id: string;
  subject?: string;
  isAllDay?: boolean;
  isCancelled?: boolean;
  showAs?: string;
  start: { dateTime: string };
  end: { dateTime: string };
  organizer?: GraphPerson;
  attendees?: Array<GraphPerson & { type?: string }>;
};

const graphPerson = (p?: GraphPerson): CalPerson | null =>
  p?.emailAddress?.address ? { email: p.emailAddress.address.trim().toLowerCase(), name: p.emailAddress.name ?? null } : null;

export function fromGraph(e: GraphEvent, zone = appTimeZone()): CalEvent {
  const busy = e.showAs === "oof" ? "oof" : e.showAs === "free" ? "free" : e.showAs === "tentative" ? "tentative" : e.showAs === "busy" ? "busy" : null;
  const base = {
    key: `graph:${e.id}`,
    title: (e.subject ?? "").trim() || "(no title)",
    organizer: graphPerson(e.organizer),
    attendees: (e.attendees ?? []).filter((a) => a.type !== "resource").map(graphPerson).filter((p): p is CalPerson => !!p),
    busy: busy as CalEvent["busy"],
    cancelled: !!e.isCancelled,
  };
  // Asked for in UTC (Prefer: outlook.timezone="UTC"), without a zone suffix.
  const utc = (s: string) => Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`);
  if (e.isAllDay) {
    const day = e.start.dateTime.slice(0, 10);
    // The end of an all-day event is exclusive: a one-day event ends the next midnight.
    const endRaw = e.end.dateTime.slice(0, 10);
    return { ...base, day, time: null, endDay: endRaw > day ? dayBefore(endRaw) : day, allDay: true };
  }
  const start = appDayTime(utc(e.start.dateTime), zone);
  const end = appDayTime(Math.max(utc(e.start.dateTime), utc(e.end.dateTime) - 1), zone);
  return { ...base, day: start.day, time: start.time, endDay: end.day, allDay: false };
}

const GRAPH = "https://graph.microsoft.com/v1.0";
const GRAPH_WATCH_MS = 2.5 * 24 * 3600 * 1000; // under the 4230-minute limit for events

export const graphProvider: CalendarProvider = {
  async read(config, window) {
    if (!config.mailbox) throw new ProviderError("This calendar has no mailbox.");
    const token = await graphAuth();
    const { start, end } = windowInstants(window);
    let url: string | undefined =
      `${GRAPH}/users/${encodeURIComponent(config.mailbox)}/calendarView?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}&$top=200&$select=id,subject,isAllDay,isCancelled,showAs,start,end,organizer,attendees`;
    const events: CalEvent[] = [];
    for (let page = 0; url && page < 25; page++) {
      const res: Response = await fetch(url, { headers: { authorization: `Bearer ${token}`, prefer: 'outlook.timezone="UTC"' }, signal: AbortSignal.timeout(30_000) });
      const body: { value: GraphEvent[]; "@odata.nextLink"?: string } = await json(res, "Outlook");
      events.push(...body.value.map((e) => fromGraph(e)));
      url = body["@odata.nextLink"];
    }
    return { events, skipped: 0 };
  },
  async startWatch(config, hookUrl, secret) {
    const token = await graphAuth();
    const res = await fetch(`${GRAPH}/subscriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ changeType: "created,updated,deleted", notificationUrl: hookUrl, resource: `users/${config.mailbox}/events`, expirationDateTime: new Date(Date.now() + GRAPH_WATCH_MS).toISOString(), clientState: secret }),
      signal: AbortSignal.timeout(30_000),
    });
    const sub = await json<{ id: string; expirationDateTime: string }>(res, "Outlook subscriptions");
    return { id: sub.id, expiresAt: Date.parse(sub.expirationDateTime) };
  },
  async renewWatch(_config, watch) {
    const token = await graphAuth();
    const res = await fetch(`${GRAPH}/subscriptions/${encodeURIComponent(watch.id)}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ expirationDateTime: new Date(Date.now() + GRAPH_WATCH_MS).toISOString() }),
      signal: AbortSignal.timeout(30_000),
    });
    const sub = await json<{ id: string; expirationDateTime: string }>(res, "Outlook subscriptions");
    return { id: sub.id, expiresAt: Date.parse(sub.expirationDateTime) };
  },
  async stopWatch(_config, watchId) {
    const token = await graphAuth();
    const res = await fetch(`${GRAPH}/subscriptions/${encodeURIComponent(watchId)}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok && res.status !== 404) await json(res, "Outlook subscriptions");
  },
};

// ---- Google (a calendar shared with Strategy's service account) ------------

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

function serviceAccount(): ServiceAccount | null {
  const raw = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "").trim();
  if (!raw) return null;
  try {
    const text = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const sa = JSON.parse(text) as ServiceAccount;
    return sa.client_email && sa.private_key ? sa : null;
  } catch {
    return null;
  }
}

export function googleConfigured(): string | null {
  return serviceAccount() ? null : "Google needs GOOGLE_SERVICE_ACCOUNT_JSON in the server's environment (a service account key, as JSON or base64).";
}

export function googleServiceEmail(): string | null {
  return serviceAccount()?.client_email ?? null;
}

// One token per scope and mailbox: calendars are shared with the service
// account itself; Gmail is read as the person through domain-wide delegation.
const googleTokens = new Map<string, { value: string; until: number }>();
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

export async function googleAuth(scope = CALENDAR_SCOPE, sub?: string): Promise<string> {
  const cacheKey = `${scope}|${sub ?? ""}`;
  const cached = googleTokens.get(cacheKey);
  if (cached && cached.until > Date.now() + 60_000) return cached.value;
  const sa = serviceAccount();
  if (!sa) throw new ProviderError(googleConfigured()!);
  const aud = sa.token_uri ?? "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iss: sa.client_email, scope, aud, iat: now, exp: now + 3600, ...(sub ? { sub } : {}) }))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key);
  const res = await fetch(aud, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(signature)}` }),
    signal: AbortSignal.timeout(20_000),
  });
  const t = await json<{ access_token: string; expires_in: number }>(res, "Google sign-in");
  googleTokens.set(cacheKey, { value: t.access_token, until: Date.now() + t.expires_in * 1000 });
  return t.access_token;
}

type GooglePerson = { email?: string; displayName?: string; resource?: boolean; self?: boolean };
type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  eventType?: string;
  transparency?: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
  organizer?: GooglePerson;
  attendees?: GooglePerson[];
};

const googlePerson = (p?: GooglePerson): CalPerson | null => (p?.email && !p.resource ? { email: p.email.trim().toLowerCase(), name: p.displayName ?? null } : null);

export function fromGoogle(e: GoogleEvent, zone = appTimeZone()): CalEvent {
  const base = {
    key: `google:${e.id}`,
    title: (e.summary ?? "").trim() || "(no title)",
    organizer: googlePerson(e.organizer),
    attendees: (e.attendees ?? []).map(googlePerson).filter((p): p is CalPerson => !!p),
    busy: (e.eventType === "outOfOffice" ? "oof" : e.transparency === "transparent" ? "free" : "busy") as CalEvent["busy"],
    cancelled: e.status === "cancelled",
    outOfOffice: e.eventType === "outOfOffice",
  };
  if (e.start.date) {
    const end = e.end?.date && e.end.date > e.start.date ? dayBefore(e.end.date) : e.start.date;
    return { ...base, day: e.start.date, time: null, endDay: end, allDay: true };
  }
  const s = Date.parse(e.start.dateTime ?? "");
  const en = Date.parse(e.end?.dateTime ?? e.start.dateTime ?? "");
  const start = appDayTime(s, zone);
  return { ...base, day: start.day, time: start.time, endDay: appDayTime(Math.max(s, en - 1), zone).day, allDay: false };
}

const GCAL = "https://www.googleapis.com/calendar/v3";
const GOOGLE_WATCH_MS = 7 * 24 * 3600 * 1000;

export const googleProvider: CalendarProvider = {
  async read(config, window) {
    if (!config.calendarId) throw new ProviderError("This calendar has no calendar ID.");
    const token = await googleAuth();
    const { start, end } = windowInstants(window);
    const events: CalEvent[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 25; page++) {
      const q = new URLSearchParams({ timeMin: start, timeMax: end, singleEvents: "true", showDeleted: "true", maxResults: "250", ...(pageToken ? { pageToken } : {}) });
      const res = await fetch(`${GCAL}/calendars/${encodeURIComponent(config.calendarId)}/events?${q}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
      const body = await json<{ items?: GoogleEvent[]; nextPageToken?: string }>(res, "Google Calendar");
      // A deleted single event comes back with no start; there is nothing to show for it.
      events.push(...(body.items ?? []).filter((e) => e.start && (e.start.date || e.start.dateTime)).map((e) => fromGoogle(e)));
      pageToken = body.nextPageToken;
      if (!pageToken) break;
    }
    return { events, skipped: 0 };
  },
  async startWatch(config, hookUrl, secret) {
    const token = await googleAuth();
    const channel = randomUUID();
    const res = await fetch(`${GCAL}/calendars/${encodeURIComponent(config.calendarId!)}/events/watch`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ id: channel, type: "web_hook", address: hookUrl, token: secret, params: { ttl: String(GOOGLE_WATCH_MS / 1000) } }),
      signal: AbortSignal.timeout(30_000),
    });
    const ch = await json<{ id: string; resourceId: string; expiration?: string }>(res, "Google Calendar watch");
    // Stopping a channel needs both ids.
    return { id: `${ch.id}|${ch.resourceId}`, expiresAt: Number(ch.expiration ?? Date.now() + GOOGLE_WATCH_MS) };
  },
  async renewWatch(config, watch, hookUrl, secret) {
    // Google channels cannot be extended: start a new one, then stop the old.
    const next = await googleProvider.startWatch!(config, hookUrl, secret);
    await googleProvider.stopWatch!(config, watch.id).catch(() => undefined);
    return next;
  },
  async stopWatch(_config, watchId) {
    const [id, resourceId] = watchId.split("|");
    const token = await googleAuth();
    const res = await fetch(`${GCAL}/channels/stop`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ id, resourceId }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok && res.status !== 404) await json(res, "Google Calendar channels");
  },
};

export function provider(kind: SourceKind): CalendarProvider {
  return kind === "graph" ? graphProvider : kind === "google" ? googleProvider : icsProvider;
}

/** Forget cached access tokens. Tests only, and after credentials change. */
export function resetProviderTokens() {
  graphToken = null;
  googleTokens.clear();
}
