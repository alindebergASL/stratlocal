"use client";

import { useState, useTransition, useLayoutEffect, useRef } from "react";
import { quickDealUpdate } from "@/app/actions";
import { STAGE_LABELS } from "@/lib/format";
import Link from "next/link";
import { Button, controlSm } from "./ui";
import { Icon } from "./icons";
import { attempt, type Conflict } from "./attempt";
import { ConflictNotice } from "./ConflictNotice";
import { useRefreshHold } from "./AccountFreshness";

export function DealQuickEdit({
  accountId,
  dealId,
  stage,
  nextStep,
  status,
  closeDate,
  tcvUsd,
  version,
  linked = null,
}: {
  accountId: string;
  dealId: string;
  stage: number | null;
  nextStep: string | null;
  status: string;
  // The two a pipeline review actually changes. Without them, slipping a
  // close date — the commonest outcome of a review — meant opening the deal
  // page, opening a disclosure, saving, and coming back to a list that had
  // lost your place: two page loads and six clicks, per deal.
  closeDate: string | null;
  tcvUsd: number | null;
  // The row as this table rendered it. All three fields here go over in every
  // submit, so a panel opened before your partner's edit used to revert all
  // three at once — including flipping a deal they had just marked won.
  version: number | null;
  /** Follow-ups recorded against this deal, said under the next step. */
  linked?: { label: string; href: string } | null;
}) {
  const [editing, setEditing] = useState(false);
  useRefreshHold("deal-quick-editor", editing ? "A deal is open for editing here." : null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ info: Conflict; fd: FormData } | null>(null);
  // The version the server last told us the row is at. The hidden field is
  // server-rendered and a refusal does not revalidate, so without this the
  // only exit from a conflict was the destructive override: read their change,
  // adjust yours, press Save, refused again, identically, forever.
  const [known, setKnown] = useState<number | null>(null);
  // The row as it was when this panel was opened. The `version` prop keeps
  // moving underneath an open editor — an RSC refresh re-renders the table —
  // and a hidden field that follows it would hand the server a base version
  // for a row nobody at this keyboard has seen. Held until the panel closes
  // or a refusal replaces it with the version it reported.
  const [basis, setBasis] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const nextStepInput = useRef<HTMLTextAreaElement>(null);
  const fitNextStep = () => {
    const field = nextStepInput.current;
    if (field) { field.style.height = "auto"; field.style.height = `${field.scrollHeight + 2}px`; }
  };
  useLayoutEffect(() => {
    if (!editing) return;
    fitNextStep();
    window.addEventListener("resize", fitNextStep);
    return () => window.removeEventListener("resize", fitNextStep);
  }, [editing]);

  function submit(fd: FormData) {
    if (known !== null) fd.set("base_version", String(known));
    start(async () => {
      setError(null);
      setConflict(null);
      const r = await attempt(() => quickDealUpdate(accountId, dealId, fd));
      if (!r.ok) {
        if (r.conflict) {
          setConflict({ info: r.conflict, fd });
          setKnown(r.conflict.currentVersion);
        } else setError(r.error);
      } else {
        close();
      }
    });
  }

  // Cancel used to be bound to a `close` that was never declared here, so it
  // resolved to window.close — a no-op in a tab the user opened, and typecheck
  // is happy because the global has a compatible signature. Closing also puts
  // the panel back to how it opens, so an amber refusal block cannot survive
  // Cancel and reappear over values that are now correct.
  function close() {
    setEditing(false);
    setError(null);
    setConflict(null);
    setKnown(null);
    setBasis(null);
  }

  if (!editing) {
    // The only affordance used to be a hover underline on bare text, so the
    // single most common edit in the app was invisible. A quiet inline Edit
    // keeps the affordance readable at a glance without turning the word into
    // a primary CTA, and a quiet "Set a next step" stays for the empty case.
    return (
      <div>
        <button
          type="button"
          data-testid={`deal-quick-${dealId}`}
          aria-label={nextStep ? `Edit next step: ${nextStep}` : "Set a next step"}
          onClick={() => {
            setBasis(version);
            setEditing(true);
          }}
          className="group -mx-1.5 min-h-11 w-full rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-surface-sunk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {nextStep ? (
            <span className="flex items-start gap-1.5">
              <span className="min-w-0 flex-1 text-label text-ink">{nextStep}</span>
              <Icon name="pen" className="mt-0.5 size-3.5 shrink-0 text-ink-faint group-hover:text-ink-muted" />
            </span>
          ) : (
            // Quiet: on a list where many deals have none, a warning on every
            // row stops reading as one. The counts above say how many.
            <span className="inline-flex items-center gap-1 text-label text-accent group-hover:underline">
              <span aria-hidden>+</span>Set a next step
            </span>
          )}
        </button>
        {linked && (
          <Link href={linked.href} className="text-micro text-accent hover:underline" data-testid="deal-follow-ups">
            {linked.label} →
          </Link>
        )}
      </div>
    );
  }

  return (
    <form
      className="animate-rise flex max-w-xs flex-col gap-1.5"
      // See the note in ActionForm: a form action makes React empty the form
      // when it resolves, refusal included.
      onSubmit={(e) => {
        e.preventDefault();
        submit(new FormData(e.currentTarget));
      }}
    >
      {basis !== null && <input type="hidden" name="base_version" value={String(basis)} readOnly />}
      <textarea ref={nextStepInput} name="next_step" defaultValue={nextStep ?? ""} rows={2} onInput={fitNextStep} aria-label="Next step" autoFocus className={`${controlSm} resize-none overflow-hidden`} placeholder="Next step" />
      <div className="flex flex-wrap gap-1.5">
        <select name="stage" defaultValue={stage ?? ""} aria-label="Stage" className={controlSm}>
          <option value="">no stage</option>
          {[1, 2, 3, 4, 5, 6].map((s) => (
            <option key={s} value={s}>
              {s} · {STAGE_LABELS[s]}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={status} aria-label="Status" className={controlSm}>
          <option value="open">open</option>
          <option value="won">won</option>
          <option value="lost">lost</option>
        </select>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <input type="date" name="close_date" defaultValue={closeDate ?? ""} aria-label="Close date" className={controlSm} />
        {/* Text, not number: readMoney takes "1.2M" and "250", which is how
            a number gets said out loud in a review. */}
        <input name="tcv_usd" defaultValue={tcvUsd === null ? "" : String(tcvUsd)} aria-label="Value" placeholder="1.2M" className={controlSm} />
      </div>
      {error && (
        <span role="alert" className="text-micro font-medium text-danger">
          {error}
        </span>
      )}
      {conflict && (
        <ConflictNotice
          conflict={conflict.info}
          busy={pending}
          onOverride={() => submit(conflict.fd)}
        >
          <Button type="button" variant="quiet" size="sm" onClick={close}>
            Leave theirs
          </Button>
        </ConflictNotice>
      )}
      <div className="flex gap-1.5">
        <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="quiet" size="sm" onClick={close}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
