"use client";

// New meeting, with the option of pasting the invite instead of typing it.
//
// Meetings are the loop this whole app is built around, and creating one was a
// title, a date, a time and a checkbox per attendee, typed before every call.
//
// The paste is the only model call in this app whose answer is not written
// anywhere: it fills these fields in and you press Create. That keeps
// DECISIONS #1 — a person presses the thing that writes — without a new
// proposal origin, a migration, or a review screen for something that is four
// fields. It also means a bad read costs nothing: clear the box and type.
import { useState } from "react";
import { ActionForm } from "./ActionForm";
import { Button, Callout, control, Field } from "./ui";
import { useAiRun } from "./useAiRun";
import type { ActionResult } from "./attempt";

export type InviteAttendee = { name: string; email: string | null; contactId: string | null };

export type InviteResult = {
  title: string;
  heldAt: string;
  heldTime: string | null;
  timeNote: string | null;
  attendees: InviteAttendee[];
  dropped: string[];
};

type Draft = {
  title: string;
  heldAt: string;
  heldTime: string;
  contactIds: string[];
  otherNames: string;
  note: string | null;
  dropped: string[];
};

export function MeetingNew({
  accountId,
  action,
  contacts,
  today,
  pasteDisabledReason,
  compact = false,
}: {
  accountId: string;
  action: (fd: FormData) => Promise<ActionResult | void>;
  contacts: Array<{ id: string; name: string }>;
  today: string;
  /** Why the paste cannot run — no credentials, or a run already in flight. */
  pasteDisabledReason?: string | null;
  /** Place the two entry controls together; expanded editors keep full width. */
  compact?: boolean;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  // Remounts the form so the uncontrolled fields pick up new defaults. The
  // alternative is making every input controlled, which buys nothing here:
  // nothing reads them back until submit.
  const [generation, setGeneration] = useState(0);
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState("");
  const { start, state, error, busy } = useAiRun<InviteResult>();

  // The run finished. Applying it in an event handler rather than during
  // render, which is where a side effect belongs.
  function apply(r: InviteResult) {
    const matched = r.attendees.filter((a) => a.contactId);
    const unmatched = r.attendees.filter((a) => !a.contactId);
    setDraft({
      title: r.title,
      heldAt: r.heldAt,
      heldTime: r.heldTime ?? "",
      contactIds: matched.map((a) => a.contactId!),
      // Recorded on the meeting under the name the invite used. Nobody is
      // added to the account behind your back: add them from People if they
      // are worth keeping.
      otherNames: unmatched.map((a) => a.name).join(", "),
      note: r.timeNote,
      dropped: r.dropped,
    });
    setGeneration((g) => g + 1);
    setPasting(false);
    setText("");
  }

  async function read() {
    // The result arrives on `state` through useAiRun's polling, not from here.
    await start(`/api/accounts/${accountId}/meeting-invite`, { text });
  }

  // useAiRun holds the finished run; pick it up once.
  const finished = state?.status === "done" ? (state.result as InviteResult | null) : null;
  const [seen, setSeen] = useState<InviteResult | null>(null);
  if (finished && finished !== seen) {
    setSeen(finished);
    apply(finished);
  }

  return (
    <div className={compact && !pasting && !draft ? "flex flex-wrap items-start gap-2" : undefined}>
      {!pasting ? (
        <div className={compact && !draft ? "" : "mb-3"}>
          <Button variant="quiet" onClick={() => setPasting(true)} data-testid="invite-paste-open">
            Paste invite
          </Button>
          {pasteDisabledReason && <span className="ml-2 text-micro text-ink-muted">{pasteDisabledReason}</span>}
        </div>
      ) : (
        <div className="animate-rise mb-3 rounded-lg bg-surface-sunk p-3" data-testid="invite-paste">
          <Field
            label="Paste the invite, the agenda, or the email"
            hint="Nothing is saved until you press Create meeting, so a bad read costs nothing."
            wide
          >
            <textarea
              name="invite_text"
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className={control}
              data-testid="invite-text"
              placeholder={"Quarterly business review\nWhen: Wednesday 15 September 2027, 10:00 (Eastern Time)\nRequired: Dana Whitfield <dana.whitfield@example.com>"}
            />
          </Field>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button
              onClick={read}
              disabled={Boolean(pasteDisabledReason) || busy || text.trim().length < 20}
              aria-busy={busy}
              data-testid="invite-paste-submit"
            >
              {busy ? "Reading…" : "Read it"}
            </Button>
            <Button variant="quiet" onClick={() => setPasting(false)}>
              Cancel
            </Button>
            {pasteDisabledReason && <span className="text-micro text-ink-muted">{pasteDisabledReason}</span>}
          </div>
          {(error || state?.status === "failed") && (
            <Callout tone="danger" className="mt-3">
              {error ?? state?.error ?? "The invite could not be read. Fill the form in below."}
            </Callout>
          )}
        </div>
      )}

      {draft && (
        <Callout tone="neutral" className="mb-3" testId="invite-read">
          <p>Read from the invite. Check it, then create the meeting.</p>
          {/* Timezone arithmetic is done in code, not by the model — and it
              says what it did, because a meeting an hour out is worse than one
              with no time at all. */}
          {draft.note && <p className="mt-1 text-micro">{draft.note}</p>}
          {draft.dropped.length > 0 && (
            <p className="mt-1 text-micro">
              Left out, for not appearing in the paste: {draft.dropped.join("; ")}
            </p>
          )}
          {draft.otherNames && (
            <p className="mt-1 text-micro">
              Not on this account: {draft.otherNames}. They are recorded on the meeting under those names; add them under People if they are worth
              keeping.
            </p>
          )}
        </Callout>
      )}

      <ActionForm key={generation} action={action} testId="meeting-new" trigger="New meeting" submitLabel="Create meeting" open={draft !== null}>
        <Field label="Title" wide>
          <input name="title" required defaultValue={draft?.title ?? ""} className={control} placeholder="e.g. Quarterly review with IT leadership" />
        </Field>
        <Field label="Date">
          <input name="held_at" type="date" required defaultValue={draft?.heldAt ?? today} className={control} />
        </Field>
        <Field label="Time" hint="Optional. It decides what is next on the day.">
          <input name="held_time" type="time" defaultValue={draft?.heldTime ?? ""} className={control} />
        </Field>
        <Field label="Attendees from this account" wide>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5">
            {contacts.map((c) => (
              <label key={c.id} className="flex items-center gap-1.5 text-label">
                <input
                  type="checkbox"
                  name="attendee_contact_ids"
                  value={c.id}
                  defaultChecked={draft?.contactIds.includes(c.id) ?? false}
                  className="size-4 accent-accent"
                />
                {c.name}
              </label>
            ))}
            {contacts.length === 0 && <span className="text-label text-ink-muted">No people on this account yet.</span>}
          </div>
        </Field>
        <Field label="Other attendees (comma separated)" wide>
          <input name="attendee_names" defaultValue={draft?.otherNames ?? ""} className={control} />
        </Field>
      </ActionForm>
    </div>
  );
}
