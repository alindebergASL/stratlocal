import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { researchCoverage, DOSSIER_TOPICS } from '@/lib/research/coverage';
import { ResearchCoverageView } from '@/components/ResearchCoverageView';
import type { ResearchFinding } from '@/lib/research/schema';
const finding=(topic:ResearchFinding['topic']):ResearchFinding=>({topic,text:'A supported fact.',quote:'A supported fact.',url:'https://example.com',date:null,confidence:'medium'});
it('marks a procurement-only result partial without rewarding URL volume',()=>{
 const c=researchCoverage([finding('procurement'),finding('procurement')]);
 expect(c.status).toBe('partial');expect(c.missing).toContain('leadership');expect(c.missing).toContain('technology');expect(c.counts.procurement).toBe(2);
 const html=renderToStaticMarkup(createElement(ResearchCoverageView,{coverage:c}));expect(html).toContain('Partial account research');expect(html).toContain('Leadership');expect(html).toContain('No findings in this pass');
});
it('distinguishes broad topic coverage from verification or completeness',()=>{
 const c=researchCoverage(DOSSIER_TOPICS.map(finding),{status:'complete',reasons:[]});expect(c.status).toBe('broad');expect(c.missing).toEqual([]);
 const html=renderToStaticMarkup(createElement(ResearchCoverageView,{coverage:c}));expect(html).toContain('not independent verification');expect(html).not.toContain('Research complete');
});
it('flags capture truncation but not a removed finding-count limit',()=>{
 const all=DOSSIER_TOPICS.map(finding);expect(researchCoverage(all,{status:'partial',reasons:['Output limit reached']}).status).toBe('partial');
 const larger=[...all,...Array.from({length:33},()=>finding('technology'))];expect(researchCoverage(larger)).toMatchObject({status:'broad',reasons:[]});
});
it('marks excluded findings partial even with every category represented',()=>{
 const c=researchCoverage(DOSSIER_TOPICS.map(finding),{status:'complete',reasons:[]},2);expect(c.status).toBe('partial');expect(c.reasons.join(' ')).toContain('2 extracted finding(s)');
});
it('empty or other-only evidence cannot satisfy dossier coverage',()=>{
 expect(researchCoverage([]).missing).toEqual([...DOSSIER_TOPICS]);expect(researchCoverage([finding('other')]).status).toBe('partial');
});
