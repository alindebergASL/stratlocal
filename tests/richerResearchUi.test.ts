import {expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ResearchForm} from '@/app/accounts/[id]/research/ResearchForm';
import {researchCoverage} from '@/lib/research/coverage';
import {BUDGETS} from '@/lib/ai/runWebResearch';
import {estimateCostCents,searchCostCents} from '@/lib/ai/cost';
import {extractResearchNote} from '@/lib/research/extract';
import {runStructured} from '@/lib/ai/runStructured';
// The real budgets and the real rate, so a copy change that quietly stopped
// matching what a run actually spends would show up here.
const DEPTHS={standard:{...BUDGETS.standard,cents:searchCostCents(BUDGETS.standard.searches)},deep:{...BUDGETS.deep,cents:searchCostCents(BUDGETS.deep.searches)}};
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock('@/lib/ai/runStructured',()=>({runStructured:vi.fn(async()=>({data:{title:'Dossier',summary:'',findings:[],open_questions:[]},attempts:1}))}));
it('says what a run found in fetches, never pages read',()=>{
 const html=renderToStaticMarkup(createElement(ResearchForm,{accountId:'a',depths:DEPTHS,initialRun:{id:'r',state:{status:'done',error:null,cost_cents:59,cost_estimated:true,result:{documentId:'d',findings:2,sources:67,searches:8,fetches:5,dropped:[],attempts:1,coverage:researchCoverage([])}}}}));
 expect(html).toContain('New from this run');expect(html).toContain('5 pages fetched');expect(html).not.toContain('pages read');expect(html).not.toContain('67 pages');expect(html).toContain('checked=""');
});
it('extracts a broad scoped dossier rather than a short call note',async()=>{
 await extractResearchNote({companyName:'Public university',prose:'Full report',sources:new Map()},[]);
 const sent=vi.mocked(runStructured).mock.calls.at(-1)![0];
 expect(sent.system).toContain('account dossier');expect(sent.system).toContain('across the entire report');expect(sent.system).toContain('leadership/governance');expect(sent.system).toContain('parent-system, campus');expect(sent.system).toContain('A planned system is not installed');expect(sent.system).toContain('A fact with no URL');
});

it('shows partial saved capture even when extraction fails, without claiming a complete report',()=>{
 const html=renderToStaticMarkup(createElement(ResearchForm,{accountId:'a',depths:DEPTHS,initialRun:{id:'r',state:{status:'failed',error:'Extraction unavailable',cost_cents:59,cost_estimated:true,result:{documentId:null,findings:0,sources:2,searches:8,fetches:5,dropped:[],attempts:0,report:{text:'Retained fragment',sources:[],capture:{status:'partial',reasons:['max_tokens']}}}}}}));
 expect(html).toContain('Partial saved research report');expect(html).toContain('output limit');expect(html).toContain('Retained fragment');expect(html).not.toContain('complete saved report');
});

it('says what a run will cost before it is pressed, at the rate it will be charged',()=>{
 // Phase 6 could not do this honestly — the search rate was unknown, and the
 // screen said "several times the cost" with no number until after the money
 // was spent. The rate is published now, so the figure on the button and the
 // figure recorded afterwards are the same arithmetic over the same constant.
 const html=renderToStaticMarkup(createElement(ResearchForm,{accountId:'a',depths:DEPTHS}));
 expect(html).toContain('15 searches');
 expect(html).toContain('10 pages fetched');
 expect(html).toContain('$0.15');
 expect(html).toContain('$0.08');
 // The claim has to be the one estimateCostCents would make for the same run,
 // not a number typed into the markup beside it.
 const charged=estimateCostCents([{name:'s',provider:'direct',model:'fake',usage:{}},{name:'r',provider:'direct',model:'claude-opus-5',usage:{server_tool_use:{web_search_requests:BUDGETS.deep.searches}}}]);
 expect(charged?.cents).toBe(DEPTHS.deep.cents);
 // And a fetch is not quoted as money, because it does not cost any.
 expect(DEPTHS.deep.cents).toBe(searchCostCents(BUDGETS.deep.searches));
});
