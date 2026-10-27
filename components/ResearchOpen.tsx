import type { BuyingRole } from "@/lib/research/schema";

const LIKELY: Record<BuyingRole["likely"], string> = {
  signer: "Likely signs",
  blocker: "Could block",
  influencer: "Likely shapes it",
  user: "Likely uses it",
  unknown: "Role unclear",
};

// What we still need to find out: the open questions every kept run left,
// and who might sign, block or shape a decision, as questions for discovery.
// The buying group is a guess from public sources and is labelled as one; it
// never becomes a person on the account without someone adding them.
export function ResearchOpen({ questions, buyingGroup }: { questions: string[]; buyingGroup: BuyingRole[] }) {
  if (questions.length === 0 && buyingGroup.length === 0) return null;
  return (
    <section aria-labelledby="research-open-h" className="mb-6 rounded-xl border border-line bg-surface p-4 sm:p-5" data-testid="research-still-open">
      <h2 id="research-open-h" className="font-display text-heading font-bold text-ink-strong">What we still need to find out</h2>
      {buyingGroup.length > 0 && (
        <>
          <h3 className="mt-3 text-micro font-semibold uppercase tracking-[0.06em] text-ink-muted">Who decides: our guesses to test</h3>
          <ul className="divide-y divide-line" data-testid="research-buying-group">
            {buyingGroup.map((r, i) => (
              <li key={i} className="py-2">
                <p className="text-body text-ink-strong">
                  <span className="mr-1.5 rounded bg-surface-sunk px-1.5 py-px text-micro font-semibold text-ink">{LIKELY[r.likely]}</span>
                  {r.role}
                </p>
                {r.basis && <p className="mt-0.5 text-label text-ink-muted">{r.basis}</p>}
                <p className="mt-1 text-label text-ink">Ask: {r.question}</p>
              </li>
            ))}
          </ul>
        </>
      )}
      {questions.length > 0 && (
        <>
          <h3 className="mt-3 text-micro font-semibold uppercase tracking-[0.06em] text-ink-muted">Not found in public sources</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-label text-ink" data-testid="research-open-questions">
            {questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Open questions from every kept note, newest note first, each said once. */
export function openQuestions(notes: Array<{ generated_at: string; open_questions: string[] }>, max = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of [...notes].sort((a, b) => b.generated_at.localeCompare(a.generated_at))) {
    for (const q of n.open_questions) {
      const key = q.trim().toLowerCase().replace(/[^a-z0-9 ]+/g, "");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(q.trim());
    }
  }
  return out.slice(0, max);
}
