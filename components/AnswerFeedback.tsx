"use client";

// Useful or Wrong on an answer. Wrong asks what was wrong, in a line, so the
// misses can be read together on /ask/feedback and the prompts and tools
// fixed from them. None of it is shown to the model.
import { useState, useTransition } from "react";
import { attempt } from "./attempt";
import { Button, controlSm } from "./ui";
import { judgeAnswerAction } from "@/app/ask/actions";

type Verdict = "useful" | "wrong" | null;

export function AnswerFeedback({ messageId, initial, initialNote }: { messageId: string; initial: Verdict; initialNote: string | null }) {
  const [verdict, setVerdict] = useState<Verdict>(initial);
  const [writing, setWriting] = useState(false);
  const [note, setNote] = useState(initialNote ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = (v: Verdict, n: string | null) =>
    start(async () => {
      setError(null);
      const r = await attempt(() => judgeAnswerAction(messageId, v, n));
      if (!r.ok) return setError(r.error);
      setVerdict(v);
      setWriting(false);
    });
  const chip = (on: boolean) =>
    `inline-flex min-h-8 items-center rounded-full border px-2.5 text-micro font-semibold transition-colors ${on ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-muted hover:bg-surface-sunk hover:text-ink"}`;
  return (
    <div className="space-y-2" data-print-hide data-testid="answer-feedback">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-micro text-ink-muted">Was this right?</span>
        <button type="button" disabled={pending} aria-pressed={verdict === "useful"} className={chip(verdict === "useful")} onClick={() => save(verdict === "useful" ? null : "useful", null)} data-testid="answer-useful">
          Useful
        </button>
        <button type="button" disabled={pending} aria-pressed={verdict === "wrong"} className={chip(verdict === "wrong")} onClick={() => setWriting(true)} data-testid="answer-wrong">
          Wrong
        </button>
        {verdict === "wrong" && !writing && note && <span className="min-w-0 truncate text-micro text-ink-muted">“{note}”</span>}
      </div>
      {writing && (
        <form
          className="flex flex-wrap items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save("wrong", note);
          }}
        >
          <label className="sr-only" htmlFor={`wrong-${messageId}`}>What was wrong</label>
          <input id={`wrong-${messageId}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="What was wrong, in a line (optional)" className={`${controlSm} min-w-0 flex-1`} data-testid="answer-wrong-note" />
          <Button type="submit" size="sm" disabled={pending} data-testid="answer-wrong-save">Mark it wrong</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setWriting(false)}>Cancel</Button>
        </form>
      )}
      {error && <p role="alert" className="text-micro text-danger">{error}</p>}
    </div>
  );
}
