import {expect,it,vi} from 'vitest';
import {fakeAnswer} from '@/lib/ai/fake';
import {SuggestedUpdates} from '@/lib/research/updates';
it('dense deterministic withheld replay stays inside unchanged 12-suggestion cap',()=>{
 vi.stubEnv('AI_FAKE_REPLAY','withheld-update');
 try {
  const evidence=Array.from({length:24},(_,i)=>({id:`synthetic-note#${i}`,noteId:'synthetic-note',index:i,asOf:'2026-09-18',scope:'synthetic',finding:{text:`Synthetic procurement signal ${i}`,quote:`Synthetic procurement signal ${i}`,topic:'procurement',url:`https://sources.example.test/${i}`,date:null,confidence:'medium'}}));
  const answer=fakeAnswer('plan_draft',{researchUpdates:evidence});
  const parsed=SuggestedUpdates.parse(answer);
  expect(parsed.updates).toHaveLength(12);
  expect(parsed.updates[0]).toMatchObject({type:'account',value:'Replayed Unsupported City'});
 } finally {vi.unstubAllEnvs();}
});

// Fake mode used to build its suggestions from the paraphrase plus the report
// quote, which is not what the grounding check reads. A finding whose
// paraphrase named a person the source excerpt never did then produced a
// contact the check refused — a failure no real run would have, because the
// real model is shown the excerpt. It reads the excerpt now.
it('builds suggestions from the excerpt the check reads, not the paraphrase', () => {
 const finding={text:'Dana Rivera is the chief information officer.',quote:'Dana Rivera is the chief information officer.',topic:'leadership',url:'https://sources.example.test/a',date:null,confidence:'medium',evidence:{kind:'source_excerpt',text:'The authority appointed a new technology leadership team this year.'}};
 const evidence=[{id:'synthetic-note#0',noteId:'synthetic-note',index:0,asOf:'2026-09-18',scope:'synthetic',finding,evidenceText:finding.evidence.text}];
 const parsed=SuggestedUpdates.parse(fakeAnswer('plan_draft',{researchUpdates:evidence}));
 expect(parsed.updates.map(u=>u.type)).toEqual(['follow_up']);
 const named={...finding,evidence:{kind:'source_excerpt',text:'Dana Rivera is the chief information officer.'}};
 const parsed2=SuggestedUpdates.parse(fakeAnswer('plan_draft',{researchUpdates:[{...evidence[0],finding:named,evidenceText:named.evidence.text}]}));
 expect(parsed2.updates[0]).toMatchObject({type:'contact',name:'Dana Rivera'});
});
