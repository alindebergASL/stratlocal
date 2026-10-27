import type { ResearchFinding } from './schema';
export const DOSSIER_TOPICS=['org','leadership','financial','strategy','technology','procurement','risk','peers'] as const;
export type CaptureStatus={status:'complete'|'partial';reasons:string[]};
export type ResearchCoverage={status:'broad'|'partial';counts:Record<typeof DOSSIER_TOPICS[number],number>;missing:Array<typeof DOSSIER_TOPICS[number]>;reasons:string[]};
// This measures extracted topic coverage, never truth, verification or the world.
export function researchCoverage(findings:ResearchFinding[],capture?:CaptureStatus, excluded=0):ResearchCoverage{
 const counts=Object.fromEntries(DOSSIER_TOPICS.map(t=>[t,findings.filter(f=>f.topic===t).length])) as ResearchCoverage['counts'];
 const missing=DOSSIER_TOPICS.filter(t=>counts[t]===0);
 const reasonLabels:Record<string,string>={max_tokens:'The model output limit was reached; the saved report may be incomplete.',continuation_limit:'The bounded research continuation limit was reached.',tool_budget_exhausted:'The search/fetch allowance was exhausted; additional research may be needed.',interrupted:'The server restarted during the research; this is what it had found by then.'};
 const reasons=[...(capture?.status==='partial'?capture.reasons.map(r=>reasonLabels[r]??r):[])];
 if(capture?.status==='partial'&&!reasons.length)reasons.push('Research answer capture is partial.');
 if(excluded>0)reasons.push(`${excluded} extracted finding(s) were excluded because evidence validation failed.`);

 return {status:missing.length||reasons.length?'partial':'broad',counts,missing:[...missing],reasons};
}
