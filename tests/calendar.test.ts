// SYNTHETIC ONLY: invented accounts, people, addresses (example.com and
// .example subdomains) and events.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { db, type CalendarSourceRow } from "@/lib/db";
import { seedAccount, USER, type Seed } from "./helpers";
import { applyEntityChange } from "@/lib/proposals/apply";
import { buildIndex, isTimeOff, matchEvent } from "@/lib/calendar/match";
import { fromGoogle, fromGraph, googleProvider, graphProvider, resetProviderTokens, windowInstants } from "@/lib/calendar/providers";
import { addSource, getSource, keepWatch, storeEvents } from "@/lib/calendar/sync";
import { acknowledgeChange, addEventsAsMeetings, archiveMeetingForEvent, calendarReview, ignoreEvents, moveMeetingToEvent } from "@/lib/calendar/review";
import { normaliseFeedUrl, FeedError, fetchFeed } from "@/lib/calendar/fetchSafe";
import { getMeeting } from "@/lib/queries/meetings";
import type { CalEvent } from "@/lib/calendar/types";
import { POST as hook } from "@/app/api/calendar/hook/[id]/route";

const TODAY = "2026-10-21";
const event = (p: Partial<CalEvent>): CalEvent => ({ key: "k1", title: "Synthetic call", day: "2026-10-22", time: "11:30", endDay: "2026-10-22", allDay: false, organizer: null, attendees: [], busy: null, cancelled: false, ...p });

describe("matching an invite to an account", () => {
  const index = buildIndex({
    accounts: [{ id: "a1", name: "Synthetic Orchard" }, { id: "a2", name: "Synthetic Juniper" }],
    contacts: [
      { accountId: "a1", email: "finley@orchard.example", name: "Finley Example" },
      { accountId: "a1", email: "robin@orchard.example", name: "Robin Example" },
      { accountId: "a2", email: "casey@juniper.example", name: "Casey Example" },
      { accountId: "a2", email: "sam@shared.example", name: "Sam Example" },
      { accountId: "a1", email: "lee@shared.example", name: "Lee Example" },
      { accountId: "a2", email: "pat@freemail.example", name: "Pat Example" },
    ],
    internalDomains: ["example.com"],
    // Stands in for the real public providers, which a test must not name addresses on.
    freeMail: new Set(["freemail.example"]),
  });
  const p = (email: string) => ({ email, name: null });

  it("skips what has nobody from outside", () => {
    expect(matchEvent({ attendees: [p("alex@example.com"), p("jamie@example.com")], organizer: null }, index)).toEqual({ kind: "internal" });
  });

  it("names the account whose contact is invited, and the one with more when two are", () => {
    expect(matchEvent({ attendees: [p("alex@example.com"), p("finley@orchard.example")], organizer: null }, index)).toMatchObject({ kind: "account", accountId: "a1", reason: "Finley Example is invited" });
    expect(matchEvent({ attendees: [p("finley@orchard.example"), p("robin@orchard.example"), p("casey@juniper.example")], organizer: null }, index)).toMatchObject({ kind: "account", accountId: "a1" });
    expect(matchEvent({ attendees: [p("finley@orchard.example"), p("casey@juniper.example")], organizer: null }, index)).toMatchObject({ kind: "question" });
  });

  it("falls back to a domain only one account uses, and never to public mail", () => {
    expect(matchEvent({ attendees: [p("new.person@juniper.example")], organizer: null }, index)).toMatchObject({ kind: "account", accountId: "a2", reason: "someone from juniper.example is invited" });
    expect(matchEvent({ attendees: [p("other@shared.example")], organizer: null }, index)).toMatchObject({ kind: "question", candidates: ["a2", "a1"] });
    expect(matchEvent({ attendees: [p("someone@freemail.example")], organizer: null }, index)).toMatchObject({ kind: "question", reason: "only personal addresses are invited" });
    expect(matchEvent({ attendees: [p("x@unknown.example")], organizer: null }, index)).toMatchObject({ kind: "question", candidates: [] });
  });

  it("reads time off from out-of-office, or an all-day block that says so", () => {
    expect(isTimeOff(event({ busy: "oof" }))).toBe(true);
    expect(isTimeOff(event({ allDay: true, title: "PTO - synthetic trip" }))).toBe(true);
    expect(isTimeOff(event({ allDay: true, title: "Synthetic conference" }))).toBe(false);
    expect(isTimeOff(event({ title: "Vacation planning", allDay: false }))).toBe(false);
    expect(isTimeOff(event({ busy: "oof", cancelled: true }))).toBe(false);
  });
});

describe("provider adapters", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetProviderTokens();
  });

  it("turns a Graph event into the app's clock, dropping rooms and reading out-of-office", () => {
    const e = fromGraph({ id: "g1", subject: "Synthetic review", start: { dateTime: "2026-10-22T18:30:00.0000000" }, end: { dateTime: "2026-10-22T19:30:00.0000000" }, showAs: "busy", attendees: [{ emailAddress: { address: "Finley@Orchard.example", name: "Finley Example" } }, { type: "resource", emailAddress: { address: "room@example.com" } }] }, "America/Los_Angeles");
    expect(e).toMatchObject({ key: "graph:g1", day: "2026-10-22", time: "11:30", attendees: [{ email: "finley@orchard.example" }] });
    const off = fromGraph({ id: "g2", subject: "Away", isAllDay: true, showAs: "oof", start: { dateTime: "2026-10-30T00:00:00.0000000" }, end: { dateTime: "2026-11-02T00:00:00.0000000" } });
    expect(off).toMatchObject({ allDay: true, day: "2026-10-30", endDay: "2026-11-01", busy: "oof" });
  });

  it("turns a Google event the same way, including its own out-of-office kind", () => {
    expect(fromGoogle({ id: "x", summary: "Synthetic call", start: { dateTime: "2026-10-22T11:30:00-07:00" }, end: { dateTime: "2026-10-22T12:00:00-07:00" }, attendees: [{ email: "casey@juniper.example" }, { email: "room@example.com", resource: true }] }, "America/Los_Angeles")).toMatchObject({ day: "2026-10-22", time: "11:30", attendees: [{ email: "casey@juniper.example" }] });
    expect(fromGoogle({ id: "y", eventType: "outOfOffice", start: { date: "2026-10-30" }, end: { date: "2026-10-31" } })).toMatchObject({ allDay: true, day: "2026-10-30", endDay: "2026-10-30", outOfOffice: true, busy: "oof" });
  });

  it("reads Outlook with app credentials, page by page, asking for UTC", async () => {
    vi.stubEnv("MS_TENANT_ID", "synthetic-tenant");
    vi.stubEnv("MS_CLIENT_ID", "synthetic-client");
    vi.stubEnv("MS_CLIENT_SECRET", "synthetic-secret");
    const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), headers: init?.headers as Record<string, string> });
      if (String(url).includes("login.microsoftonline.com")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
      if (String(url).includes("page2")) return new Response(JSON.stringify({ value: [{ id: "b", subject: "B", start: { dateTime: "2026-10-23T17:00:00" }, end: { dateTime: "2026-10-23T18:00:00" } }] }));
      return new Response(JSON.stringify({ value: [{ id: "a", subject: "A", start: { dateTime: "2026-10-22T17:00:00" }, end: { dateTime: "2026-10-22T18:00:00" } }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/page2" }));
    }));
    const r = await graphProvider.read({ mailbox: "strategy@example.com" }, { from: "2026-10-14", to: "2026-11-20" });
    expect(r.events.map((e) => e.title)).toEqual(["A", "B"]);
    expect(calls[1]!.url).toContain("/users/strategy%40example.com/calendarView?startDateTime=");
    expect(calls[1]!.headers?.prefer).toBe('outlook.timezone="UTC"');
  });

  it("says plainly what is missing before Google can be read", async () => {
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", "");
    await expect(googleProvider.read({ calendarId: "c" }, { from: TODAY, to: TODAY })).rejects.toThrow(/GOOGLE_SERVICE_ACCOUNT_JSON/);
  });

  it("asks for the window as instants in the app's zone", () => {
    expect(windowInstants({ from: "2026-10-14", to: "2026-10-20" }, "America/Los_Angeles")).toEqual({ start: "2026-10-14T07:00:00.000Z", end: "2026-10-21T06:59:59.000Z" });
  });
});

describe("pasted calendar links", () => {
  it("takes https and webcal, and nothing that could reach inside the box", async () => {
    expect(normaliseFeedUrl("webcal://outlook.example.com/a.ics").toString()).toBe("https://outlook.example.com/a.ics");
    expect(() => normaliseFeedUrl("http://outlook.example.com/a.ics")).toThrow(FeedError);
    expect(() => normaliseFeedUrl("file:///etc/passwd")).toThrow(FeedError);
    expect(() => normaliseFeedUrl("https://user:pw@example.com/a.ics")).toThrow(FeedError);
    await expect(fetchFeed("https://127.0.0.1/a.ics")).rejects.toThrow(/private network/);
    await expect(fetchFeed("https://[::1]/a.ics")).rejects.toThrow(/private network/);
    await expect(fetchFeed("https://10.1.2.3/a.ics")).rejects.toThrow(/private network/);
    // The URL parser writes a mapped address in hex; and link-local is all of fe80::/10.
    await expect(fetchFeed("https://[::ffff:127.0.0.1]/a.ics")).rejects.toThrow(/private network/);
    await expect(fetchFeed("https://[::ffff:a9fe:a9fe]/a.ics")).rejects.toThrow(/private network/);
    await expect(fetchFeed("https://[febf::1]/a.ics")).rejects.toThrow(/private network/);
    // IPv4-compatible, site-local, 6to4 and local-use NAT64 can all reach an inside address.
    for (const host of ["[::7f00:1]", "[fec0::1]", "[2002:7f00:1::1]", "[64:ff9b:1::7f00:1]"]) {
      await expect(fetchFeed(`https://${host}/a.ics`)).rejects.toThrow(/private network/);
    }
  });
});

describe("a calendar read into the app", () => {
  let seed: Seed;
  let source: CalendarSourceRow;
  const window = { from: "2026-10-14", to: "2026-11-20" };
  beforeEach(() => {
    vi.stubEnv("INTERNAL_EMAIL_DOMAINS", "example.com");
    seed = seedAccount();
    db().prepare("UPDATE contacts SET email = 'finley@orchard.example' WHERE id = ?").run(seed.contactId);
    db().prepare("INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, 'alex@example.com', 'x', 'Alex', 0, 0)").run(USER);
    source = addSource({ kind: "ics", label: "Synthetic work calendar", ownerUserId: USER, value: "https://calendar.example.com/a.ics", userId: USER });
  });
  const finley = { email: "finley@orchard.example", name: "Finley Example" };
  const alex = { email: "alex@example.com", name: "Alex" };

  it("matches, skips the internal, keeps time off apart, and offers only what is left", () => {
    storeEvents(source, [
      event({ key: "c1", title: "Synthetic depot review", attendees: [alex, finley] }),
      event({ key: "i1", title: "Synthetic team sync", attendees: [alex, { email: "jamie@example.com", name: "Jamie" }] }),
      event({ key: "q1", title: "Synthetic intro", attendees: [alex, { email: "new@unknown.example", name: "New Person" }] }),
      event({ key: "o1", title: "Out of office", allDay: true, time: null, day: "2026-10-30", endDay: "2026-11-01", busy: "oof" }),
    ], window);
    const r = calendarReview(TODAY);
    expect(r.toAdd.map((e) => [e.title, e.accountName, e.reason])).toEqual([["Synthetic depot review", "Synthetic Orchard Lab", "Finley Example is invited"]]);
    expect(r.questions.map((e) => e.title)).toEqual(["Synthetic intro"]);
    expect(r.internalCount).toBe(1);
    expect(r.timeOff).toEqual([{ userId: USER, userName: "Alex", from: "2026-10-30", to: "2026-11-01" }]);
  });

  it("adds an event as a meeting with its outside attendees, links to one already there, and never twice", () => {
    storeEvents(source, [event({ key: "c1", title: "Synthetic depot review", attendees: [alex, finley] }), event({ key: "c2", title: "Quarterly review", day: "2026-09-15", attendees: [finley] })], { from: "2026-09-01", to: "2026-11-20" });
    const [a] = calendarReview(TODAY).toAdd;
    expect(addEventsAsMeetings([a!.id], USER)).toEqual({ created: 1, linked: 0 });
    const ev = db().prepare("SELECT decision, meeting_id FROM calendar_events WHERE id = ?").get(a!.id) as { decision: string; meeting_id: string };
    const m = getMeeting(ev.meeting_id)!;
    expect([m.title, m.held_at, m.held_time, JSON.parse(m.attendees_json)]).toEqual(["Synthetic depot review", "2026-10-22", "11:30", [{ contact_id: seed.contactId, name: "Finley Example", note: null }]]);
    expect(() => addEventsAsMeetings([a!.id], USER)).toThrow(/already added/);
    // The seeded "Quarterly review" on 2026-09-15 is the same meeting.
    const old = db().prepare("SELECT id FROM calendar_events WHERE event_key = 'c2'").get() as { id: string };
    expect(addEventsAsMeetings([old.id], USER)).toEqual({ created: 0, linked: 1 });
    expect((db().prepare("SELECT meeting_id FROM calendar_events WHERE id = ?").get(old.id) as { meeting_id: string }).meeting_id).toBe(seed.meetingId);
  });

  it("keeps a person's choice of account through later reads, and does not offer what was ignored", () => {
    storeEvents(source, [event({ key: "q1", title: "Synthetic intro", attendees: [{ email: "new@unknown.example", name: null }] }), event({ key: "c1", title: "Synthetic call", attendees: [finley] })], window);
    const q = calendarReview(TODAY).questions[0]!;
    addEventsAsMeetings([q.id], USER, seed.accountId);
    ignoreEvents([calendarReview(TODAY).toAdd[0]!.id], USER);
    storeEvents(source, [event({ key: "q1", title: "Synthetic intro", attendees: [{ email: "new@unknown.example", name: null }] }), event({ key: "c1", title: "Synthetic call", attendees: [finley] })], window);
    expect(db().prepare("SELECT account_id, match_reason FROM calendar_events WHERE event_key = 'q1'").get()).toEqual({ account_id: seed.accountId, match_reason: "you chose the account" });
    expect(calendarReview(TODAY).toAdd).toEqual([]);
  });

  it("notices when an added meeting's invite moves or is cancelled, and asks once per change", () => {
    storeEvents(source, [event({ key: "c1", attendees: [finley] })], window);
    addEventsAsMeetings([calendarReview(TODAY).toAdd[0]!.id], USER);
    storeEvents(source, [event({ key: "c1", attendees: [finley], day: "2026-10-23", time: "09:00" })], window);
    const [moved] = calendarReview(TODAY).changed;
    expect(moved).toMatchObject({ what: "moved", day: "2026-10-23", meetingDay: "2026-10-22" });
    const m = moveMeetingToEvent(moved!.id, USER, moved!);
    expect([getMeeting(m.id)!.held_at, getMeeting(m.id)!.held_time]).toEqual(["2026-10-23", "09:00"]);
    expect(calendarReview(TODAY).changed).toEqual([]);
    // Gone from the weeks the app reads: it may have moved further out, so it
    // is not called cancelled.
    storeEvents(source, [], window);
    const [gone] = calendarReview(TODAY).changed;
    expect(gone).toMatchObject({ what: "gone" });
    acknowledgeChange(gone!.id, gone!.signature);
    expect(calendarReview(TODAY).changed).toEqual([]);
  });

  it("moves or archives only the meeting the page showed, as the page showed it", () => {
    storeEvents(source, [event({ key: "c3", attendees: [finley] })], window);
    addEventsAsMeetings([calendarReview(TODAY).toAdd[0]!.id], USER);
    storeEvents(source, [event({ key: "c3", attendees: [finley], day: "2026-10-23", time: "09:00" })], window);
    const [shown] = calendarReview(TODAY).changed;
    // Someone edits the meeting after the page loaded.
    applyEntityChange({ accountId: seed.accountId, entityType: "meeting", op: "update", entityId: shown!.meetingId, payload: { title: "Synthetic renamed call" }, actorUserId: "user-2" });
    expect(() => moveMeetingToEvent(shown!.id, USER, shown!)).toThrow();
    expect(() => archiveMeetingForEvent(shown!.id, USER, shown!)).toThrow();
    expect(getMeeting(shown!.meetingId)).toMatchObject({ held_at: "2026-10-22", archived_at: null });
    // And the invite moves again after the page loaded.
    const [fresh] = calendarReview(TODAY).changed;
    storeEvents(source, [event({ key: "c3", attendees: [finley], day: "2026-10-24", time: "09:00" })], window);
    expect(() => moveMeetingToEvent(fresh!.id, USER, fresh!)).toThrow(/changed again/);
    expect(getMeeting(fresh!.meetingId)!.held_at).toBe("2026-10-22");
  });

  it("calls an invite cancelled only when the calendar says so", () => {
    storeEvents(source, [event({ key: "c2", attendees: [finley] })], window);
    addEventsAsMeetings([calendarReview(TODAY).toAdd[0]!.id], USER);
    storeEvents(source, [event({ key: "c2", attendees: [finley], cancelled: true })], window);
    expect(calendarReview(TODAY).changed[0]).toMatchObject({ what: "cancelled" });
  });

  it("does not read time off from a calendar that is nobody's own", () => {
    const shared = addSource({ kind: "ics", label: "Shared", ownerUserId: null, value: "https://calendar.example.com/b.ics", userId: USER });
    storeEvents(shared, [event({ key: "o1", title: "Out of office", allDay: true, time: null, busy: "oof", attendees: [] })], window);
    expect(calendarReview(TODAY).timeOff).toEqual([]);
  });
});

describe("push updates", () => {
  let source: CalendarSourceRow;
  beforeEach(() => {
    vi.stubEnv("MS_TENANT_ID", "t");
    vi.stubEnv("MS_CLIENT_ID", "c");
    vi.stubEnv("MS_CLIENT_SECRET", "s");
    vi.stubEnv("CALENDAR_HOOK_BASE", "https://strategy.example.com");
    source = addSource({ kind: "graph", label: "Strategy", ownerUserId: null, value: "strategy@example.com", userId: USER });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetProviderTokens();
  });
  const post = (init: { query?: string; body?: unknown; headers?: Record<string, string> }, id = source.id) =>
    hook(new NextRequest(`http://localhost/api/calendar/hook/${id}${init.query ?? ""}`, { method: "POST", headers: init.headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }), { params: Promise.resolve({ id }) });

  it("starts a subscription with a secret and renews it before it lapses", async () => {
    const seen: Array<{ method: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("login.microsoftonline.com")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      seen.push({ method: init?.method ?? "GET", body });
      return new Response(JSON.stringify({ id: "sub-1", expirationDateTime: new Date(Date.now() + 2 * 86400000).toISOString() }));
    }));
    await keepWatch(source);
    const started = getSource(source.id)!;
    expect(seen[0]).toMatchObject({ method: "POST", body: { notificationUrl: `https://strategy.example.com/api/calendar/hook/${source.id}`, resource: "users/strategy@example.com/events" } });
    expect(seen[0]!.body.clientState).toBe(started.watch_secret);
    expect(started.watch_id).toBe("sub-1");
    await keepWatch(started, started.watch_expires_at! - 3600_000);
    expect(seen[1]!.method).toBe("PATCH");
  });

  it("echoes Microsoft's validation, and refuses a notification without the channel's secret", async () => {
    db().prepare("UPDATE calendar_sources SET watch_id = 'sub-1', watch_secret = 'synthetic-secret', last_synced_at = ? WHERE id = ?").run(Date.now(), source.id);
    const v = await post({ query: "?validationToken=abc123" });
    expect([v.status, await v.text()]).toEqual([200, "abc123"]);
    expect((await post({ body: { value: [{ subscriptionId: "sub-1", clientState: "wrong" }] } })).status).toBe(403);
    expect((await post({ body: { value: [{ subscriptionId: "sub-1", clientState: "synthetic-secret" }] } })).status).toBe(202);
    expect((await post({ body: {} }, "no-such-source")).status).toBe(404);
  });
});
