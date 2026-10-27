"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { attempt, type ActionResult } from "@/components/attempt";
import { Button, control } from "@/components/ui";
import { Icon } from "@/components/icons";

type Question = { id: string; owner: string; text: string; accountName: string; href: string; whose: string | null };
type Pick = { label: string; day: string; shown: string };

// "When did they say?" — one promise at a time. A date goes onto the
// follow-up through the ordinary save; "they didn't say" closes the question
// for good without touching the follow-up.
export function PromiseQuestions({
  questions,
  picks,
  today,
  answer,
  dismiss,
}: {
  questions: Question[];
  picks: Pick[];
  today: string;
  answer: (id: string, fd: FormData) => Promise<ActionResult>;
  dismiss: (id: string) => Promise<ActionResult>;
}) {
  const router = useRouter();
  // Dealt once, like the change deck: answering refreshes the page, and the
  // refreshed list (one shorter) must not reshuffle the cards or replace the
  // finish with an empty state.
  const [dealt] = useState(() => questions);
  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [day, setDay] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const q = dealt[index];

  function next(counted: boolean) {
    if (counted) setAnswered((n) => n + 1);
    setIndex((i) => i + 1);
    setDay("");
    setError(null);
  }

  function run(action: () => Promise<ActionResult>) {
    start(async () => {
      const r = await attempt(action);
      if (r.ok) next(true);
      else setError(r.error);
    });
  }

  function withDay(d: string) {
    const fd = new FormData();
    fd.set("due", d);
    run(() => answer(q!.id, fd));
  }

  if (dealt.length === 0) {
    return <p className="text-label text-ink-muted">No questions. Every customer promise has a date, or you told Promise keeper they did not give one.</p>;
  }

  if (!q) {
    return (
      <div className="animate-card-in rounded-3xl border border-line bg-surface p-6 text-center shadow-raised" data-testid="promise-questions-done">
        <svg aria-hidden viewBox="0 0 52 52" className="draw-check mx-auto size-12 text-positive">
          <circle cx="26" cy="26" r="24" className="fill-positive-soft stroke-positive-line" strokeWidth="2" />
          <path d="M15 27l7 7 15-16" className="fill-none stroke-current" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="mt-3 font-display text-lead font-bold text-ink-strong">{answered > 0 ? `${answered} answered.` : "No questions left."}</p>
        {answered > 0 && <Button className="mt-4" variant="quiet" onClick={() => router.refresh()}>Show the updated list</Button>}
      </div>
    );
  }

  return (
    <article key={q.id} className="animate-card-in rounded-3xl border border-line bg-surface p-5 shadow-raised sm:p-7" data-testid="promise-question">
      <div className="flex items-center justify-between gap-3 text-micro text-ink-muted">
        <span className="font-semibold uppercase tracking-wide text-accent">{q.accountName}{q.whose && <span className="font-normal normal-case tracking-normal text-ink-muted"> · {q.whose}&apos;s account</span>}</span>
        <span>{index + 1} of {dealt.length}</span>
      </div>
      <p className="mt-3 text-label text-ink-muted"><span className="font-semibold text-ink-strong">{q.owner}</span> promised</p>
      <h2 className="mt-1 font-display text-heading font-bold text-ink-strong [overflow-wrap:anywhere] sm:text-title">{q.text}</h2>
      <p className="mt-3 text-label text-ink">No date was written down. When did they say?</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {picks.map((p) => (
          <Button key={p.day} variant="quiet" className="min-h-11 rounded-xl" disabled={pending} onClick={() => withDay(p.day)} data-testid="promise-pick">
            {p.label} <span className="font-normal text-ink-muted">· {p.shown}</span>
          </Button>
        ))}
      </div>
      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (day) withDay(day); }}>
        <label className="text-micro text-ink-muted">
          Another day
          <input type="date" min={today} value={day} onChange={(e) => setDay(e.target.value)} className={`${control} mt-1 block max-w-48`} data-testid="promise-date" />
        </label>
        <Button type="submit" variant="quiet" className="min-h-11 rounded-xl" disabled={pending || !day}>Set date</Button>
      </form>
      {error && <p role="alert" className="mt-3 text-label text-danger">{error}</p>}
      <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Button variant="ghost" className="min-h-11" disabled={pending} onClick={() => run(() => dismiss(q.id))} data-testid="promise-no-date">They did not say</Button>
        <Button variant="ghost" className="min-h-11" disabled={pending} onClick={() => next(false)} data-testid="promise-skip">Skip</Button>
        <Link href={q.href} className="ml-auto inline-flex min-h-11 items-center gap-1 text-label font-semibold text-accent hover:underline">
          Open the follow-up <Icon name="arrow" className="size-3.5" />
        </Link>
      </div>
    </article>
  );
}
