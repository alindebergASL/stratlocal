"use server";

// Form-driven edits. Every write goes through applyEntityChange so manual
// changes land in change_log beside accepted proposals.
import { refresh, revalidatePath } from "next/cache";
import { INLINE_FIELDS, type InlineEntity } from "@/lib/inlineFields";
import { redirect } from "next/navigation";
import { db, OWN_WORK_ACCOUNT_ID } from "@/lib/db";
import { editPreparation, saveTask } from "@/lib/planning";
import { listUsers, requirePageUser } from "@/lib/auth";
import { accountIdOf, applyEntityChange, ApplyError, archiveEntity, ConflictError, restoreEntity } from "@/lib/proposals/apply";
import { archiveDocument, restoreDocument } from "@/lib/documents";
import { describeError } from "@/lib/errors";
import { logValueText } from "@/lib/format";
import { entityLabels } from "@/lib/queries/labels";
import { todayLabel } from "@/lib/clock";
import { mergeContacts, mergeDeals, mergeMeetings, mergePlays, moveDeal } from "@/lib/proposals/merge";
import { getAccount, getDocument, listContacts } from "@/lib/queries/accounts";
import { buildHandoff } from "@/lib/handoff/build";
import { DEFAULT_SHARE_DAYS, reshare, revokeShare, storeHandoff } from "@/lib/handoff/store";
import { getMeeting } from "@/lib/queries/meetings";
import { createFollowUpFromBrief } from "@/lib/meetings/briefFollowUp";
import type { BriefFollowUpReply } from "@/lib/meetings/briefFollowUpOutcome";
import type { Archivable, EntityType } from "@/lib/proposals/schema";
import { Attendee } from "@/lib/proposals/schema";
import { buildDealPayload, buildMeetingAttendees, buildQuickDealPayload, FieldError, present, str } from "./formFields";
import { readMoney, readPercent } from "@/lib/money";
import { linkPeople, unlinkPerson } from "@/lib/people";
import { isRealDay, todayISO } from "@/lib/clock";
import type { ArchivedKind } from "@/components/ArchivedBlock";
import type { ActionResult } from "@/components/attempt";

function fail(e: unknown, accountId?: string): ActionResult {
  if (e instanceof FieldError) return { ok: false, error: e.message };
  // A refusal, not a failure: the other one of you wrote to a field this save
  // would change. It comes back with enough to say so in words — which field,
  // what it holds, who put it there — and with the version to submit with if
  // the answer is "mine anyway".
  if (e instanceof ConflictError) {
    const names = new Map(listUsers({ includeInactive: true }).map((u) => [u.id, u.display_name]));
    // Ids resolve to the names on the checkboxes. A contested play link used
    // to read as a row of uuids and a contested attendee list as
    // "[object Object]", in the one block whose whole job is saying what
    // changed. Only built when there is a conflict to explain.
    const labels = accountId ? entityLabels(accountId) : {};
    return {
      ok: false,
      error: e.message,
      conflict: {
        currentVersion: e.currentVersion,
        changes: e.conflicts.map((c) => ({
          field: c.field,
          label: c.field.replace(/_/g, " "),
          theirs: logValueText(c.theirs, (id) => labels[id]),
          actor: c.actorUserId ? (names.get(c.actorUserId) ?? "someone") : "the app",
          atMs: c.atMs,
        })),
      },
    };
  }
  if (!(e instanceof ApplyError)) console.error("[action]", e);
  return { ok: false, error: describeError(e) };
}

function notesFailure(e: unknown, accountId: string, meetingId: string): ActionResult {
  const result = fail(e, accountId);
  if (!result.ok && result.conflict) {
    const current = getMeeting(meetingId);
    // The text and the version must describe the very same conflict. If a
    // different process has already moved it again, offer no stale snapshot.
    if (current?.account_id === accountId && current.updated_at === result.conflict.currentVersion) {
      result.conflict.notes = { text: current.raw_notes ?? "", version: current.updated_at };
    }
  }
  return result;
}

// The row version the submitting form was rendered with. Absent — every form
// that has not opted in, and every create — the write behaves as it always
// has.
function baseVersion(fd: FormData): number | null {
  const raw = str(fd, "base_version");
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function createAccount(fd: FormData): Promise<ActionResult | void> {
  const user = await requirePageUser();
  const name = str(fd, "name");
  if (!name) return { ok: false, error: "The account needs a name." };
  // The write is inside the try and the redirect is outside it: redirect()
  // works by throwing, so catching around it would swallow the navigation.
  let id: string;
  try {
    id = applyEntityChange({
      accountId: "",
      entityType: "account",
      op: "create",
      payload: { name, region: str(fd, "region"), crm_id: str(fd, "crm_id") },
      actorUserId: user.id,
    }).entityId;
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/");
  redirect(`/accounts/${id}`);
}

export async function updateAccount(accountId: string, fd: FormData): Promise<ActionResult> {
  const user = await requirePageUser();
  // Which of us runs it. Blank means both, which is a real answer rather than
  // an unset field, so the value is always written. Checked against the user
  // table here rather than by a foreign key, for the reason migration 009
  // gives: a login should not be what stops an account being restored.
  const ownerUserId = str(fd, "owner_user_id");
  if (ownerUserId && !listUsers().some((u) => u.id === ownerUserId)) {
    return { ok: false, error: "That owner is not one of us." };
  }
  try {
    applyEntityChange({
      accountId,
      entityType: "account",
      op: "update",
      entityId: accountId,
      payload: {
        name: str(fd, "name") ?? undefined,
        crm_id: str(fd, "crm_id"),
        legal_entity: str(fd, "legal_entity"),
        region: str(fd, "region"),
        segment: str(fd, "segment"),
        hq: str(fd, "hq"),
        thesis: str(fd, "thesis"),
        // present(), because the create form and every other caller of this
        // action render no such control and an absent input has always meant
        // "this form does not edit that field" rather than "clear it".
        owner_user_id: present(fd, "owner_user_id", () => ownerUserId),
      },
      actorUserId: user.id,
      baseVersion: baseVersion(fd),
    });
    revalidatePath(`/accounts/${accountId}`);
    return { ok: true };
  } catch (e) {
    return fail(e, accountId);
  }
}

export async function saveDeal(accountId: string, dealId: string | null, fd: FormData): Promise<ActionResult> {
  const user = await requirePageUser();
  try {
    const payload = buildDealPayload(fd);
    if (dealId) {
      applyEntityChange({ accountId, entityType: "deal", op: "update", entityId: dealId, payload, actorUserId: user.id, baseVersion: baseVersion(fd) });
    } else {
      applyEntityChange({
        accountId,
        entityType: "deal",
        op: "create",
        // No CRM id yet is a real and common state: the deal exists before
        // the opportunity does. applyEntityChange issues the local id, so
        // every writer gets the same behaviour rather than only this form.
        payload: { ...payload, deal_id: str(fd, "deal_id") ?? undefined },
        actorUserId: user.id,
      });
    }
    revalidatePath(`/accounts/${accountId}`);
    revalidatePath("/pipeline");
    revalidatePath("/");
    if (dealId) revalidatePath(`/accounts/${accountId}/deals/${dealId}`);
    return { ok: true };
  } catch (e) {
    return fail(e, accountId);
  }
}

export async function quickDealUpdate(accountId: string, dealId: string, fd: FormData): Promise<ActionResult> {
  const user = await requirePageUser();
  let payload: Record<string, unknown>;
  try {
    payload = buildQuickDealPayload(fd);
  } catch (e) {
    return fail(e, accountId);
  }
  try {
    applyEntityChange({ accountId, entityType: "deal", op: "update", entityId: dealId, payload, actorUserId: user.id, baseVersion: baseVersion(fd) });
    revalidatePath(`/accounts/${accountId}`);
    revalidatePath(`/accounts/${accountId}/deals/${dealId}`);
    revalidatePath("/pipeline");
    return { ok: true };
  } catch (e) {
    return fail(e, accountId);
  }
}

export async function saveContact(accountId: string, contactId: string | null, fd: FormData): Promise<ActionResult> {
  const user = await requirePageUser();
  const payload: Record<string, unknown> = {
    name: str(fd, "name") ?? undefined,
    title: str(fd, "title"),
    org: str(fd, "org") ?? "customer",
    role: str(fd, "role"),
    email: str(fd, "email"),
    notes: str(fd, "notes"),
  };
  try {
    applyEntityChange({
      accountId,
      entityType: "contact",
      op: contactId ? "update" : "create",
      entityId: contactId,
      payload,
      actorUserId: user.id,
      baseVersion: contactId ? baseVersion(fd) : null,
    });
    revalidatePath(`/accounts/${accountId}`);
    return { ok: true };
  } catch (e) {
    return fail(e, accountId);
  }
}

export async function savePlay(accountId: string, playId: string | null, fd: FormData): Promise<ActionResult> {
  const user = await requirePageUser();
  const payload: Record<string, unknown> = {
    title: str(fd, "title") ?? undefined,
    thesis: str(fd, "thesis"),
    status: str(fd, "status") ?? undefined,
    owner: str(fd, "owner"),
    next_step: str(fd, "next_step"),
    next_step_due: str(fd, "next_step_due"),
  };
  // Only checked boxes are submitted, so an absent list is indistinguishable
  // from "everything unticked". The hidden _present field is what says the
  // form rendered the control at all; without it the links are left alone.
  if (fd.has("deal_ids_present")) payload.deal_ids = fd.getAll("deal_ids").map(String).filter(Boolean);
  if (fd.has("contact_ids_present")) payload.contact_ids = fd.getAll("contact_ids").map(String).filter(Boolean);
  for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
  try {
    applyEntityChange({
      accountId,
      entityType: "play",
      op: playId ? "update" : "create",
      entityId: playId,
      payload,
      actorUserId: user.id,
      baseVersion: playId ? baseVersion(fd) : null,
    });
    revalidatePath(`/accounts/${accountId}`);
    return { ok: true };
  } catch (e) {
    return fail(e, accountId);
  }
}

// ---- install base -----------------------------------------------------------

/**
 * Add or correct one line of a dated snapshot.
 *
 * Until now nothing in the app wrote one of these by hand: the report import
 * was the only writer, so a figure the model misread from a report table was
 * permanent. It goes through `applyEntityChange` like everything else, so a
 * correction is a dated line in history saying what the number used to be.
 *
 * `as_of` is only ever set on a create. Moving a line from one snapshot to
 * another is not a correction, it is a different assertion about when the
 * account looked like that, and it would silently change what the trend
 * compares — so an edit leaves the date alone and a mistake in it is fixed by
 * archiving the line and adding it under the right date.
 */
export async function saveInstallBase(accountId: string, rowId: string | null, fd: FormData): Promise<ActionResult> {
  const user = await requirePageUser();
  try {
    const payload: Record<string, unknown> = {
      product_family: str(fd, "product_family") ?? undefined,
      value_usd: present(fd, "value_usd", () => readMoney(str(fd, "value_usd"), "Value")),
      share_pct: present(fd, "share_pct", () => readPercent(str(fd, "share_pct"))),
      role_note: present(fd, "role_note", () => str(fd, "role_note")),
    };
    if (!rowId) {
      const asOf = str(fd, "as_of");
      if (!asOf || !isRealDay(asOf)) throw new FieldError("The snapshot date has to be a real calendar date, like 2026-06-30.");
      if (asOf > todayISO()) throw new FieldError("A snapshot cannot be dated in the future.");
      payload.as_of = asOf;
    }
    for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
    applyEntityChange({
      accountId,
      entityType: "install_base",
      op: rowId ? "update" : "create",
      entityId: rowId,
      payload,
      actorUserId: user.id,
      baseVersion: rowId ? baseVersion(fd) : null,
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e, accountId);
  }
}

// ---- meetings ---------------------------------------------------------------

// Every contact on the account, archived included. The meeting form renders
// archived attendees checked, so they have to resolve.
function attendeeCandidates(accountId: string) {
  return listContacts(accountId, { includeArchived: true }).map((c) => ({ id: c.id, name: c.name }));
}

export async function createMeeting(accountId: string, fd: FormData): Promise<ActionResult | void> {
  const user = await requirePageUser();
  const title = str(fd, "title");
  const heldAt = str(fd, "held_at");
  // These used to `return` — and a void return is success to attempt(), so the
  // panel closed as if it had worked and everything typed into it was gone.
  // HTML `required` accepts a field of spaces.
  if (!title) return { ok: false, error: "The meeting needs a title." };
  if (!heldAt) return { ok: false, error: "The meeting needs a date." };
  // Wrapped like every other write. Unwrapped, an over-long attendee list —
  // the exact case formFields.ts declines to silently trim, on the grounds
  // that failing is visible — escaped the action, and Next replaces an
  // escaped server-action error with a generic digest. The promise held on
  // the edit form and not on this one.
  let id: string;
  try {
    id = applyEntityChange({
      accountId,
      entityType: "meeting",
      op: "create",
      payload: {
        title,
        held_at: heldAt,
        // Optional: a meeting really can be "some time Thursday", and the
        // ordering says so rather than guessing.
        held_time: str(fd, "held_time"),
        attendees: buildMeetingAttendees(fd, attendeeCandidates(accountId)),
      },
      actorUserId: user.id,
    }).entityId;
  } catch (e) {
    return fail(e, accountId);
  }
  revalidatePath(`/accounts/${accountId}`);
  redirect(`/accounts/${accountId}/meetings/${id}`);
}

export async function saveMeeting(accountId: string, meetingId: string, fd: FormData): Promise<ActionResult> {
  const user = await requirePageUser();
  try {
    const current = getMeeting(meetingId);
    const existing = current ? Attendee.array().safeParse(JSON.parse(current.attendees_json || "[]")) : null;
    applyEntityChange({
      accountId,
      entityType: "meeting",
      op: "update",
      entityId: meetingId,
      payload: {
        title: str(fd, "title") ?? undefined,
        held_at: str(fd, "held_at") ?? undefined,
        held_time: present(fd, "held_time", () => str(fd, "held_time")),
        // Only when the form rendered the control, same rule as the play
        // links: otherwise an absent list means "unticked everything".
        attendees: present(fd, "attendees_present", () =>
          buildMeetingAttendees(fd, attendeeCandidates(accountId), existing?.success ? existing.data : []),
        ),
        summary: present(fd, "summary", () => str(fd, "summary")),
      },
      actorUserId: user.id,
      baseVersion: baseVersion(fd),
    });
    revalidatePath(`/accounts/${accountId}/meetings/${meetingId}`);
    revalidatePath(`/accounts/${accountId}`);
    return { ok: true };
  } catch (e) {
    return fail(e, accountId);
  }
}

// Notes are a document: written through the same path, but history records
// their size rather than a second copy of the text.
//
// Which is exactly why this is the one collision the app cannot undo, and the
// one that gets a way out other than picking a winner. `keep` says what to do
// when the record has moved: "mine" overwrites, "both" keeps both halves under
// a line saying whose is whose, so nobody has to choose between ten minutes of
// their typing and ten minutes of the other one's.
export async function saveNotes(accountId: string, meetingId: string, fd: FormData): Promise<ActionResult> {
  const user = await requirePageUser();
  const notes = fd.get("raw_notes");
  if (typeof notes !== "string") return { ok: false, error: "No notes submitted" };
  const meeting = getMeeting(meetingId);
  if (!meeting || meeting.account_id !== accountId) return { ok: false, error: "That meeting no longer exists in this account." };
  // Keep both is the way out of a refusal that does not make anyone choose.
  // It must never be able to lose anything — which the first version could:
  // with an empty box of your own it fell through to the plain write below and
  // put raw_notes to NULL, so the button that exists precisely so nobody loses
  // ten minutes of typing was the one that lost it.
  if (str(fd, "keep") === "both") {
    const current = getMeeting(meetingId);
    if (!current) return { ok: false, error: "That meeting no longer exists." };
    const theirs = (current.raw_notes ?? "").trimEnd();
    const mine = notes.trim();
    // Nothing of mine to add, or we typed the same thing: theirs stands, and
    // saying so is the whole answer.
    if (mine === "" || theirs.trim() === mine) return { ok: true };
    const names = new Map(listUsers({ includeInactive: true }).map((u) => [u.id, u.display_name]));
    const merged = theirs === "" ? mine : `${theirs}\n\n———\n${names.get(user.id) ?? "Also"} added, ${todayLabel()}:\n\n${mine}`;
    try {
      applyEntityChange({
        accountId,
        entityType: "meeting",
        op: "update",
        entityId: meetingId,
        payload: { raw_notes: merged },
        actorUserId: user.id,
        // Measured against what was just read, so a second press while the
        // first is still in flight cannot append the same text twice — and so
        // that `keep`, which is only a form field, is not a way to skip the
        // check entirely.
        baseVersion: current.updated_at,
      });
      revalidatePath(`/accounts/${accountId}/meetings/${meetingId}`);
      return { ok: true };
    } catch (e) {
      return notesFailure(e, accountId, meetingId);
    }
  }
  try {
    const r = applyEntityChange({
      accountId,
      entityType: "meeting",
      op: "update",
      entityId: meetingId,
      payload: { raw_notes: notes.trim() === "" ? null : notes },
      actorUserId: user.id,
      baseVersion: baseVersion(fd),
    });
    revalidatePath(`/accounts/${accountId}/meetings/${meetingId}`);
    return { ok: true, version: r.version };
  } catch (e) {
    return notesFailure(e, accountId, meetingId);
  }
}

// A follow-up you can just write down.
//
// Eighteen server actions and not one of them wrote an action_items row: the
// only way to get a follow-up was to create a meeting, paste notes, pay for an
// extraction and accept a proposal — four steps and a model call to record one
// line. And extraction is told to set a date only when the notes gave one,
// while every attention surface requires `due IS NOT NULL`, so the common case
// was invisible to Home forever and there was no form to date it with.
export async function saveActionItem(accountId: string, itemId: string | null, fd: FormData): Promise<ActionResult> {
  const user = await requirePageUser();
  const text = str(fd, "text");
  if (!text) return { ok: false, error: "The task needs a title." };
  const due = str(fd, "due");
  if (due && !isRealDay(due)) return { ok: false, error: "That due date is not a real day." };
  // Which of us owns it. Empty means nobody here — a customer's action, or
  // not yet decided — and `owner` keeps whatever the notes called them.
  const ownerUserId = str(fd, "owner_user_id");
  const known = new Set(listUsers().map((u) => u.id));
  if (ownerUserId && !known.has(ownerUserId)) return { ok: false, error: "That owner is not one of us." };
  const payload: Record<string, unknown> = {
    text,
    due: present(fd, "due", () => str(fd, "due")),
    notes: present(fd, "notes", () => str(fd, "notes")),
    owner_user_id: present(fd, "owner_user_id", () => ownerUserId),
    owner: present(fd, "owner", () => str(fd, "owner")),
    play_id: present(fd, "play_id", () => str(fd, "play_id")),
    meeting_id: present(fd, "meeting_id", () => str(fd, "meeting_id")),
    status: itemId ? undefined : "open",
  };
  try {
    const previousMeetingId = itemId ? (db().prepare("SELECT meeting_id FROM action_items WHERE id = ? AND account_id = ?").get(itemId, accountId) as { meeting_id: string | null } | undefined)?.meeting_id : null;
    // Only an edit may name another account, and saveTask decides whether that
    // move is allowed. On a create the bound account is the scope: a form
    // field must not be able to file a new row under an account the page was
    // never about. (captureTask chooses its account before binding, so the
    // capture form still lands where it says.)
    const targetAccountId = itemId ? (str(fd, "account_id") ?? accountId) : accountId;
    const saved = saveTask({ accountId, itemId, targetAccountId, payload, userId: user.id, version: itemId ? baseVersion(fd) : null });
    revalidatePath(`/accounts/${targetAccountId}`);
    revalidatePath(`/follow-ups/${saved.entityId}`);
    // Revalidate the originating meeting too: its list and gap counts are
    // filtered by meeting_id, including when this edit came from another view.
    const meetingId = (db().prepare("SELECT meeting_id FROM action_items WHERE id = ? AND account_id = ?").get(saved.entityId, targetAccountId) as { meeting_id: string | null } | undefined)?.meeting_id;
    if (meetingId) revalidatePath(`/accounts/${targetAccountId}/meetings/${meetingId}`);
    if (previousMeetingId && (previousMeetingId !== meetingId || accountId !== targetAccountId)) revalidatePath(`/accounts/${accountId}/meetings/${previousMeetingId}`);
    revalidatePath(`/accounts/${accountId}`);
    revalidatePath("/follow-ups");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(e, accountId);
  }
}

export async function captureTask(fd: FormData): Promise<ActionResult> {
  // The capture form defaults to the signed-in assignee; omission remains optional.
  return saveActionItem(str(fd, "account_id") ?? OWN_WORK_ACCOUNT_ID, null, fd);
}

export async function planMeeting(fd: FormData): Promise<ActionResult | void> {
  await requirePageUser();
  const accountId = str(fd, "account_id");
  if (!accountId) return { ok: false, error: "Choose an account for this meeting." };
  const account = getAccount(accountId);
  if (!account || account.archived_at || account.kind === "own_work") return { ok: false, error: "Choose a live customer account for this meeting." };
  return createMeeting(accountId, fd);
}

export async function savePreparation(accountId: string, meetingId: string, fd: FormData): Promise<ActionResult> {
  const user = await requirePageUser();
  try {
    editPreparation({ accountId, meetingId, userId: user.id, version: baseVersion(fd),
      purpose: str(fd, "purpose") ?? "", questions: String(fd.get("questions") ?? "").split("\n").map(q => q.trim()).filter(Boolean),
      action: str(fd, "action") ?? "", concern: str(fd, "concern") ?? "" });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) { return fail(e, accountId); }
}

// The brief's proposed next step, confirmed by a person, becoming a follow-up.
//
// Everything that decides what gets written is read from the stored brief on
// the server: the form carries the text somebody confirmed, the owner they
// chose and the date they chose, and nothing else. It cannot name its own
// evidence, its own origin or its own meeting. See lib/meetings/briefFollowUp.
export async function createBriefFollowUp(accountId: string, meetingId: string, fd: FormData): Promise<BriefFollowUpReply> {
  const user = await requirePageUser();
  let result: ReturnType<typeof createFollowUpFromBrief>;
  try {
    result = createFollowUpFromBrief({
      accountId,
      meetingId,
      userId: user.id,
      fingerprint: str(fd, "brief_fingerprint"),
      text: str(fd, "text") ?? "",
      ownerChoice: str(fd, "owner_choice"),
      due: str(fd, "due"),
      dueUnknown: fd.get("due_unknown") !== null,
      ackEvidence: fd.get("ack_evidence") !== null,
    });
  } catch (e) {
    // Only this synchronous transaction's refusal is a known no-write result.
    // In particular, never label a post-commit revalidation failure as one.
    if (e instanceof ApplyError) return { ok: false, error: e.message, noWrite: true };
    throw e;
  }
  revalidatePath(`/accounts/${accountId}/meetings/${meetingId}`);
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/follow-ups");
  revalidatePath("/");
  return { ok: true, status: result.status, record: result.record };
}

// The version is the row as the checkbox was drawn. Without it a tab left
// open since yesterday could reopen a follow-up the other of you closed this
// morning, and nothing would say so. Optional only so a caller that has no
// row to read it from still works; every list that renders the row sends it.
//
// The reply carries the row's new version because the lists that call this
// are not always on a path revalidatePath refreshes — /follow-ups and the
// meeting page are not /accounts/:id — so the list keeps it, and a second
// click on the same box is not refused as a conflict with your own first one.
export async function setActionItemStatus(accountId: string, itemId: string, status: "open" | "done", baseVersion?: number | null): Promise<ActionResult> {
  const user = await requirePageUser();
  try {
    applyEntityChange({ accountId, entityType: "action_item", op: "update", entityId: itemId, payload: { status }, actorUserId: user.id, baseVersion: baseVersion ?? null });
    revalidatePath(`/accounts/${accountId}`);
    revalidatePath("/");
    return { ok: true, version: itemVersion(itemId) };
  } catch (e) {
    return fail(e, accountId);
  }
}

function itemVersion(itemId: string): number | undefined {
  return (db().prepare("SELECT updated_at FROM action_items WHERE id = ?").get(itemId) as { updated_at: number } | undefined)?.updated_at;
}

// Several at once, which is how follow-ups actually get cleared: you come out
// of a meeting and four things are done. One at a time meant four sequential
// round trips, each of which disabled every other checkbox while it ran.
export async function setActionItemsStatus(
  accountId: string,
  itemIds: string[],
  status: "open" | "done",
  baseVersions?: Record<string, number>,
): Promise<ActionResult> {
  const user = await requirePageUser();
  if (itemIds.length === 0) return { ok: true };
  try {
    // All or nothing. Each applyEntityChange is its own transaction, so the
    // bare loop committed the ones before the failure and then reported
    // failure — and the checkbox list, which reverts every tick it made
    // optimistically, showed four unticked boxes over two rows that were
    // already done.
    db().transaction(() => {
      for (const itemId of itemIds) {
        applyEntityChange({ accountId, entityType: "action_item", op: "update", entityId: itemId, payload: { status }, actorUserId: user.id, baseVersion: baseVersions?.[itemId] ?? null });
      }
    })();
    revalidatePath(`/accounts/${accountId}`);
    revalidatePath("/");
    return { ok: true, versions: Object.fromEntries(itemIds.map((id) => [id, itemVersion(id)]).filter((e): e is [string, number] => typeof e[1] === "number")) };
  } catch (e) {
    return fail(e);
  }
}

// ---- merge ------------------------------------------------------------------

// Two rows for one person. Every play that linked the loser is relinked, every
// meeting they attended is rewritten, the keeper's blank fields are filled
// from theirs, and the loser is archived — all of it in one transaction and
// all of it in history. See lib/proposals/merge.ts.
export async function mergePeople(accountId: string, keeperId: string, fd: FormData): Promise<ActionResult> {
  const user = await requirePageUser();
  const loserId = str(fd, "loser_id");
  if (!loserId) return { ok: false, error: "Pick the duplicate to merge in" };
  try {
    mergeContacts({ accountId, keeperId, loserId, actorUserId: user.id });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e, accountId);
  }
}

/**
 * Say that a person here and a person at another account are the same human.
 *
 * Not a merge: both rows stay, because their role, title and notes are
 * per-account and merging them would have to throw one set away. This only
 * connects them, which was the whole of what was missing.
 */
export async function linkPerson(accountId: string, contactId: string, fd: FormData): Promise<ActionResult> {
  const user = await requirePageUser();
  const otherId = str(fd, "other_id");
  if (!otherId) return { ok: false, error: "Pick the person at the other account" };
  try {
    linkPeople({ aId: contactId, bId: otherId, actorUserId: user.id });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e, accountId);
  }
}

export async function unlinkPersonAction(accountId: string, contactId: string): Promise<ActionResult> {
  const user = await requirePageUser();
  try {
    unlinkPerson(contactId, user.id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e, accountId);
  }
}

// A deal opened against the wrong account. Everything about it comes along:
// its history, its id, and the record of where it used to be.
export async function moveDealToAccount(fromAccountId: string, dealId: string, fd: FormData): Promise<ActionResult> {
  const user = await requirePageUser();
  const toAccountId = str(fd, "to_account_id");
  if (!toAccountId) return { ok: false, error: "Pick the account to move it to" };
  try {
    moveDeal({ dealId, fromAccountId, toAccountId, actorUserId: user.id });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/", "layout");
  redirect(`/accounts/${toAccountId}/deals/${encodeURIComponent(dealId)}`);
}

// Two rows for one opportunity, which the app used to guarantee: `deal_id` is
// the primary key and the import matches on it alone, so a deal added before
// the CRM had an id for it became a second row the moment the report arrived.
export async function mergeDealsAction(accountId: string, keeperId: string, fd: FormData): Promise<ActionResult> {
  const user = await requirePageUser();
  const loserId = str(fd, "loser_id");
  if (!loserId) return { ok: false, error: "Pick the duplicate to merge in" };
  try {
    mergeDeals({ accountId, keeperId, loserId, actorUserId: user.id });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e, accountId);
  }
}

// Two rows for one play. The links become the union of both, the follow-ups
// come across, and the loser becomes a tombstone rather than an ordinary
// archived row — because the importers match a play by title against archived
// rows, and would otherwise propose restoring it on the next report.
export async function mergePlaysAction(accountId: string, keeperId: string, fd: FormData): Promise<ActionResult> {
  const user = await requirePageUser();
  const loserId = str(fd, "loser_id");
  if (!loserId) return { ok: false, error: "Pick the duplicate to merge in" };
  try {
    mergePlays({ accountId, keeperId, loserId, actorUserId: user.id });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e, accountId);
  }
}

// Two records of one call, usually because both of us made a meeting for it.
// Attendees are unioned, both sets of notes are kept, and the brief is not
// merged — it is a dated document, so the keeper's stands.
export async function mergeMeetingsAction(accountId: string, keeperId: string, fd: FormData): Promise<ActionResult> {
  const user = await requirePageUser();
  const loserId = str(fd, "loser_id");
  if (!loserId) return { ok: false, error: "Pick the duplicate to merge in" };
  try {
    mergeMeetings({ accountId, keeperId, loserId, actorUserId: user.id });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e, accountId);
  }
}

// ---- archive ----------------------------------------------------------------

// Nothing is deleted. Archiving hides a record and rejects anything still
// proposed for it; restoring brings it back. Both land in the record's history.
export async function archiveRecord(entityType: Archivable, entityId: string): Promise<ActionResult> {
  const user = await requirePageUser();
  const accountId = accountIdOf(entityType, entityId);
  if (!accountId) return { ok: false, error: "That record no longer exists" };
  try {
    archiveEntity({ accountId, entityType, entityId, actorUserId: user.id });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// Takes ArchivedKind rather than Archivable so one restore button serves the
// whole archived block. A document is not an entity, so it takes the other
// path; `isArchivable` is what keeps the apply path honest.
export async function restoreRecord(entityType: ArchivedKind, entityId: string): Promise<ActionResult> {
  const user = await requirePageUser();
  if (entityType === "document") return restoreDocumentRecord(entityId);
  const accountId = accountIdOf(entityType, entityId);
  if (!accountId) return { ok: false, error: "That record no longer exists" };
  try {
    restoreEntity({ accountId, entityType, entityId, actorUserId: user.id });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function archiveDocumentRecord(documentId: string): Promise<ActionResult> {
  const user = await requirePageUser();
  try {
    archiveDocument(documentId, user.id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function restoreDocumentRecord(documentId: string): Promise<ActionResult> {
  const user = await requirePageUser();
  try {
    restoreDocument(documentId, user.id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// A handoff: a snapshot of the account, with what you are asking the other
// team for, and a link they can read without a login.
//
// Not applyEntityChange, and not a proposal. A handoff is a document rather
// than a field — the same position DECISIONS #9 takes for meeting notes and a
// brief — and nothing a model produces can reach it. What it writes is one
// documents row; what it reads is the account as it stands at that moment,
// which is the whole difference between this and the live one-pager.
export async function createHandoff(accountId: string, fd: FormData): Promise<ActionResult | void> {
  const user = await requirePageUser();
  const account = getAccount(accountId);
  if (!account) return { ok: false, error: "That account no longer exists." };
  const asks = str(fd, "asks");
  // Required, and required for a reason rather than for form: a handoff with
  // no ask is the printable one-pager, which already exists. Refused here
  // instead of by the schema so the message names the field.
  if (!asks) return { ok: false, error: "Say what you are asking the other team for — that is the part they act on." };
  const days = Number(str(fd, "share_days") ?? DEFAULT_SHARE_DAYS);
  let id: string;
  try {
    const report = buildHandoff({ account, by: user.display_name, asks, note: str(fd, "note") });
    id = storeHandoff({ accountId, userId: user.id, report, shareDays: days, passphrase: str(fd, "passphrase") }).doc.id;
  } catch (e) {
    return fail(e, accountId);
  }
  revalidatePath(`/accounts/${accountId}`);
  redirect(`/accounts/${accountId}/handoff/${id}`);
}

/** Stops a share link working, now. The handoff itself stays. */
export async function revokeHandoffShare(accountId: string, documentId: string): Promise<ActionResult> {
  await requirePageUser();
  try {
    const doc = getDocument(documentId);
    if (!doc || doc.account_id !== accountId) return { ok: false, error: "That handoff is not on this account." };
    revokeShare(documentId);
    revalidatePath(`/accounts/${accountId}`);
    return { ok: true };
  } catch (e) {
    return fail(e, accountId);
  }
}

/** A new link for a handoff whose link was revoked or has run out. */
export async function reshareHandoff(accountId: string, documentId: string, fd: FormData): Promise<ActionResult> {
  await requirePageUser();
  try {
    const doc = getDocument(documentId);
    if (!doc || doc.account_id !== accountId) return { ok: false, error: "That handoff is not on this account." };
    // A new address and a new word, or no word — never the old hash carried
    // onto a new link.
    reshare(documentId, Number(str(fd, "share_days") ?? DEFAULT_SHARE_DAYS), Date.now(), str(fd, "passphrase"));
    revalidatePath(`/accounts/${accountId}`);
    return { ok: true };
  } catch (e) {
    return fail(e, accountId);
  }
}

// One field, edited in place (DECISIONS #96). Only the fields in
// lib/inlineFields.ts, parsed the way their forms parse them, through the
// one writer with the row's version. A value that cannot be read fails and
// keeps what was typed (#15); a partner's newer edit comes back as a
// conflict to explain, never overwritten.
export async function updateField(accountId: string, entity: InlineEntity, id: string, field: string, raw: string, base: number | null): Promise<ActionResult> {
  const user = await requirePageUser();
  const spec = INLINE_FIELDS[entity]?.[field];
  if (!spec) return { ok: false, error: "That field cannot be edited here." };
  const text = raw.trim();
  let value: unknown;
  try {
    if (!text) {
      if (spec.required) throw new FieldError(`${spec.label} cannot be empty.`);
      value = null;
    } else if (spec.kind === "money") value = readMoney(text, spec.label);
    else if (spec.kind === "date") {
      if (!isRealDay(text)) throw new FieldError(`${spec.label} has to be a real date, like 2027-03-31.`);
      value = text;
    } else if (spec.kind === "stage") {
      const n = Number(text);
      if (!Number.isInteger(n) || n < 1 || n > 6) throw new FieldError("Stage is a number from 1 to 6.");
      value = n;
    } else if (spec.kind === "status") {
      if (!["open", "won", "lost"].includes(text)) throw new FieldError("Status is open, won or lost.");
      value = text;
    } else value = text;
  } catch (e) {
    return fail(e, accountId);
  }
  try {
    const r = applyEntityChange({ accountId, entityType: entity, op: "update", entityId: id, payload: { [field]: value }, actorUserId: user.id, baseVersion: base });
    refresh();
    return { ok: true, version: r.version };
  } catch (e) {
    return fail(e, accountId);
  }
}

