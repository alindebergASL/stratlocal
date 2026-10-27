"use client";

// Questions to ask with one press: an answer's suggested next questions, or
// starters drawn from the records (lib/ask/starters.ts). A press asks it like
// any typed question — on the conversation, or as a new one.
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AskChips({ questions, threadId, accountId, busy = false, testId = "ask-chips" }: { questions: string[]; threadId?: string; accountId?: string; busy?: boolean; testId?: string }) {
  const router = useRouter();
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!questions.length) return null;
  async function ask(question: string) {
    if (sending || busy) return;
    setSending(question);
    setError(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, ...(threadId ? { threadId } : accountId ? { accountId } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as { threadId?: string; error?: string };
      if (!res.ok || !body.threadId) return setError(body.error ?? "Could not ask that.");
      if (threadId) router.refresh();
      else router.push(`/ask/${body.threadId}`);
    } catch {
      setError("Could not confirm the question was sent. Reload to check before asking again.");
    } finally {
      setSending(null);
    }
  }
  return (
    <div data-print-hide>
      <ul className="flex flex-wrap gap-2" data-testid={testId}>
        {questions.map((q) => (
          <li key={q}>
            <button
              type="button"
              disabled={!!sending || busy}
              onClick={() => void ask(q)}
              className="rounded-full border border-accent-line bg-accent-soft px-3 py-1.5 text-left text-label text-ink transition-colors hover:border-accent disabled:opacity-60"
            >
              {sending === q ? "Asking…" : q}
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-1 text-label text-danger">{error}</p>}
    </div>
  );
}
