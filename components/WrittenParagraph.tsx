import Link from "next/link";
import type { Written } from "@/lib/writer/core";

// A paragraph the Writer wrote (DECISIONS #106), each sentence followed by
// numbered chips for the records it rests on. The counted version sits under
// "Show the counts", so what it was written from is always one press away.
export function WrittenParagraph({ written, counts, testId }: { written: Written; counts: React.ReactNode; testId: string }) {
  const numbered = new Map<string, number>();
  const refs: Array<{ n: number; label: string; href: string | null }> = [];
  for (const s of written.sentences)
    for (const r of s.refs)
      if (!numbered.has(r.key)) {
        numbered.set(r.key, refs.length + 1);
        refs.push({ n: refs.length + 1, label: r.label, href: r.href });
      }
  return (
    <div data-testid={testId}>
      <p className="text-lead leading-relaxed text-ink">
        {written.sentences.map((s, i) => (
          <span key={i}>
            {s.text}
            {s.refs.map((r) => {
              const n = numbered.get(r.key)!;
              return r.href ? (
                <Link key={r.key} href={r.href} className="ml-0.5 align-super text-micro font-semibold text-accent hover:underline" title={r.label} data-testid="written-ref">[{n}]</Link>
              ) : (
                <sup key={r.key} className="ml-0.5 text-micro text-ink-muted" title={r.label}>[{n}]</sup>
              );
            })}
            {i < written.sentences.length - 1 ? " " : ""}
          </span>
        ))}
      </p>
      <details className="mt-1 text-micro text-ink-muted">
        <summary className="cursor-pointer hover:text-ink" data-testid="written-show-counts">Written from your records · show the counts</summary>
        <ol className="mt-1 space-y-0.5">
          {refs.map((r) => (
            <li key={r.n}>[{r.n}] {r.href ? <Link href={r.href} className="hover:text-accent hover:underline">{r.label}</Link> : r.label}</li>
          ))}
        </ol>
        <div className="mt-2">{counts}</div>
      </details>
    </div>
  );
}
