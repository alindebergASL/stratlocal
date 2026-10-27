"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { attempt, type ActionResult } from "./attempt";
import { Button, Chip, control } from "./ui";
import { Icon } from "./icons";

export type PlanCard =
  | {
      kind: "play";
      id: string;
      accountName: string;
      accountHref: string;
      playTitle: string;
      playHref: string;
      status: string;
      why: string;
      nextStep: string | null;
      version: number;
    }
  | {
      kind: "thesis";
      id: string;
      accountName: string;
      accountHref: string;
      claim: string;
      quote: string;
      meetingTitle: string;
      meetingHref: string;
      question: string;
      thesis: string;
      version: number;
    };

type Pick = { label: string; day: string; shown: string };

type Answers = {
  setNextStep: (id: string, fd: FormData) => Promise<ActionResult>;
  setStatus: (id: string, status: "active" | "stalled" | "dropped", version: number) => Promise<ActionResult>;
  editThesis: (id: string, fd: FormData) => Promise<ActionResult>;
  dismiss: (id: string) => Promise<ActionResult>;
};

// Plan keeper's questions, one at a time, like the backlog sorter. Each
// answer is an ordinary edit; "It's fine" and "Still holds" close the
// question and change nothing.
export function PlanQuestions({ cards, picks, today, answers, showAccount = true }: { cards: PlanCard[]; picks: Pick[]; today: string; answers: Answers; showAccount?: boolean }) {
  const router = useRouter();
  const [dealt] = useState(() => cards);
  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [mode, setMode] = useState<"ask" | "step" | "thesis">("ask");
  const [step, setStep] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const card = dealt[index];

  const next = (counted: boolean) => {
    if (counted) setAnswered((n) => n + 1);
    setIndex((i) => i + 1);
    setMode("ask");
    setStep("");
    setDue("");
    setError(null);
  };
  const run = (action: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await attempt(action);
      if (r.ok) next(true);
      else setError(r.error);
    });

  if (dealt.length === 0) return <p className="text-label text-ink-muted" data-testid="plan-questions-none">No questions. Every live play is moving, has a next step, and nothing recent sits against the thesis.</p>;

  if (!card) {
    return (
      <div className="animate-card-in rounded-3xl border border-line bg-surface p-6 text-center shadow-raised" data-testid="plan-questions-done">
        <svg aria-hidden viewBox="0 0 52 52" className="draw-check mx-auto size-12 text-positive">
          <circle cx="26" cy="26" r="24" className="fill-positive-soft stroke-positive-line" strokeWidth="2" />
          <path d="M15 27l7 7 15-16" className="fill-none stroke-current" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="mt-3 font-display text-lead font-bold text-ink-strong">{answered > 0 ? `${answered} answered. The plan is current.` : "Nothing left to ask."}</p>
        {answered > 0 && <Button className="mt-4" variant="quiet" onClick={() => router.refresh()}>Show the updated plan</Button>}
      </div>
    );
  }

  return (
    <article key={card.id} className="animate-card-in rounded-3xl border border-line bg-surface p-5 shadow-raised sm:p-7" data-testid="plan-question">
      <div className="flex items-center justify-between gap-3 text-micro text-ink-muted">
        {showAccount ? <Link href={card.accountHref} className="font-semibold uppercase tracking-wide text-accent hover:underline">{card.accountName}</Link> : <span className="font-semibold uppercase tracking-wide text-accent">{card.kind === "play" ? "Play" : "Thesis"}</span>}
        <span>{index + 1} of {dealt.length}</span>
      </div>

      {card.kind === "play" ? (
        <>
          <h2 className="mt-2 flex flex-wrap items-center gap-2 font-display text-heading font-bold text-ink-strong sm:text-title">
            <Link href={card.playHref} className="hover:underline [overflow-wrap:anywhere]">{card.playTitle}</Link>
            <Chip>{card.status}</Chip>
          </h2>
          <p className="mt-2 text-body text-ink">{card.why}</p>
          {card.nextStep && <p className="mt-1 text-label text-ink-muted">Next step on file: {card.nextStep}</p>}
          {mode === "step" ? (
            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData();
                fd.set("next_step", step);
                fd.set("due", due);
                fd.set("base_version", String(card.version));
                run(() => answers.setNextStep(card.id, fd));
              }}
            >
              <label className="block text-micro text-ink-muted">
                The next step
                <input autoFocus value={step} onChange={(e) => setStep(e.target.value)} maxLength={300} className={`${control} mt-1`} placeholder="e.g. Book the sizing workshop with the operations lead" data-testid="plan-step" />
              </label>
              <div className="flex flex-wrap gap-2">
                {picks.map((p) => (
                  <button key={p.day} type="button" onClick={() => setDue(p.day)} aria-pressed={due === p.day} className={`rounded-lg border px-3 py-1.5 text-label ${due === p.day ? "border-accent bg-accent-soft text-accent" : "border-control-line text-ink"}`}>
                    {p.label} <span className="text-ink-muted">· {p.shown}</span>
                  </button>
                ))}
                <input type="date" min={today} value={due} onChange={(e) => setDue(e.target.value)} className={`${control} max-w-44`} aria-label="Due date" />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={pending || !step.trim()} data-testid="plan-step-save">Save the next step</Button>
                <Button variant="ghost" onClick={() => setMode("ask")}>Back</Button>
              </div>
            </form>
          ) : (
            <div className="mt-5 flex flex-wrap gap-2">
              <Button className="min-h-11 rounded-xl" disabled={pending} onClick={() => { setStep(""); setMode("step"); }} data-testid="plan-set-step">Set the next step</Button>
              <Button className="min-h-11 rounded-xl" variant="quiet" disabled={pending} onClick={() => run(() => answers.setStatus(card.id, "stalled", card.version))} data-testid="plan-stalled">Mark stalled</Button>
              <Button className="min-h-11 rounded-xl" variant="quiet" disabled={pending} onClick={() => run(() => answers.setStatus(card.id, "dropped", card.version))} data-testid="plan-drop">Drop the play</Button>
              <Button className="min-h-11" variant="ghost" disabled={pending} onClick={() => run(() => answers.dismiss(card.id))} data-testid="plan-fine">It&apos;s fine</Button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="mt-3 text-micro font-semibold uppercase tracking-wide text-ink-muted">The thesis says</p>
          <blockquote className="mt-1 border-l-2 border-accent pl-3 text-body text-ink-strong">“{card.claim}”</blockquote>
          <p className="mt-3 text-micro font-semibold uppercase tracking-wide text-ink-muted">
            In <Link href={card.meetingHref} className="text-accent hover:underline">{card.meetingTitle || "a recent meeting"}</Link> you wrote
          </p>
          <blockquote className="mt-1 border-l-2 border-warning pl-3 text-body text-ink">“{card.quote}”</blockquote>
          <p className="mt-4 font-medium text-ink-strong">{card.question}</p>
          {mode === "thesis" ? (
            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                fd.set("base_version", String(card.version));
                run(() => answers.editThesis(card.id, fd));
              }}
            >
              <textarea name="thesis" defaultValue={card.thesis} rows={6} className={control} data-testid="plan-thesis" aria-label="Account thesis" />
              <div className="flex gap-2">
                <Button type="submit" disabled={pending} data-testid="plan-thesis-save">Save the thesis</Button>
                <Button variant="ghost" onClick={() => setMode("ask")}>Back</Button>
              </div>
            </form>
          ) : (
            <div className="mt-5 flex flex-wrap gap-2">
              <Button className="min-h-11 rounded-xl" disabled={pending} onClick={() => setMode("thesis")} data-testid="plan-edit-thesis">Edit the thesis</Button>
              <Button className="min-h-11 rounded-xl" variant="quiet" disabled={pending} onClick={() => run(() => answers.dismiss(card.id))} data-testid="plan-holds">Still holds</Button>
            </div>
          )}
        </>
      )}

      {error && <p role="alert" className="mt-3 text-label text-danger">{error}</p>}
      <div className="mt-5 flex items-center justify-between border-t border-line pt-3">
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => next(false)} data-testid="plan-skip">Skip</Button>
        <span className="inline-flex items-center gap-1 text-micro text-ink-muted"><Icon name="sparkle" className="size-3.5" />Plan keeper asks; nothing changes until you answer.</span>
      </div>
    </article>
  );
}
