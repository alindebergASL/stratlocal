"use server";

// /calendar's writes. Adding an event as a meeting goes through the one
// apply path as your own edit; everything else here touches only the app's
// record of what the calendars said.
import { revalidatePath } from "next/cache";
import { listUsers, requirePageUser } from "@/lib/auth";
import { describeError } from "@/lib/errors";
import { ApplyError, ConflictError } from "@/lib/proposals/apply";
import { acknowledgeChange, addEventsAsMeetings, archiveMeetingForEvent, CalendarActionError, ignoreEvents, moveMeetingToEvent, type ShownChange } from "@/lib/calendar/review";
import { addSource, disconnectSource, keepWatch, listSources, SourceError, syncSource } from "@/lib/calendar/sync";
import { FeedError } from "@/lib/calendar/fetchSafe";
import type { SourceKind } from "@/lib/calendar/providers";

export type CalendarResult = { ok: true; message?: string } | { ok: false; error: string };

function refresh() {
  revalidatePath("/calendar");
  revalidatePath("/");
}

function fail(e: unknown): CalendarResult {
  if (e instanceof CalendarActionError || e instanceof SourceError || e instanceof FeedError || e instanceof ApplyError || e instanceof ConflictError) return { ok: false, error: e.message };
  return { ok: false, error: describeError(e) };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function addMeetingsAction(eventIds: string[]): Promise<CalendarResult> {
  const user = await requirePageUser();
  if (!Array.isArray(eventIds) || eventIds.length === 0) return { ok: false, error: "Tick at least one event." };
  try {
    const r = addEventsAsMeetings(eventIds.map(String), user.id);
    refresh();
    revalidatePath("/accounts");
    const parts = [r.created ? `${plural(r.created, "meeting")} added` : null, r.linked ? `${plural(r.linked, "event")} linked to a meeting already there` : null].filter(Boolean);
    return { ok: true, message: `${parts.join(", ")}.` };
  } catch (e) {
    return fail(e);
  }
}

export async function addWithAccountAction(eventId: string, accountId: string): Promise<CalendarResult> {
  const user = await requirePageUser();
  if (!accountId) return { ok: false, error: "Choose the account first." };
  try {
    const r = addEventsAsMeetings([eventId], user.id, accountId);
    refresh();
    return { ok: true, message: r.linked ? "Linked to the meeting already there." : "Added." };
  } catch (e) {
    return fail(e);
  }
}

export async function ignoreEventsAction(eventIds: string[]): Promise<CalendarResult> {
  const user = await requirePageUser();
  ignoreEvents(eventIds.map(String), user.id);
  refresh();
  return { ok: true };
}

export async function moveMeetingAction(eventId: string, shown: ShownChange): Promise<CalendarResult> {
  const user = await requirePageUser();
  try {
    const m = moveMeetingToEvent(eventId, user.id, shown);
    refresh();
    revalidatePath(`/accounts/${m.account_id}/meetings/${m.id}`);
    return { ok: true, message: "Moved." };
  } catch (e) {
    return fail(e);
  }
}

export async function keepMeetingAction(eventId: string, signature: string): Promise<CalendarResult> {
  await requirePageUser();
  acknowledgeChange(eventId, signature);
  refresh();
  return { ok: true };
}

export async function connectCalendarAction(fd: FormData): Promise<CalendarResult> {
  const user = await requirePageUser();
  const kind = String(fd.get("kind") ?? "") as SourceKind;
  if (!["ics", "graph", "google"].includes(kind)) return { ok: false, error: "Choose what kind of calendar this is." };
  const owner = String(fd.get("owner") ?? "");
  try {
    const source = addSource({
      kind,
      label: String(fd.get("label") ?? ""),
      ownerUserId: owner && listUsers().some((u) => u.id === owner) ? owner : null,
      value: String(fd.get("value") ?? ""),
      userId: user.id,
    });
    let message = "Connected.";
    try {
      const r = await syncSource(source.id);
      message = `Connected, and read ${plural(r.seen, "event")}.`;
    } catch (e) {
      message = `Connected, but the first read failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    await keepWatch(source).catch(() => undefined);
    refresh();
    return { ok: true, message };
  } catch (e) {
    return fail(e);
  }
}

export async function disconnectCalendarAction(sourceId: string): Promise<CalendarResult> {
  await requirePageUser();
  try {
    await disconnectSource(sourceId);
    refresh();
    return { ok: true, message: "Disconnected. Meetings already added stay." };
  } catch (e) {
    return fail(e);
  }
}

export async function syncNowAction(): Promise<CalendarResult> {
  await requirePageUser();
  const sources = listSources();
  if (sources.length === 0) return { ok: false, error: "No calendar is connected." };
  const failures: string[] = [];
  let seen = 0;
  for (const s of sources) {
    try {
      seen += (await syncSource(s.id)).seen;
    } catch (e) {
      failures.push(`${s.label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  refresh();
  return failures.length ? { ok: false, error: failures.join(" · ") } : { ok: true, message: `Read ${plural(seen, "event")}.` };
}

// The invite was cancelled: archive the meeting it became (DECISIONS #8 —
// archived, not deleted, and only because a person said so).
export async function archiveCancelledMeetingAction(eventId: string, shown: ShownChange): Promise<CalendarResult> {
  const user = await requirePageUser();
  try {
    const m = archiveMeetingForEvent(eventId, user.id, shown);
    refresh();
    revalidatePath(`/accounts/${m.account_id}`);
    return { ok: true, message: "Archived." };
  } catch (err) {
    return fail(err);
  }
}
