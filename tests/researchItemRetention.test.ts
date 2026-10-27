import {beforeEach,expect,it,vi} from 'vitest';
import {extractResearchNote} from '@/lib/research/extract';
import {urlKey} from '@/lib/ai/runWebResearch';
import type {StageUsage} from '@/lib/ai/cost';
const {create}=vi.hoisted(()=>({create:vi.fn()}));
vi.mock('@/lib/ai/fake',()=>({fakeEnabled:()=>false}));
vi.mock('@/lib/ai/client',()=>({getClient:()=>({messages:{create}})}));
const url='https://example.com/leadership';
const prose='Dana Rivera is the current chief information officer. The public budget is approved.';
const sources=new Map([[urlKey(url)!,url]]);
const good={text:'Dana Rivera is the current chief information officer.',quote:'Dana Rivera is the current chief information officer.',url,topic:'leadership',confidence:'high',date:null};
const unknown={...good,text:'An unsupported vendor claim.',url:'https://invented.invalid/source'};
const badQuote={...good,text:'A second unsupported claim.',quote:'This passage does not occur in the saved report.'};
function reply(findings:unknown[]){return {stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({title:'Public dossier',summary:'Reviewable findings',findings,open_questions:[]})}],usage:{input_tokens:100,output_tokens:200}};}
beforeEach(()=>create.mockReset());
it('keeps valid findings and explicitly drops invalid items without paid provenance repair',async()=>{
 create.mockResolvedValue(reply([good,unknown,badQuote]));const stages:StageUsage[]=[];
 const r=await extractResearchNote({companyName:'Example',prose,sources},stages);
 expect(r.note.findings).toHaveLength(1);expect(r.note.findings[0]?.text).toBe(good.text);
 expect(r.dropped).toHaveLength(2);expect(r.attempts).toBe(1);expect(create).toHaveBeenCalledTimes(1);expect(stages).toHaveLength(1);
 expect(r.note.findings[0]?.evidence?.kind).toBe('report_excerpt');
});
it('never admits invalid items when all provenance checks fail',async()=>{
 create.mockResolvedValue(reply([unknown,badQuote]));const r=await extractResearchNote({companyName:'Example',prose,sources},[]);
 expect(r.note.findings).toEqual([]);expect(r.dropped).toHaveLength(2);expect(create).toHaveBeenCalledTimes(1);
});
