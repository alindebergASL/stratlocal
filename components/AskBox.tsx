"use client";

// The question box, and the live view of a question being answered.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAiRun } from "./useAiRun";
import { Dictate, joinDictation } from "./Dictate";
import { AskMarkdown } from "@/lib/ask/markdown";
import type { InitialRun } from "@/lib/ai/runState";
import { Button, controlSm } from "./ui";

type Props = {
  /** Asking more on a conversation that exists; otherwise a new one. */
  threadId?: string;
  /** A new conversation on this account. */
  accountId?: string;
  /** From ⌘K: the question to ask as soon as the page opens. */
  initialQuestion?: string;
  /** Set while the conversation still has a question being answered. */
  busy?: boolean;
  placeholder?: string;
  /** A new conversation about a record or a page, as "deal:ID" (lib/ask/focus.ts). */
  focus?: string;
  /** A report template the new question follows (lib/ask/templates.ts). */
  templateId?: string;
};

export function AskBox({ threadId, accountId, initialQuestion, busy = false, placeholder, focus, templateId }: Props) {
  const router = useRouter();
  const [question, setQuestion] = useState(initialQuestion ?? "");
  const [temporary, setTemporary] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  async function ask(text: string, replace = false) {
    const q = text.trim();
    if (q.length < 2 || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, ...(threadId ? { threadId } : { accountId, save: !temporary, ...(focus ? { focus } : {}), ...(templateId ? { templateId } : {}) }) }),
      });
      const body = (await res.json().catch(() => ({}))) as { threadId?: string; error?: string };
      if (!res.ok || !body.threadId) {
        setError(body.error ?? "Could not ask that.");
        return;
      }
      setQuestion("");
      if (threadId) router.refresh();
      // Replace, from ⌘K: going back must not land on a URL that asks again.
      else if (replace) router.replace(`/ask/${body.threadId}`);
      else router.push(`/ask/${body.threadId}`);
    } catch {
      setError("Could not confirm the question was sent. Reload to check before asking again.");
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    if (!initialQuestion || started.current) return;
    started.current = true;
    void ask(initialQuestion, true);
    // Once, on arrival from ⌘K.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disabled = sending || busy;
  return (
    <form
      className="space-y-2"
      data-testid="ask-box"
      onSubmit={(e) => {
        e.preventDefault();
        void ask(question);
      }}
    >
      <label className="sr-only" htmlFor="ask-question">Your question</label>
      <textarea
        id="ask-question"
        name="question"
        rows={3}
        maxLength={4000}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void ask(question);
          }
        }}
        placeholder={placeholder ?? "Ask about any account, deal, person or meeting"}
        className={`${controlSm} min-h-20 w-full resize-y py-2`}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {threadId ? (
          <span className="text-micro text-ink-muted">Enter to ask, Shift+Enter for a new line.</span>
        ) : (
          <label className="flex items-center gap-2 text-label text-ink-muted">
            <input type="checkbox" checked={temporary} onChange={(e) => setTemporary(e.target.checked)} data-testid="ask-temporary" />
            Don’t save this one
          </label>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2">
        <Dictate onText={(said) => setQuestion((q) => joinDictation(q, said))} disabled={disabled} label="Speak" testId="ask-dictate" size="md" />
        <Button type="submit" disabled={disabled || question.trim().length < 2} data-testid="ask-submit">
          {sending ? "Asking…" : busy ? "Still answering…" : "Ask"}
        </Button>
        </span>
      </div>
      {error && <p role="alert" className="text-label text-danger">{error}</p>}
    </form>
  );
}

type Progress = { steps?: string[]; draft?: string };

/** What the agent has looked at so far, while it works; the error if it failed. */
// After this long, say what a long wait means: it is still working, and the
// page can be left — the answer is kept on the conversation either way.
const SLOW_AFTER_S = 20;

export function AskLive({ run, startedAt }: { run: InitialRun<Progress>; startedAt?: number }) {
  const { state, error } = useAiRun<Progress>(run);
  const [now, setNow] = useState(() => Date.now());
  const running = state?.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  const [began] = useState(() => startedAt ?? Date.now());
  const seconds = Math.max(0, Math.round((now - began) / 1000));
  if (!state) return null;
  if (state.status === "failed") {
    return (
      <p role="alert" className="rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-label text-ink" data-testid="ask-failed">
        That question could not be answered: {state.error ?? "the run failed"}. Ask it again, or put it another way.
      </p>
    );
  }
  if (state.status !== "running") return null;
  const steps = state.result?.steps ?? [];
  const draft = state.result?.draft;
  // The answer as it is being written. Its markers are plain until it is
  // finished and checked; then the kept answer replaces this.
  if (draft) {
    return (
      <div className="rounded-xl border border-line bg-surface p-4 sm:p-5" aria-live="polite" aria-busy="true" data-testid="ask-draft">
        <AskMarkdown text={draft} marker={(n) => <sup className="ml-0.5 text-micro text-ink-muted">[{n}]</sup>} />
        <p className="mt-2 flex items-center gap-2 text-micro text-ink-muted">
          <span aria-hidden className="size-2 animate-pulse rounded-full bg-accent" />
          Writing… sources are checked when it finishes.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-line bg-surface-sunk/60 px-3 py-2" aria-live="polite" data-testid="ask-working">
      <p className="flex items-center gap-2 text-label font-semibold text-ink">
        <span aria-hidden className="size-2 animate-pulse rounded-full bg-accent" />
        {steps.length ? "Looking through the records…" : "Reading the question…"}
        <span className="ml-auto text-micro font-normal tabular-nums text-ink-muted" data-testid="ask-elapsed">{seconds}s</span>
      </p>
      {seconds >= SLOW_AFTER_S && (
        <p className="mt-1 text-micro text-ink-muted" data-testid="ask-slow">
          A question that reads several records can take up to a minute. You can leave this page: the answer is kept here.
        </p>
      )}
      {steps.length > 0 && (
        <ol className="mt-1 space-y-0.5 pl-4 text-micro text-ink-muted" data-testid="ask-steps">
          {steps.map((s, i) => <li key={i} className="list-disc">{s}</li>)}
        </ol>
      )}
      {error && <p className="mt-1 text-micro text-ink-muted">{error}</p>}
    </div>
  );
}
