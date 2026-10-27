"use client";

// A form bound to a server action that returns {ok, error}. Collapsible so
// the page stays calm: the fields show only after the trigger is clicked.
import { useCallback, useId, useRef, useState, useTransition } from "react";
import { Button, control, Field } from "./ui";
import { attempt, type ActionResult, type Conflict } from "./attempt";
import { ConflictNotice } from "./ConflictNotice";
import { useRefreshHold } from "./AccountFreshness";

// An action either reports a problem or, when it redirects, returns nothing.
type ActionFn = (fd: FormData) => Promise<ActionResult | void>;

export function ActionForm({
  action,
  trigger,
  submitLabel = "Save",
  children,
  className,
  open: openByDefault = false,
  testId,
}: {
  action: ActionFn;
  trigger: string;
  submitLabel?: string;
  children: React.ReactNode;
  className?: string;
  open?: boolean;
  // A handle for the browser flows in e2e/. They used to find forms and
  // buttons by their words, and every one of them broke — repeatedly — on
  // copy changes that were deliberate improvements. Naming the thing rather
  // than quoting it means the flows only break when the behaviour does.
  testId?: string;
}) {
  const [open, setOpen] = useState(openByDefault);
  const [dirty, setDirty] = useState(false);
  const [rejected, setRejected] = useState<{ error: string; fd: FormData } | null>(null);
  const error = rejected?.error ?? null;
  // A refused save keeps the form open with everything typed still in it —
  // the fields are uncontrolled DOM, so they hold what you wrote — plus the
  // FormData that was refused, so Save anyway can resend it with the version
  // the server just handed back rather than the stale one in the hidden field.
  const [conflict, setConflict] = useState<{ info: Conflict; fd: FormData } | null>(null);
  // The version the server last reported, once a refusal has told us one.
  //
  // The hidden field is server-rendered and the conflict path deliberately
  // does not revalidate, so the DOM keeps the stale version forever. Without
  // this, the natural recovery — read what they changed, adjust your text,
  // press Save — was refused again, identically, every time, and the only way
  // out of a refusal was the destructive override. Once you have been shown
  // what the record says, your next save is measured against that.
  const [known, setKnown] = useState<number | null>(null);
  // The version this edit was opened against.
  //
  // The hidden field is server-rendered, and an RSC refresh re-renders it: the
  // fields keep what was typed — they are uncontrolled DOM — but that one
  // input would quietly move on to whatever the record says now. The save
  // would then go out measured against a change nobody here has read, which
  // is the collision check waving through exactly what it exists to refuse.
  // Captured from the DOM when the panel opens, because the field comes from
  // the caller's children rather than from a prop this component holds.
  const basis = useRef<string | null>(null);
  const captureBasis = useCallback((form: HTMLFormElement | null) => {
    if (!form || basis.current !== null) return;
    const field = form.querySelector('input[name="base_version"]');
    if (field instanceof HTMLInputElement) basis.current = field.value;
  }, []);
  const [pending, start] = useTransition();
  useRefreshHold("action-form", open && (dirty || pending || !!conflict || !!rejected) ? "An edit form has unsaved work here." : null);
  const panelId = useId();

  function submit(fd: FormData) {
    // A refusal has already told us where the record is; otherwise it is what
    // was on screen when this opened. Never the live hidden field.
    if (known !== null) fd.set("base_version", String(known));
    else if (basis.current !== null && fd.has("base_version")) fd.set("base_version", basis.current);
    start(async () => {
      setRejected(null);
      setConflict(null);
      const r = await attempt(() => action(fd));
      if (r && !r.ok && r.conflict) {
        setConflict({ info: r.conflict, fd });
        setKnown(r.conflict.currentVersion);
      } else if (r && !r.ok) {
        setRejected({ error: r.error, fd });
      } else {
        close();
      }
    });
  }

  // Closing puts the panel back to how it opens. Without this the amber "not
  // saved" block survived Cancel and reopened above fresh, correct values.
  function close() {
    setOpen(false);
    setConflict(null);
    setRejected(null);
    setKnown(null);
    basis.current = null;
    setDirty(false);
  }



  if (!open) {
    return (
      <Button variant="quiet" onClick={() => setOpen(true)} aria-expanded={false} aria-controls={panelId} data-testid={testId ? `${testId}-open` : undefined}>
        {trigger}
      </Button>
    );
  }

  return (
    <form
      id={panelId}
      ref={captureBasis}
      onInput={() => setDirty(true)}
      onChange={() => setDirty(true)}
      data-testid={testId}
      className={className ?? "animate-rise mt-2 flex basis-full flex-wrap items-end gap-3 rounded-lg border border-line bg-surface-sunk p-3"}
      // onSubmit rather than `action`, which is not a style choice. React 19
      // empties an uncontrolled form once a form action resolves — right for
      // a save that worked, wrong for one that was refused, which clears the
      // edit while the notice above it says nothing was lost. Restoring the
      // values afterwards loses the race, because the reset is part of
      // committing the action. Not handing React the action means it never
      // resets, and what someone typed stays where they typed it.
      onSubmit={(e) => {
        e.preventDefault();
        submit(new FormData(e.currentTarget));
      }}
    >
      {children}
      {error && (
        <p role="alert" className="basis-full text-micro font-medium text-danger">
          {error}
        </p>
      )}
      {conflict && (
        <ConflictNotice
          conflict={conflict.info}
          busy={pending}
          onOverride={() => {
            // submit() already carries the version the server reported; this
            // resends exactly what was typed rather than re-reading the DOM,
            // so nothing typed since the refusal is silently included.
            submit(conflict.fd);
          }}
        >
          <Button variant="quiet" onClick={close}>
            Leave theirs
          </Button>
        </ConflictNotice>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending} aria-busy={pending} data-testid={testId ? `${testId}-submit` : undefined}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <Button variant="quiet" onClick={close}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// Re-exported so the call sites that reach for a field and an input class keep
// one definition behind them; both now live in components/ui.tsx.
export { Field };
export const inputCls = control;
