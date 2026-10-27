// Independent correction review only. Synthetic in-memory data; mocked streams.
import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as client from '@/lib/ai/client';
import * as ask from '@/lib/ask/run';
import { db, failOrphanedRuns } from '@/lib/db';
import { getRun, BudgetError, startRun } from '@/lib/ai/guard';
import { listMessages } from '@/lib/ask/threads';
import { claimScheduleAttempt, setSchedule, scheduleFor } from '@/lib/ask/schedules';
import { beginAssistantRun } from '@/lib/assistants/runs';
import { runScheduledReports } from '@/lib/assistants/scheduledReports';
import { seedAccount, USER } from './helpers';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
function move(id: string, from: string, to: string) {
 db().prepare('UPDATE deals SET account_id = ? WHERE deal_id = ?').run(to, id);
 db().prepare("INSERT INTO change_log (id, account_id, entity_type, entity_id, field, old_value, new_value, actor_user_id, created_at) VALUES (?, ?, 'deal', ?, 'account_id', ?, ?, ?, ?)").run(randomUUID(), to, id, JSON.stringify(from), JSON.stringify(to), USER, Date.now());
}
async function staleRun(back: boolean, firstFinal: boolean) {
 vi.stubEnv('AI_FAKE', ''); vi.stubEnv('AWS_REGION','us-west-2');
 const a=seedAccount(); const b=seedAccount({name:'Synthetic target',dealId:'SYN-INDEPENDENT-B'});
 let n=0;
 const stream=vi.fn(() => { const round=n++; return {on:vi.fn(), finalMessage:async()=>{
  if(round===0) {move(a.dealId,a.accountId,b.accountId); if(back) move(a.dealId,b.accountId,a.accountId);}
  const call=round===0 && !firstFinal ? {name:'account',input:{account_id:a.accountId}} : {name:'final_answer',input:{text:'Synthetic stale-focus answer.',citations:[]}};
  return {content:[{type:'tool_use',id:`s-${round}`,...call}],usage:{input_tokens:1,output_tokens:1},stop_reason:'tool_use'};
 }};});
 vi.spyOn(client,'getClient').mockReturnValue({messages:{stream}} as unknown as ReturnType<typeof client.getClient>);
 const run=ask.startAsk({userId:USER,question:'Discuss synthetic focused deal',focus:{kind:'deal',id:a.dealId}});
 await vi.waitFor(()=>expect(getRun(run.runId)?.status).not.toBe('running'));
 const messages=listMessages(run.threadId).filter(m=>m.role==='assistant');
 console.log(JSON.stringify({probe:'stale-focus',back,firstFinal,provider_calls:stream.mock.calls.length,status:getRun(run.runId)?.status,assistant_messages:messages.length}));
 return {stream,messages,run};
}
it.each([false,true])('BLOCKER: stale focus must stop before provider continuation (move back %s)',async(back)=>{
 const r=await staleRun(back,false);
 expect(r.stream).toHaveBeenCalledTimes(1);
});
it.each([false,true])('BLOCKER: stale focus must stop uncited/no-chart answer persistence (move back %s)',async(back)=>{
 const r=await staleRun(back,true);
 expect(r.messages).toHaveLength(0);
 expect(getRun(r.run.runId)?.status).toBe('failed');
});
function setupSchedule() {
 vi.stubEnv('AI_FAKE','1'); vi.stubEnv('APP_TIMEZONE','UTC');
 db().prepare("INSERT INTO users (id,email,password_hash,display_name,created_at,updated_at) VALUES (?,'synthetic-independent@example.test','x','Synthetic',0,0)").run(USER);
 setSchedule('weekly_pipeline',{days:[0,1,2,3,4,5,6],at:'00:00',forUserId:USER},USER);
 return new Date('2026-10-26T08:00:00Z');
}
it('synchronous failed attempt remains failed, not skipped',()=>{
 const now=setupSchedule(); vi.spyOn(ask,'startAsk').mockImplementation(()=>{throw new BudgetError('Synthetic budget');});
 const r=runScheduledReports('schedule',null,now)!;
 expect(db().prepare('SELECT status FROM assistant_runs WHERE id=?').get(r.runId)).toEqual({status:'failed'});
 expect(db().prepare('SELECT status FROM ask_schedule_attempts').get()).toEqual({status:'failed'});
 expect(scheduleFor('weekly_pipeline')?.lastRunAt).toBeNull();
});
it('unique running constraint and immediate claim reject overlapping claims',()=>{
 const now=setupSchedule(); const ar=beginAssistantRun('scheduled_reports','schedule',null);
 expect(claimScheduleAttempt('weekly_pipeline',ar,now)).toBeTruthy();
 expect(claimScheduleAttempt('weekly_pipeline',ar,now)).toBeNull();
 expect(()=>db().prepare("INSERT INTO ask_schedule_attempts(id,template_id,assistant_run_id,started_at,status) VALUES ('synthetic-duplicate','weekly_pipeline',?,?,'running')").run(ar,now.getTime())).toThrow(/UNIQUE/);
});
it('restart clears pre-launch orphan with null AI run ID and permits delayed retry',()=>{
 const now=setupSchedule(); const ar=beginAssistantRun('scheduled_reports','schedule',null);
 const claim=claimScheduleAttempt('weekly_pipeline',ar,now);
 failOrphanedRuns(db());
 vi.spyOn(ask,'startAsk').mockImplementation(()=>({threadId:'synthetic',runId:startRun({role:'ask',accountId:null,userId:USER,assistant:'scheduled_reports'}).id}));
 const r=runScheduledReports('schedule',null,new Date(now.getTime()+16*60_000))!;
 expect(r.started).toBe(1);
 expect(db().prepare('SELECT status FROM ask_schedule_attempts WHERE id=?').get(claim)).toEqual({status:'failed'});
 expect(scheduleFor('weekly_pipeline')?.lastRunAt).toBeNull();
});
