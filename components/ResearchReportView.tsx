import { ResearchSource } from "@/lib/research/schema";

// Prose is deliberately plain React text, never model-authored HTML. Viewing
// the report (even on an accepted note) does not accept its unselected claims.
export function ResearchReportView({ text, sources, partial = false, open = false }: { text: string; sources: string[]; partial?: boolean; open?: boolean }) {
  const links = [...new Set(sources)].filter((url) => ResearchSource.safeParse(url).success);
  return (
    <details data-testid="research-full-report" open={open} className="mt-4 rounded-lg border border-line p-3">
      <summary className="cursor-pointer font-semibold text-ink">{partial ? "Saved research report and sources (partial)" : "Full research report and sources"}</summary>
      <p className="mt-2 text-micro text-ink-muted">Unreviewed original report. Only findings you explicitly accept may inform briefs and plans.</p>
      <div data-testid="research-full-report-text" className="mt-3 whitespace-pre-wrap break-words text-ink">{text || "No report text was returned."}</div>
      <h4 className="mt-4 font-semibold">Sources returned by the research tools ({links.length})</h4>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-label">
        {links.map((url) => {
          const parsed = new URL(url);
          // Keep the original source, but never make a deceptive userinfo URL clickable.
          return <li key={url}>{parsed.username || parsed.password
            ? <span className="break-all">{url} (not linked: URL contains credentials)</span>
            : <a className="break-all text-accent underline" href={url} target="_blank" rel="noopener noreferrer">{url}</a>}</li>;
        })}
      </ul>
    </details>
  );
}
