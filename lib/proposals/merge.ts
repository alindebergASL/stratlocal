// The two changes the ordinary write path refuses on purpose: merging two
// records into one, and moving a deal to a different account. Neither is a
// field edit, both are things only a person should be able to do, and both
// still go through applyEntityChange wherever they can, so every step lands in
// history.
//
// ---- two rows for one person ------------------------------------------------
//
// Contact matching is by email and then by exact name, and the model proposes
// a new contact whenever it is unsure — which is right, because inventing a
// match is worse. The cost is duplicates, and until now there was no way to
// resolve one. Archiving the loser did not help: archiving repoints nothing,
// so their meetings stayed under the old row, the plays that linked them kept
// a checkbox for an archived person forever, and their quotes stayed
// attributed to an id nobody would look up again.
//
// A contact is referenced in exactly two places — plays.contact_ids_json and
// meetings.attendees_json — and both are already JSON_FIELDS in apply.ts, so
// the whole merge runs through applyEntityChange. Every step is a change_log
// row: which play was relinked, which meeting's attendee list was rewritten,
// which of the keeper's blank fields was filled, and the archive at the end.
import { db, type ContactRow, type DealRow, type MeetingRow, type PlayRow } from "../db";
import { newId, isLocalDealId } from "../ids";
import { fmtMoney } from "../format";
import { Attendee } from "./schema";
import { applyEntityChange, ApplyError, archiveEntity, type ApplyResult } from "./apply";
import { beginReceipt, finishReceipt } from "./unmerge";
import { moveToAccount } from "./move";

export type MergeResult = {
  keeperId: string;
  playsRelinked: number;
  meetingsRewritten: number;
  fieldsFilled: string[];
};

// Fields taken from the loser when the keeper has nothing there. Nothing is
// ever overwritten: a merge must not be able to lose information that was
// already on the row you chose to keep.
const FILLABLE = ["title", "role", "email", "notes"] as const;

function parseArray(text: string | null): string[] {
  if (!text) return [];
  try {
    const v: unknown = JSON.parse(text);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * One attendee per person, first mention wins.
 *
 * A row with no contact_id is somebody who is not on file, so it dedupes on
 * the name instead — otherwise unioning two attendee lists that both name
 * "the CFO's analyst" would list them twice.
 */
function dedupeAttendees(list: Attendee[]): Attendee[] {
  const seen = new Set<string>();
  return list.filter((a) => {
    const key = a.contact_id ?? `name:${a.name.trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The attendee list, or null when there is one and it cannot be read.
 *
 * The distinction is the point. An empty list and an unreadable one both used
 * to come back as `[]`, and `[]` reads exactly like "nobody was there" — so a
 * merge would union the loser's attendees onto nothing and write that back,
 * silently discarding a list it had simply failed to parse. Only a hand-edited
 * database or a schema change gets here, but nothing in this app is allowed to
 * lose something quietly, least of all a merge.
 */
function parseAttendees(json: string | null): Attendee[] | null {
  if (json === null || json.trim() === "") return [];
  try {
    const parsed = Attendee.array().safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Fill the keeper's gaps from the loser, and never the other way round.
 *
 * The line is omission versus measurement: a blank field is something nobody
 * got round to writing, so the other row's answer is strictly better than
 * nothing. A field both rows hold is the same thing said twice, and a merge is
 * an identity operation that must not pick a winner between them.
 */
function fillBlanks<T extends Record<string, unknown>>(keeper: T, loser: T, fields: readonly string[]): Record<string, unknown> {
  const fill: Record<string, unknown> = {};
  for (const field of fields) {
    const mine = keeper[field];
    const theirs = loser[field];
    if ((mine === null || mine === "" || mine === undefined) && theirs !== null && theirs !== "" && theirs !== undefined) {
      fill[field] = theirs;
    }
  }
  return fill;
}

export function mergeContacts(input: {
  accountId: string;
  keeperId: string;
  loserId: string;
  actorUserId: string | null;
}): MergeResult {
  const conn = db();
  return conn.transaction((): MergeResult => {
    const { accountId, keeperId, loserId, actorUserId } = input;
    if (keeperId === loserId) throw new ApplyError("those are the same person", "validation");
    // Before anything is written: what each touched row held, so the merge
    // can be undone (lib/proposals/unmerge.ts).
    const receipt = beginReceipt(conn, accountId, "contact", keeperId, loserId);

    const get = (id: string) =>
      conn.prepare(`SELECT * FROM contacts WHERE id = ?`).get(id) as ContactRow | undefined;
    const keeper = get(keeperId);
    const loser = get(loserId);
    if (!keeper) throw new ApplyError(`contact ${keeperId} not found`, "not_found");
    if (!loser) throw new ApplyError(`contact ${loserId} not found`, "not_found");
    if (keeper.account_id !== accountId || loser.account_id !== accountId) {
      throw new ApplyError("both people must be on the same account", "validation");
    }
    if (keeper.archived_at) throw new ApplyError("the person you are merging into is archived; restore them first", "state");

    // Plays that link the loser. An archived play is included on purpose: it
    // can be restored, and it would come back pointing at a merged-away id.
    let playsRelinked = 0;
    const plays = conn.prepare(`SELECT * FROM plays WHERE account_id = ?`).all(accountId) as PlayRow[];
    for (const play of plays) {
      const ids = parseArray(play.contact_ids_json);
      if (!ids.includes(loserId)) continue;
      // Dedupe: a play can legitimately link both rows of the same person.
      const next = [...new Set(ids.map((id) => (id === loserId ? keeperId : id)))];
      applyEntityChange({
        accountId,
        entityType: "play",
        op: "update",
        entityId: play.id,
        payload: { contact_ids: next },
        actorUserId,
      });
      playsRelinked += 1;
    }

    // Meetings the loser attended. The attendee's name is left as it was
    // written at the time — it is a record of who was in the room — but the
    // id now points at the row that survives.
    let meetingsRewritten = 0;
    const meetings = conn.prepare(`SELECT * FROM meetings WHERE account_id = ?`).all(accountId) as MeetingRow[];
    for (const meeting of meetings) {
      let attendees: Attendee[];
      try {
        const parsed = Attendee.array().safeParse(JSON.parse(meeting.attendees_json ?? "[]"));
        if (!parsed.success) continue;
        attendees = parsed.data;
      } catch {
        continue;
      }
      if (!attendees.some((a) => a.contact_id === loserId)) continue;
      // Both rows in one meeting collapses to one attendee.
      const next = dedupeAttendees(attendees.map((a) => (a.contact_id === loserId ? { ...a, contact_id: keeperId } : a)));
      applyEntityChange({
        accountId,
        entityType: "meeting",
        op: "update",
        entityId: meeting.id,
        payload: { attendees: next },
        actorUserId,
      });
      meetingsRewritten += 1;
    }

    const fill = fillBlanks(keeper, loser, FILLABLE);
    let fieldsFilled: string[] = [];
    if (Object.keys(fill).length > 0) {
      const r: ApplyResult = applyEntityChange({
        accountId,
        entityType: "contact",
        op: "update",
        entityId: keeperId,
        payload: fill,
        actorUserId,
      });
      fieldsFilled = r.changedFields;
    }

    // The cross-account link, which is the one thing a merge could break
    // without saying anything.
    //
    // `person_id` says this row and a row at another account are the same
    // human, and it is not a patch field — linkPeople writes it directly — so
    // `fillBlanks` never saw it. If the duplicate was the row that got linked,
    // archiving it takes the link with it: the survivor is not connected to
    // the other account, the other account's row no longer names this one, and
    // nothing anywhere says so. Filling it is the same omission-versus-
    // measurement rule as every other field here.
    if (!keeper.person_id && loser.person_id) {
      conn.prepare(`UPDATE contacts SET person_id = ?, updated_at = ? WHERE id = ?`).run(loser.person_id, Date.now(), keeperId);
      logRow(conn, {
        accountId,
        entityType: "contact",
        entityId: keeperId,
        field: "person_link",
        oldValue: null,
        newValue: "the same person at another account, carried over from the row merged in",
        actorUserId,
      });
    } else if (keeper.person_id && loser.person_id && keeper.person_id !== loser.person_id) {
      // Two different groups is two different claims about who this is, and a
      // merge is not the place to decide that. The keeper's stands; the link
      // the other row carried is said rather than silently dropped.
      logRow(conn, {
        accountId,
        entityType: "contact",
        entityId: keeperId,
        field: "merged_not_copied",
        oldValue: null,
        newValue: "the other row was linked to a different person at another account; that link was not carried",
        actorUserId,
      });
    }

    // The loser is archived, not deleted: their history, and every quote
    // attributed to them, still resolves.
    if (!loser.archived_at) {
      archiveEntity({ accountId, entityType: "contact", entityId: loserId, actorUserId });
    }
    // And points at the survivor, so an import that meets the old name again
    // lands on the person it became rather than proposing the duplicate back.
    conn.prepare(`UPDATE contacts SET merged_into = ?, updated_at = MAX(updated_at + 1, ?) WHERE id = ?`).run(keeperId, Date.now(), loserId);
    // And unconditionally reject what was still proposed for them — archiving
    // does that, but only when we archive here, and merging someone you
    // already archived by hand is the likeliest way this gets used.
    conn
      .prepare(`UPDATE proposals SET status = 'rejected', decided_by = ?, decided_at = ? WHERE status = 'pending' AND entity_type = 'contact' AND entity_id = ?`)
      .run(actorUserId, Date.now(), loserId);

    // Say what happened, on both rows. Every step above is already in history
    // as a field change, which is the mechanical record and not the reason:
    // without these two lines the keeper's page shows an email appearing from
    // nowhere and a play they were never on. The deal merge has written this
    // sentence since Phase 6; the contact merge, which is four phases older,
    // never did.
    logRow(conn, {
      accountId,
      entityType: "contact",
      entityId: keeperId,
      field: "merged_from",
      oldValue: null,
      newValue: `${loser.name}${loser.email ? ` (${loser.email})` : ""}`,
      actorUserId,
    });
    logRow(conn, {
      accountId,
      entityType: "contact",
      entityId: loserId,
      field: "merged_into",
      oldValue: null,
      newValue: keeper.name,
      actorUserId,
    });

    finishReceipt(conn, receipt, { accountId, entityType: "contact", keeperId, loserId, keeperLabel: keeper.name, loserLabel: loser.name, actorUserId });
    return { keeperId, playsRelinked, meetingsRewritten, fieldsFilled };
  })();
}

// ---- moving a deal to another account ---------------------------------------

// A deal opened against the wrong account, or an account split in two. This
// cannot go through applyEntityChange: account_id is not a field of DealPatch
// and the update path refuses on purpose, because "which account does this
// belong to" is not an ordinary edit and a model must never be able to make
// it. The only alternative was archive-and-recreate, which orphans every
// change_log row keyed to the deal id, every play link, and every meeting the
// deal was cited in.
export type MoveResult = { dealId: string; unlinkedFromPlays: number };

export function moveDeal(input: {
  dealId: string;
  fromAccountId: string;
  toAccountId: string;
  actorUserId: string | null;
}): MoveResult {
  const conn = db();
  return conn.transaction((): MoveResult => {
    const { dealId, fromAccountId, toAccountId, actorUserId } = input;
    if (fromAccountId === toAccountId) throw new ApplyError("that deal is already on that account", "validation");

    const deal = conn.prepare(`SELECT * FROM deals WHERE deal_id = ?`).get(dealId) as { account_id: string } | undefined;
    if (!deal) throw new ApplyError(`deal ${dealId} not found`, "not_found");
    if (deal.account_id !== fromAccountId) throw new ApplyError(`deal ${dealId} is not on that account`, "validation");
    const target = conn.prepare(`SELECT id, archived_at FROM accounts WHERE id = ?`).get(toAccountId) as
      | { id: string; archived_at: string | null }
      | undefined;
    if (!target) throw new ApplyError("that account does not exist", "not_found");
    if (target.archived_at) throw new ApplyError("that account is archived; restore it first", "state");

    // A play on the old account cannot keep pointing at a deal that has left
    // it: assertLinkedIds would refuse the next edit of that play, and the
    // link would mean nothing in the meantime. This goes through
    // applyEntityChange, so each unlink is a history line on the play.
    let unlinkedFromPlays = 0;
    const plays = conn.prepare(`SELECT * FROM plays WHERE account_id = ?`).all(fromAccountId) as PlayRow[];
    for (const play of plays) {
      const ids = parseArray(play.deal_ids_json);
      if (!ids.includes(dealId)) continue;
      applyEntityChange({
        accountId: fromAccountId,
        entityType: "play",
        op: "update",
        entityId: play.id,
        payload: { deal_ids: ids.filter((d) => d !== dealId) },
        actorUserId,
      });
      unlinkedFromPlays += 1;
    }

    // The move itself: pending proposals rejected, a history line on both
    // accounts (lib/proposals/move.ts).
    moveToAccount({ entity: "deal", id: dealId, from: fromAccountId, to: toAccountId, actorUserId });

    return { dealId, unlinkedFromPlays };
  })();
}

// ---- two rows for one deal --------------------------------------------------

// The duplicate this app guaranteed rather than merely permitted.
//
// `deal_id` is the primary key and was a required field on the manual form
// with no explanation, so people invented one. `diffExtraction` matches deals
// by id alone — contacts fall back to email then name, plays to a normalised
// title, deals to nothing — so when the report arrived with the real id it
// proposed a create. Two rows for one opportunity, both in open pipeline, both
// in every prompt, and no way back: the id cannot be edited and archiving
// orphans the history keyed to it.
//
// Only text fields move. `tcv_usd`, `stage`, `close_date`, `fiscal_quarter`,
// `name` and `status` are the same thing measured twice — by the seller's
// guess and by the CRM — and a merge is an identity operation that must not
// change what an account is worth. Whether the keeper happened to be blank
// would otherwise decide whether pipeline moved, which nobody can predict. The
// values that were not copied are recorded so the decision is visible.
const DEAL_FILLABLE = ["next_step", "notes", "owner", "architecture", "competitor", "partner", "stage_label"] as const;
const DEAL_NOT_COPIED = ["tcv_usd", "close_date", "stage", "fiscal_quarter", "status"] as const;

export type DealMergeResult = {
  keeperId: string;
  playsRelinked: number;
  fieldsFilled: string[];
  notCopied: string[];
};

// The narrative half of a merge.
//
// Everything a merge can do through applyEntityChange goes through it, so the
// field fills and the archive already have history. What that history does not
// say is *why* — on the keeper's page an email simply appears out of nowhere.
// These rows are the sentence, and they are written directly because there is
// no field being changed to hang them off.
//
// Declared here and used above: this was hardcoded to 'deal' while only the
// deal merge wrote a narrative, so a contact merge said nothing at all
// (DECISIONS #14: a merge should be as visible in history as a typed edit).
function logRow(conn: ReturnType<typeof db>, input: {
  accountId: string;
  entityType: "deal" | "contact" | "play" | "meeting";
  entityId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  actorUserId: string | null;
}) {
  conn
    .prepare(
      `INSERT INTO change_log (id, account_id, entity_type, entity_id, field, old_value, new_value, actor_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      newId(),
      input.accountId,
      input.entityType,
      input.entityId,
      input.field,
      input.oldValue,
      input.newValue,
      input.actorUserId,
      Date.now(),
    );
}

export function mergeDeals(input: {
  accountId: string;
  keeperId: string;
  loserId: string;
  actorUserId: string | null;
}): DealMergeResult {
  const conn = db();
  return conn.transaction((): DealMergeResult => {
    const { accountId, keeperId, loserId, actorUserId } = input;
    if (keeperId === loserId) throw new ApplyError("those are the same deal", "validation");
    const receipt = beginReceipt(conn, accountId, "deal", keeperId, loserId);

    const get = (id: string) => conn.prepare(`SELECT * FROM deals WHERE deal_id = ?`).get(id) as DealRow | undefined;
    const keeper = get(keeperId);
    const loser = get(loserId);
    if (!keeper) throw new ApplyError(`deal ${keeperId} not found`, "not_found");
    if (!loser) throw new ApplyError(`deal ${loserId} not found`, "not_found");
    if (keeper.account_id !== accountId || loser.account_id !== accountId) {
      throw new ApplyError("both deals must be on the same account", "validation");
    }
    if (keeper.archived_at) throw new ApplyError("the deal you are merging into is archived; restore it first", "state");
    if (keeper.merged_into) throw new ApplyError("that deal has already been merged into another one", "state");
    if (loser.merged_into) throw new ApplyError("that deal has already been merged away", "state");

    // The direction matters more than it looks. Keep the local id and the real
    // CRM id ends up on the tombstone — and the import reads archived rows on
    // purpose, so the next report finds that id and proposes restoring it.
    // Accept all, and the duplicate is back. Every time.
    if (isLocalDealId(keeperId) && !isLocalDealId(loserId)) {
      throw new ApplyError(
        `the CRM id is on ${loserId}; merge this deal into that one instead, so the id the report uses is the one that survives`,
        "validation",
      );
    }

    // Two real CRM ids are two real opportunities. Merging them is worse than
    // wrong, it is self-perpetuating: the import follows merged_into, so every
    // future report line for the loser is redirected onto the keeper from then
    // on, and nothing anywhere un-merges. The picker only ever offers a local
    // and a CRM row, but the action reads the id off the form, so the select
    // was the only thing standing in the way.
    if (!isLocalDealId(keeperId) && !isLocalDealId(loserId)) {
      throw new ApplyError(
        "both of these carry a CRM id, so the report will keep listing them separately and each import would undo the merge again; archive the one you do not want instead",
        "validation",
      );
    }

    // Plays that link the loser, archived ones included: a restored play would
    // otherwise come back pointing at a merged-away deal.
    let playsRelinked = 0;
    for (const play of conn.prepare(`SELECT * FROM plays WHERE account_id = ?`).all(accountId) as PlayRow[]) {
      const ids = parseArray(play.deal_ids_json);
      if (!ids.includes(loserId)) continue;
      const next = [...new Set(ids.map((d) => (d === loserId ? keeperId : d)))];
      applyEntityChange({ accountId, entityType: "play", op: "update", entityId: play.id, payload: { deal_ids: next }, actorUserId });
      playsRelinked += 1;
    }

    const fill = fillBlanks(keeper, loser, DEAL_FILLABLE);
    let fieldsFilled: string[] = [];
    if (Object.keys(fill).length > 0) {
      fieldsFilled = applyEntityChange({
        accountId,
        entityType: "deal",
        op: "update",
        entityId: keeperId,
        payload: fill,
        actorUserId,
      }).changedFields;
    }

    // What the other row said and this one does not. Not copied — see above —
    // but not thrown away either: it is a number someone entered, and the
    // question "what did the row I merged say it was worth" gets asked.
    const notCopied = DEAL_NOT_COPIED.filter((f) => {
      const theirs = loser[f];
      return theirs !== null && theirs !== undefined && theirs !== "" && theirs !== keeper[f];
    }).map((f) => {
      const theirs = loser[f];
      // Money reads as money here too. This printed `tcv 1800000` beside
      // `close date 2026-03-31`, which is the one figure on the line a person
      // is reading the line for.
      if (f === "tcv_usd") return `worth ${fmtMoney(Number(theirs))}`;
      return `${f.replace(/_usd$/, "").replace(/_/g, " ")} ${String(theirs)}`;
    });

    if (!loser.archived_at) {
      archiveEntity({ accountId, entityType: "deal", entityId: loserId, actorUserId });
    }
    // Unconditionally, not only when we archived it just now: the likeliest
    // input to this whole feature is a duplicate the seller already archived by
    // hand, because that was the only workaround, and archiveEntity's own
    // rejection would then never run.
    conn
      .prepare(`UPDATE proposals SET status = 'rejected', decided_by = ?, decided_at = ? WHERE status = 'pending' AND entity_type = 'deal' AND entity_id = ?`)
      .run(actorUserId, Date.now(), loserId);

    conn.prepare(`UPDATE deals SET merged_into = ?, updated_at = ? WHERE deal_id = ?`).run(keeperId, Date.now(), loserId);

    // The narrative beside the pointer. Plain strings only: the history
    // renderer JSON.parses a value and prints String(parsed), so an object
    // would read as [object Object].
    logRow(conn, { accountId, entityType: "deal", entityId: keeperId, field: "merged_from", oldValue: null, newValue: `${loser.name} (${loserId})`, actorUserId });
    logRow(conn, { accountId, entityType: "deal", entityId: loserId, field: "merged_into", oldValue: null, newValue: `${keeper.name} (${keeperId})`, actorUserId });
    if (notCopied.length > 0) {
      logRow(conn, { accountId, entityType: "deal", entityId: keeperId, field: "merged_not_copied", oldValue: null, newValue: notCopied.join(" · "), actorUserId });
    }

    finishReceipt(conn, receipt, { accountId, entityType: "deal", keeperId, loserId, keeperLabel: keeper.name, loserLabel: loser.name, actorUserId });
    return { keeperId, playsRelinked, fieldsFilled, notCopied };
  })();
}

// ---- two rows for one play --------------------------------------------------

// The same shape as the deal merge, and it needs the same tombstone for a
// reason that is specific to plays: diffExtraction and diffPlanDraft both
// match a play by normalised title against a list that INCLUDES archived rows,
// on purpose. Archive the loser and nothing else and the next report finds
// that title, proposes clearing `archived_at`, and one Accept all brings the
// duplicate back — on every import, forever.
//
// Filled when the keeper is blank; `status` and `sort_order` never move.
// A play's status is something a person set, and two rows can honestly
// disagree about it — so it is reported rather than resolved.
const PLAY_FILLABLE = ["thesis", "owner", "next_step", "next_step_due"] as const;
const PLAY_NOT_COPIED = ["status"] as const;

export type PlayMergeResult = {
  keeperId: string;
  followUpsRelinked: number;
  fieldsFilled: string[];
  notCopied: string[];
};

/**
 * What a play merge is about to do, computed once.
 *
 * A merge cannot be undone, so the screen has to be able to say what this
 * particular pair will do to each other before the press. Writing those counts
 * a second time for the screen is how a sentence and a behaviour drift apart —
 * so the merge and the preview share this, and the merge applies exactly what
 * was shown.
 *
 * Runs every guard, so a pair that would be refused is refused here too,
 * before anyone presses anything.
 */
type PlayMergePlan = {
  keeper: PlayRow;
  loser: PlayRow;
  fill: Record<string, unknown>;
  dealsAdded: number;
  peopleAdded: number;
  followUpIds: string[];
  notCopied: string[];
};

function planPlayMerge(conn: ReturnType<typeof db>, accountId: string, keeperId: string, loserId: string): PlayMergePlan {
  if (keeperId === loserId) throw new ApplyError("those are the same play", "validation");

  const get = (id: string) => conn.prepare(`SELECT * FROM plays WHERE id = ?`).get(id) as PlayRow | undefined;
  const keeper = get(keeperId);
  const loser = get(loserId);
  if (!keeper) throw new ApplyError(`play ${keeperId} not found`, "not_found");
  if (!loser) throw new ApplyError(`play ${loserId} not found`, "not_found");
  if (keeper.account_id !== accountId || loser.account_id !== accountId) {
    throw new ApplyError("both plays must be on the same account", "validation");
  }
  if (keeper.archived_at) throw new ApplyError("the play you are merging into is archived; restore it first", "state");
  if (keeper.merged_into) throw new ApplyError("that play has already been merged into another one", "state");
  if (loser.merged_into) throw new ApplyError("that play has already been merged away", "state");

  // The links become the union of both, not the keeper's alone. Two rows for
  // one play legitimately name different deals and different people —
  // whoever wrote each one knew something the other did not — and dropping
  // the loser's side is exactly the silent loss this app is built to avoid.
  //
  // Membership, not length. A keeper's stored array is schema-valid with the
  // same id in it twice — nothing has ever deduped what was written before —
  // and comparing the deduped union's length against that raw array let one
  // existing duplicate cancel out one genuinely new link: [A, A] unioned with
  // [B] is [A, B], two against two, no patch, and B is gone while the loser is
  // archived as merged. So the baseline is the keeper's *distinct* links, and
  // what decides both the patch and the count is which ids are new to it.
  const links: Record<string, unknown> = {};
  const mineDeals = new Set(parseArray(keeper.deal_ids_json));
  const minePeople = new Set(parseArray(keeper.contact_ids_json));
  const deals = [...new Set([...mineDeals, ...parseArray(loser.deal_ids_json)])];
  const contacts = [...new Set([...minePeople, ...parseArray(loser.contact_ids_json)])];
  const dealsAdded = deals.filter((d) => !mineDeals.has(d)).length;
  const peopleAdded = contacts.filter((c) => !minePeople.has(c)).length;
  if (dealsAdded > 0) links.deal_ids = deals;
  if (peopleAdded > 0) links.contact_ids = contacts;

  // Follow-ups written against the loser. Archived ones included: restoring
  // one later must not bring back a pointer to a play that no longer exists
  // as anything but a tombstone.
  const followUpIds = conn
    .prepare(`SELECT id FROM action_items WHERE account_id = ? AND play_id = ?`)
    .pluck()
    .all(accountId, loserId) as string[];

  // `status` is NOT NULL, so unlike the deal merge's list there is no blank
  // case to skip — the only question is whether the two rows disagreed.
  const notCopied = PLAY_NOT_COPIED.filter((f) => loser[f] !== keeper[f]).map((f) => `${f.replace(/_/g, " ")} ${String(loser[f])}`);

  return {
    keeper,
    loser,
    fill: { ...fillBlanks(keeper, loser, PLAY_FILLABLE), ...links },
    dealsAdded,
    peopleAdded,
    followUpIds,
    notCopied,
  };
}

export function mergePlays(input: {
  accountId: string;
  keeperId: string;
  loserId: string;
  actorUserId: string | null;
}): PlayMergeResult {
  const conn = db();
  return conn.transaction((): PlayMergeResult => {
    const { accountId, keeperId, loserId, actorUserId } = input;
    const receipt = beginReceipt(conn, accountId, "play", keeperId, loserId);
    const plan = planPlayMerge(conn, accountId, keeperId, loserId);
    const { keeper, loser, fill, followUpIds, notCopied } = plan;

    let fieldsFilled: string[] = [];
    if (Object.keys(fill).length > 0) {
      fieldsFilled = applyEntityChange({
        accountId,
        entityType: "play",
        op: "update",
        entityId: keeperId,
        payload: fill,
        actorUserId,
      }).changedFields;
    }

    // Through applyEntityChange, so each relink is a line in that follow-up's
    // own history.
    for (const id of followUpIds) {
      applyEntityChange({ accountId, entityType: "action_item", op: "update", entityId: id, payload: { play_id: keeperId }, actorUserId });
    }

    if (!loser.archived_at) {
      archiveEntity({ accountId, entityType: "play", entityId: loserId, actorUserId });
    }
    // Unconditionally, for the reason the deal merge records: archiving by
    // hand was the only workaround before this existed, so it is the likeliest
    // input, and archiveEntity's own rejection would then never run.
    conn
      .prepare(`UPDATE proposals SET status = 'rejected', decided_by = ?, decided_at = ? WHERE status = 'pending' AND entity_type = 'play' AND entity_id = ?`)
      .run(actorUserId, Date.now(), loserId);

    conn.prepare(`UPDATE plays SET merged_into = ?, updated_at = ? WHERE id = ?`).run(keeperId, Date.now(), loserId);

    logRow(conn, { accountId, entityType: "play", entityId: keeperId, field: "merged_from", oldValue: null, newValue: loser.title, actorUserId });
    logRow(conn, { accountId, entityType: "play", entityId: loserId, field: "merged_into", oldValue: null, newValue: keeper.title, actorUserId });
    if (notCopied.length > 0) {
      logRow(conn, { accountId, entityType: "play", entityId: keeperId, field: "merged_not_copied", oldValue: null, newValue: notCopied.join(" · "), actorUserId });
    }

    finishReceipt(conn, receipt, { accountId, entityType: "play", keeperId, loserId, keeperLabel: keeper.title, loserLabel: loser.title, actorUserId });
    return { keeperId, followUpsRelinked: followUpIds.length, fieldsFilled, notCopied };
  })();
}

// ---- two records of one meeting ---------------------------------------------

// Nothing in this app matches a meeting by its content — no importer creates
// one — so unlike a play this cannot be resurrected by a diff. What it can be
// is half-undone: the Archived block offers Restore for every archived row,
// and a restored loser would come back with its follow-ups and attendees now
// answering to the keeper. Hence the same pointer, and the same refusal in
// restoreEntity.
const MEETING_FILLABLE = ["summary", "held_time"] as const;

// What MeetingPatch will accept. A union past either of these must not become
// a ZodError thrown from inside the transaction, which would lose the whole
// merge over the thing that made it worth doing (DECISIONS #27).
const MAX_ATTENDEES = 50;
const MAX_NOTES = 200_000;

export type MeetingMergeResult = {
  keeperId: string;
  followUpsRelinked: number;
  fieldsFilled: string[];
  notCopied: string[];
};

/** What a meeting merge is about to do. See planPlayMerge for why this exists. */
type MeetingMergePlan = {
  keeper: MeetingRow;
  loser: MeetingRow;
  /** Includes raw_notes, which is a LARGE_FIELD — never hand this to a page. */
  patch: Record<string, unknown>;
  attendeesAdded: number;
  notes: "keep-both" | "keeper-only" | "too-long";
  followUpIds: string[];
  notCopied: string[];
};

function planMeetingMerge(conn: ReturnType<typeof db>, accountId: string, keeperId: string, loserId: string): MeetingMergePlan {
  if (keeperId === loserId) throw new ApplyError("those are the same meeting", "validation");

  const get = (id: string) => conn.prepare(`SELECT * FROM meetings WHERE id = ?`).get(id) as MeetingRow | undefined;
  const keeper = get(keeperId);
  const loser = get(loserId);
  if (!keeper) throw new ApplyError(`meeting ${keeperId} not found`, "not_found");
  if (!loser) throw new ApplyError(`meeting ${loserId} not found`, "not_found");
  if (keeper.account_id !== accountId || loser.account_id !== accountId) {
    throw new ApplyError("both meetings must be on the same account", "validation");
  }
  if (keeper.archived_at) throw new ApplyError("the meeting you are merging into is archived; restore it first", "state");
  if (keeper.merged_into) throw new ApplyError("that meeting has already been merged into another one", "state");
  if (loser.merged_into) throw new ApplyError("that meeting has already been merged away", "state");

  const notCopied: string[] = [];
  const patch: Record<string, unknown> = fillBlanks(keeper, loser, MEETING_FILLABLE);

  // Who was in the room is the union of both lists — each of us ticked the
  // people we remembered — deduped, and capped at what the schema takes.
  // A list that cannot be read is not an empty one, so it is left exactly as
  // it is and said out loud rather than unioned onto nothing.
  const mineAttendees = parseAttendees(keeper.attendees_json);
  const theirAttendees = parseAttendees(loser.attendees_json);
  let attendeesAdded = 0;
  if (mineAttendees === null) {
    notCopied.push("the attendees, because this record's own list could not be read");
  } else if (theirAttendees === null) {
    notCopied.push(`the attendees of \u201c${loser.title}\u201d, whose list could not be read`);
  } else {
    // Against the keeper's own list deduped, not against its length. The
    // stored list can legitimately name one person twice — two of us ticked
    // the same row — and that duplicate cancelled out a genuinely new
    // attendee: two in, two out, no patch, and the person the other record
    // remembered was dropped as the record was archived as merged. See the
    // same correction on the play links above.
    const mine = dedupeAttendees(mineAttendees);
    const merged = dedupeAttendees([...mineAttendees, ...theirAttendees]);
    if (merged.length > mine.length) {
      // The keeper's come first, and dedupe keeps the first mention, so the
      // slice can only ever drop the loser's.
      patch.attendees = merged.slice(0, MAX_ATTENDEES);
      attendeesAdded = Math.min(merged.length, MAX_ATTENDEES) - mine.length;
      if (merged.length > MAX_ATTENDEES) notCopied.push(`${merged.length - MAX_ATTENDEES} attendees past the ${MAX_ATTENDEES} a meeting holds`);
    }
  }

  // Two sets of notes, and `raw_notes` is a LARGE_FIELD — history keeps its
  // size, not its text, so this column is the only copy there has ever been.
  // Phase 7 answered this shape for a collision and the answer is the same
  // here: keep both, under a line saying which record each half came from.
  const mine = (keeper.raw_notes ?? "").trimEnd();
  const theirs = (loser.raw_notes ?? "").trim();
  let notes: MeetingMergePlan["notes"] = "keeper-only";
  if (theirs !== "" && theirs !== mine.trim()) {
    const joined = mine === "" ? theirs : `${mine}\n\n\u2014\u2014\u2014\nFrom \u201c${loser.title}\u201d (${loser.held_at}):\n\n${theirs}`;
    if (joined.length <= MAX_NOTES) {
      patch.raw_notes = joined;
      notes = "keep-both";
    } else {
      notes = "too-long";
      notCopied.push(`the notes from \u201c${loser.title}\u201d, which do not fit in one record \u2014 they are still on it`);
    }
  }

  // A brief is a dated document (DECISIONS #9): it was written for one of
  // these two records, on a day, from what was known then. Merging two would
  // forge a third that nobody wrote. The keeper's stands, and this says so.
  if (loser.brief_json && keeper.brief_json) notCopied.push(`the brief written for \u201c${loser.title}\u201d`);
  else if (loser.brief_json) notCopied.push(`the brief written for \u201c${loser.title}\u201d \u2014 generate one here if you want it`);

  const followUpIds = conn
    .prepare(`SELECT id FROM action_items WHERE account_id = ? AND meeting_id = ?`)
    .pluck()
    .all(accountId, loserId) as string[];

  return { keeper, loser, patch, attendeesAdded, notes, followUpIds, notCopied };
}

export function mergeMeetings(input: {
  accountId: string;
  keeperId: string;
  loserId: string;
  actorUserId: string | null;
}): MeetingMergeResult {
  const conn = db();
  return conn.transaction((): MeetingMergeResult => {
    const { accountId, keeperId, loserId, actorUserId } = input;
    const receipt = beginReceipt(conn, accountId, "meeting", keeperId, loserId);
    const { keeper, loser, patch, followUpIds, notCopied } = planMeetingMerge(conn, accountId, keeperId, loserId);

    let fieldsFilled: string[] = [];
    if (Object.keys(patch).length > 0) {
      fieldsFilled = applyEntityChange({
        accountId,
        entityType: "meeting",
        op: "update",
        entityId: keeperId,
        payload: patch,
        actorUserId,
      }).changedFields;
    }

    for (const id of followUpIds) {
      applyEntityChange({ accountId, entityType: "action_item", op: "update", entityId: id, payload: { meeting_id: keeperId }, actorUserId });
    }

    // The `source_ref` blobs naming this meeting — on follow-ups, and in
    // change_log — are followed at read time, never rewritten. A stored quote
    // says which conversation it came from; editing that is forging it. Same
    // position the deal merge took on its own refs.

    if (!loser.archived_at) {
      archiveEntity({ accountId, entityType: "meeting", entityId: loserId, actorUserId });
    }
    conn
      .prepare(`UPDATE proposals SET status = 'rejected', decided_by = ?, decided_at = ? WHERE status = 'pending' AND entity_type = 'meeting' AND entity_id = ?`)
      .run(actorUserId, Date.now(), loserId);

    conn.prepare(`UPDATE meetings SET merged_into = ?, updated_at = ? WHERE id = ?`).run(keeperId, Date.now(), loserId);

    logRow(conn, { accountId, entityType: "meeting", entityId: keeperId, field: "merged_from", oldValue: null, newValue: `${loser.title} (${loser.held_at})`, actorUserId });
    logRow(conn, { accountId, entityType: "meeting", entityId: loserId, field: "merged_into", oldValue: null, newValue: `${keeper.title} (${keeper.held_at})`, actorUserId });
    if (notCopied.length > 0) {
      logRow(conn, { accountId, entityType: "meeting", entityId: keeperId, field: "merged_not_copied", oldValue: null, newValue: notCopied.join(" \u00b7 "), actorUserId });
    }

    finishReceipt(conn, receipt, { accountId, entityType: "meeting", keeperId, loserId, keeperLabel: `${keeper.title} (${keeper.held_at})`, loserLabel: `${loser.title} (${loser.held_at})`, actorUserId });
    return { keeperId, followUpsRelinked: followUpIds.length, fieldsFilled, notCopied };
  })();
}

// ---- what a merge is about to do, for the screen ---------------------------

/**
 * The summary a page renders. Counts and sentences only.
 *
 * Deliberately carries no payload: the meeting plan's `patch` holds the joined
 * `raw_notes`, and this is rendered inside a closed `ActionForm`, which
 * serialises its children into the RSC payload whether or not anyone opens it.
 * Putting the text in here would ship both sets of notes to draw one sentence
 * — the trap this app has fallen into twice.
 */
export type MergePreview = {
  loserLabel: string;
  fieldsFilled: string[];
  followUps: number;
  notCopied: string[];
  dealsAdded?: number;
  peopleAdded?: number;
  attendeesAdded?: number;
  notes?: "keep-both" | "keeper-only" | "too-long";
};

export type PreviewResult = { ok: true; preview: MergePreview } | { ok: false; why: string };

function preview(run: () => MergePreview): PreviewResult {
  try {
    return { ok: true, preview: run() };
  } catch (e) {
    // A pair the guards would refuse says so before the press rather than as a
    // red line after it. Anything that is not a refusal is a real fault and is
    // not swallowed.
    if (e instanceof ApplyError) return { ok: false, why: e.message };
    throw e;
  }
}

export function previewPlayMerge(input: { accountId: string; keeperId: string; loserId: string }): PreviewResult {
  return preview(() => {
    const plan = planPlayMerge(db(), input.accountId, input.keeperId, input.loserId);
    return {
      loserLabel: plan.loser.title,
      fieldsFilled: Object.keys(plan.fill),
      followUps: plan.followUpIds.length,
      notCopied: plan.notCopied,
      dealsAdded: plan.dealsAdded,
      peopleAdded: plan.peopleAdded,
    };
  });
}

export function previewMeetingMerge(input: { accountId: string; keeperId: string; loserId: string }): PreviewResult {
  return preview(() => {
    const plan = planMeetingMerge(db(), input.accountId, input.keeperId, input.loserId);
    return {
      loserLabel: `${plan.loser.title} (${plan.loser.held_at})`,
      fieldsFilled: Object.keys(plan.patch).filter((k) => k !== "raw_notes" && k !== "attendees"),
      followUps: plan.followUpIds.length,
      notCopied: plan.notCopied,
      attendeesAdded: plan.attendeesAdded,
      notes: plan.notes,
    };
  });
}
