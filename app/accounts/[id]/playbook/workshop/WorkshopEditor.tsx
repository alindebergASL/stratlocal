"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, control, controlSm } from "@/components/ui";
import { ResultButton } from "@/components/ResultButton";
import { suggestPlacement } from "@/lib/playbook/placement";
import { addMinutes, type UseCase, type Workshop } from "@/lib/playbook/workshopShape";
import type { Playbook } from "@/lib/playbook/schema";

type Result = { ok: true; message?: string; basis?: number } | { ok: false; error: string };

const RELEVANCE = ["Not at all", "A little", "Matters", "Decides it"];

// The workshop plan for one account: the agenda from the playbook, who is
// invited, and the use cases the line of business brings, each scored and
// placed by the playbook's rubric as you go.
export function WorkshopEditor({
  accountId,
  initial,
  basis: initialBasis,
  agenda,
  rubric,
  contacts,
  save,
  addToRoadmap,
}: {
  accountId: string;
  initial: Workshop;
  basis: number | null;
  agenda: Array<{ id: string; name: string; minutes: number; focus: string; lead: string | null }>;
  rubric: Playbook["placement"];
  contacts: Array<{ id: string; name: string; title: string | null }>;
  save: (json: string, basis: number | null) => Promise<Result>;
  addToRoadmap: (useCaseId: string) => Promise<Result>;
}) {
  const router = useRouter();
  const [w, setW] = useState<Workshop>(initial);
  const [basis, setBasis] = useState(initialBasis);
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  // A newer version from the server (a use case put on the roadmap, someone
  // else's save) replaces what is shown, unless there are edits not yet saved.
  const [seen, setSeen] = useState(initialBasis);
  if (initialBasis !== seen && !dirty) {
    setSeen(initialBasis);
    setW(initial);
    setBasis(initialBasis);
  }
  const edit = (next: Workshop) => {
    setW(next);
    setDirty(true);
    setNote(null);
  };
  const setCase = (id: string, patch: Partial<UseCase>) => edit({ ...w, use_cases: w.use_cases.map((u) => (u.id === id ? { ...u, ...patch } : u)) });
  const total = agenda.reduce((s, a) => s + a.minutes, 0);
  let clock = w.start;

  return (
    <div className="space-y-6" data-testid="workshop-editor">
      <div className="flex flex-wrap gap-3">
        <Field label="Date">
          <input type="date" className={control} value={w.date ?? ""} onChange={(e) => edit({ ...w, date: e.target.value || null })} data-testid="workshop-date" />
        </Field>
        <Field label="Starts at">
          <input type="time" className={control} value={w.start ?? ""} onChange={(e) => edit({ ...w, start: e.target.value || null })} data-testid="workshop-start" />
        </Field>
      </div>

      <div>
        <h3 className="text-label font-semibold text-ink-strong">Agenda · {total} minutes</h3>
        <ol className="mt-2 divide-y divide-line rounded-lg border border-line" data-testid="workshop-agenda">
          {agenda.map((a) => {
            const from = clock;
            if (clock) clock = addMinutes(clock, a.minutes);
            return (
              <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2">
                <span className="min-w-0">
                  <span className="font-semibold text-ink">{a.name}</span>
                  {a.focus && <span className="block text-micro text-ink-muted">{a.focus}</span>}
                </span>
                <span className="shrink-0 text-micro text-ink-muted tabular-nums">
                  {from ? `${from}–${clock} · ` : ""}
                  {a.minutes} min{a.lead ? ` · ${a.lead}` : ""}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <div>
        <h3 className="text-label font-semibold text-ink-strong">Invited</h3>
        {contacts.length === 0 ? (
          <p className="mt-1 text-label text-ink-muted">
            No people on the account yet. <Link href={`/accounts/${accountId}/people`} className="font-semibold text-accent hover:underline">Add the line-of-business leaders</Link> and invite them here.
          </p>
        ) : (
          <ul className="mt-1 grid gap-x-4 sm:grid-cols-2" data-testid="workshop-invitees">
            {contacts.map((c) => (
              <li key={c.id}>
                <label className="flex min-h-9 items-start gap-2 py-1 text-label">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-accent"
                    checked={w.invitees.includes(c.id)}
                    onChange={(e) => edit({ ...w, invitees: e.target.checked ? [...w.invitees, c.id] : w.invitees.filter((x) => x !== c.id) })}
                  />
                  <span>
                    <span className="text-ink">{c.name}</span>
                    {c.title && <span className="block text-micro text-ink-muted">{c.title}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-label font-semibold text-ink-strong">Use cases · {w.use_cases.length}</h3>
          <Button
            type="button"
            size="sm"
            variant="quiet"
            data-testid="workshop-add-use-case"
            onClick={() => edit({ ...w, use_cases: [...w.use_cases, { id: `uc-${Date.now().toString(36)}`, name: "New use case", department: "", notes: "", value: null, feasibility: null, relevance: {}, phase: null, play_id: null }] })}
          >
            Add a use case
          </Button>
        </div>
        <ul className="mt-2 space-y-3">
          {w.use_cases.map((u) => {
            const placed = rubric ? suggestPlacement(rubric, u.relevance) : null;
            const priority = u.value && u.feasibility ? u.value * u.feasibility : null;
            return (
              <li key={u.id} className="rounded-lg border border-line p-3" data-testid="workshop-use-case">
                <div className="flex flex-wrap gap-3">
                  <Field label="Use case" wide>
                    <input className={control} value={u.name} maxLength={200} onChange={(e) => setCase(u.id, { name: e.target.value })} data-testid="use-case-name" />
                  </Field>
                  <Field label="Department">
                    <input className={control} value={u.department} maxLength={120} onChange={(e) => setCase(u.id, { department: e.target.value })} />
                  </Field>
                  <Field label="Value">
                    <select className={control} value={u.value ?? ""} onChange={(e) => setCase(u.id, { value: e.target.value ? Number(e.target.value) : null })} data-testid="use-case-value">
                      <option value="">—</option>
                      {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </Field>
                  <Field label="Feasibility">
                    <select className={control} value={u.feasibility ?? ""} onChange={(e) => setCase(u.id, { feasibility: e.target.value ? Number(e.target.value) : null })} data-testid="use-case-feasibility">
                      <option value="">—</option>
                      {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </Field>
                  <Field label="Notes" wide>
                    <textarea className={control} rows={2} maxLength={1000} value={u.notes} onChange={(e) => setCase(u.id, { notes: e.target.value })} />
                  </Field>
                </div>
                {rubric && rubric.criteria.length > 0 && (
                  <details className="mt-2" open={Object.keys(u.relevance).length > 0}>
                    <summary className="cursor-pointer text-label font-semibold text-ink">Where should it run?</summary>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {rubric.criteria.map((c) => (
                        <label key={c.id} className="block text-micro text-ink-muted">
                          {c.name}
                          <select
                            className={`${controlSm} mt-0.5 w-full`}
                            value={u.relevance[c.id] ?? 0}
                            onChange={(e) => setCase(u.id, { relevance: { ...u.relevance, [c.id]: Number(e.target.value) } })}
                            data-testid="use-case-relevance"
                          >
                            {RELEVANCE.map((r, i) => <option key={r} value={i}>{r}</option>)}
                          </select>
                        </label>
                      ))}
                    </div>
                  </details>
                )}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
                  <p className="min-w-0 text-label text-ink" data-testid="use-case-placement">
                    {placed?.best ? (
                      <>
                        <span className="font-semibold">Run: {placed.best.name}</span>
                        {placed.why.length > 0 && <span className="text-ink-muted">, because of {placed.why.map((x) => x.criterion.toLowerCase()).join(", ")}</span>}
                      </>
                    ) : (
                      <span className="text-ink-muted">{rubric ? "Rate the criteria to see where it should run." : "The playbook has no placement rubric."}</span>
                    )}
                    {priority !== null && <span className="ml-2 text-micro text-ink-muted tabular-nums">priority {priority}/25</span>}
                  </p>
                  <span className="flex flex-wrap items-center gap-2">
                    <select className={controlSm} value={u.phase ?? ""} onChange={(e) => setCase(u.id, { phase: e.target.value ? Number(e.target.value) : null })} aria-label="Roadmap phase" data-testid="use-case-phase">
                      <option value="">No phase</option>
                      <option value="1">Phase 1</option>
                      <option value="2">Phase 2</option>
                      <option value="3">Phase 3</option>
                    </select>
                    {u.play_id ? (
                      <Link href={`/accounts/${accountId}/plays/${u.play_id}`} className="text-label font-semibold text-accent hover:underline" data-testid="use-case-play">On the roadmap →</Link>
                    ) : dirty ? (
                      <span className="text-micro text-ink-muted">Save, then add to the roadmap</span>
                    ) : (
                      u.phase && <ResultButton run={() => addToRoadmap(u.id)} testId="use-case-roadmap">Add to roadmap</ResultButton>
                    )}
                    {!u.play_id && (
                      <Button type="button" size="sm" variant="quiet" onClick={() => edit({ ...w, use_cases: w.use_cases.filter((x) => x.id !== u.id) })}>
                        Remove
                      </Button>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <Button
          type="button"
          disabled={pending || !dirty}
          data-testid="workshop-save"
          onClick={() =>
            start(async () => {
              try {
                const r = await save(JSON.stringify(w), basis);
                if (r.ok) {
                  setBasis(r.basis ?? basis);
                  setDirty(false);
                  setNote({ ok: true, text: r.message ?? "Saved." });
                  router.refresh();
                } else setNote({ ok: false, text: r.error });
              } catch {
                setNote({ ok: false, text: "The request did not come back. Reload to see what happened." });
              }
            })
          }
        >
          {pending ? "Saving…" : "Save the workshop"}
        </Button>
        {note && <span role={note.ok ? "status" : "alert"} className={`text-label ${note.ok ? "text-positive" : "text-danger"}`}>{note.text}</span>}
      </div>
    </div>
  );
}
