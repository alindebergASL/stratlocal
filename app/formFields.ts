// Reading a form, separately from acting on it.
//
// These are the parts of app/actions.ts that decide what a submission *means*,
// pulled out because a "use server" module may only export async functions and
// because every bug this file guards against was invisible from the screen:
// the action returned success and something was gone. tests/actions.test.ts
// drives them directly.
import { Attendee } from "@/lib/proposals/schema";

// Reading an amount lives in lib/money.ts now, because the spreadsheet import
// needs the same reader and a lib/ module importing from app/ is the wrong
// direction. Re-exported here so every caller and every test reads the same
// way it always did.
export { FieldError, readMoney } from "@/lib/money";
import { readMoney } from "@/lib/money";

export function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export function num(fd: FormData, key: string): number | null {
  const s = str(fd, key);
  if (s === null) return null;
  const n = Number(s.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Only the fields the form actually rendered. An absent input means "this form
// does not edit that field", not "clear it" — the distinction `savePlay` and
// `quickDealUpdate` already made with `fd.has`. Without it, every deal edit
// wiped `stage_label`, because the deal form has no such input and the payload
// therefore carried an explicit null.
export function present<T>(fd: FormData, key: string, read: () => T): T | undefined {
  return fd.has(key) ? read() : undefined;
}

export function money(fd: FormData, key: string, label: string): number | null {
  return readMoney(fd.get(key) === null ? null : String(fd.get(key)), label);
}

export function buildDealPayload(fd: FormData): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    // `name` and `status` skip present() deliberately: both are non-nullable
    // in DealPatch, so present() would push null and throw on every blank.
    // `fiscal_quarter` is nullable and used to be lumped in with them, which
    // meant emptying the box on the deal page deleted the key, let the quarter
    // be re-derived from close_date, and reported success having changed
    // nothing — with no way back to unset.
    name: str(fd, "name") ?? undefined,
    stage: present(fd, "stage", () => num(fd, "stage")),
    stage_label: present(fd, "stage_label", () => str(fd, "stage_label")),
    close_date: present(fd, "close_date", () => str(fd, "close_date")),
    fiscal_quarter: present(fd, "fiscal_quarter", () => str(fd, "fiscal_quarter")),
    tcv_usd: present(fd, "tcv_usd", () => money(fd, "tcv_usd", "TCV")),
    competitor: present(fd, "competitor", () => str(fd, "competitor")),
    partner: present(fd, "partner", () => str(fd, "partner")),
    // Rendered read-only on the deal page, in DealPatch, and in the CSV — and
    // read by nothing here, so only the report import could ever write it and
    // a wrong value could be seen and not corrected.
    architecture: present(fd, "architecture", () => str(fd, "architecture")),
    owner: present(fd, "owner", () => str(fd, "owner")),
    next_step: present(fd, "next_step", () => str(fd, "next_step")),
    notes: present(fd, "notes", () => str(fd, "notes")),
    status: str(fd, "status") ?? undefined,
  };
  for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
  return payload;
}

// The pipeline review's payload, which is a different shape from the deal
// page's: five fields, each edited from a list row, and every one of them
// guarded by `fd.has` because the quick edit renders a subset of the deal.
// `status` and `name` are not lumped in with the deal form's non-nullable pair
// here — status *is* rendered as a select, so it always arrives, and name is
// never editable from the list at all.
export function buildQuickDealPayload(fd: FormData): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    stage: present(fd, "stage", () => num(fd, "stage")),
    next_step: present(fd, "next_step", () => str(fd, "next_step")),
    status: present(fd, "status", () => str(fd, "status") ?? "open"),
    // The two a review actually changes. Slipping a close date used to mean
    // the deal page, a disclosure, a save, and a list that had lost your
    // place — per deal, down a quarter's worth of pipeline.
    close_date: present(fd, "close_date", () => str(fd, "close_date")),
    tcv_usd: present(fd, "tcv_usd", () => money(fd, "tcv_usd", "Value")),
  };
  for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
  return payload;
}

// Who was in the room.
//
// This rebuilt the list from the rendered checkboxes, and the picker was
// live-only — so archiving a contact and later fixing a typo in the meeting's
// title silently deleted that person from the meeting, name and all. The play
// form solved this long ago with the `_present` convention and renders an
// archived-but-linked person checked; the meeting form never got it. `known`
// is therefore every contact on the account, archived included, and the form
// is responsible for rendering the archived attendees it already has.
//
// Existing notes are carried across rather than reset: a note says something
// about that meeting, and every save used to blank it. Nothing is sliced to
// the schema's limit either — letting it fail is a visible error, where
// trimming here dropped the rest without a word.
export function buildMeetingAttendees(
  fd: FormData,
  known: Array<{ id: string; name: string }>,
  existing: Attendee[] = [],
): Attendee[] {
  const byId = new Map(known.map((c) => [c.id, c.name]));
  const noteById = new Map(existing.filter((a) => a.contact_id).map((a) => [a.contact_id!, a.note]));
  const noteByName = new Map(existing.filter((a) => !a.contact_id).map((a) => [a.name, a.note]));
  const picked = fd
    .getAll("attendee_contact_ids")
    .map(String)
    .filter((id) => byId.has(id))
    .map((id) => ({ contact_id: id, name: byId.get(id)!, note: noteById.get(id) ?? null }));
  const extra = (str(fd, "attendee_names") ?? "")
    .split(/[,\n]/)
    .map((n) => n.trim())
    .filter(Boolean)
    .map((name) => ({ contact_id: null, name, note: noteByName.get(name) ?? null }));
  return [...picked, ...extra];
}
