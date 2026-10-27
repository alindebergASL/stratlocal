import { DOSSIER_TOPICS, type ResearchCoverage } from '@/lib/research/coverage';
import { TOPIC_LABELS } from '@/lib/research/schema';
// `compact` drops the per-topic count grid and keeps only what its neighbour
// cannot say. Beside the review checklist — which is grouped by topic and
// whose headings already read "Leadership · 3 of 4 kept" — the grid printed
// the same number again a few hundred pixels away. What it alone knows is
// which topics this pass came back empty on, and that is the half worth
// reading before you accept.
export function ResearchCoverageView({coverage,compact=false}:{coverage:ResearchCoverage;compact?:boolean}){
 // Beside a review, one plain line: what came back empty, and why the pass
 // may be short. The heading and the verification caveat were two of three
 // disclaimers stacked above the first finding; the review says it once.
 if(compact) return <p data-testid="research-coverage" className="mb-3 text-label text-ink-muted">
  {coverage.missing.length?<>Nothing found this time on {coverage.missing.map(t=>TOPIC_LABELS[t].replace(/^The /,'the ')).join(', ')}.</>:'Every topic came back with something.'}
  {coverage.reasons.map((r,i)=><span key={i}> {r}</span>)}
 </p>;
 return <div data-testid="research-coverage" className="my-3 rounded-lg border border-line p-3 text-label">
  <p className="font-semibold">{coverage.status==='partial'?'Partial account research':'Broad topic coverage'}</p>
  <p className="mt-1 text-micro text-ink-muted">Coverage of extracted findings, not independent verification or proof the account is fully researched.</p>
  {compact
   ? <p className="mt-2">{coverage.missing.length
      ? <><span className="font-medium">No findings in this pass:</span> {coverage.missing.map(t=>TOPIC_LABELS[t]).join(', ')}.</>
      : 'Every dossier topic came back with something.'}</p>
   : <ul className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">{DOSSIER_TOPICS.map(t=><li key={t}><span className="font-medium">{TOPIC_LABELS[t]}:</span> {coverage.counts[t]?`${coverage.counts[t]} finding${coverage.counts[t]===1?'':'s'}`:'No findings in this pass'}</li>)}</ul>}
  {coverage.reasons.map((r,i)=><p key={i} className="mt-2 text-micro text-ink-muted">{r}</p>)}
 </div>;
}
