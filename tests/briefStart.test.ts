// Two-tab request-start regression. Synthetic DB + AI_FAKE replay only.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { seedAccount, USER, type Seed } from "./helpers";
import { getMeeting } from "@/lib/queries/meetings";
import { applyEntityChange } from "@/lib/proposals/apply";
import { editPreparation } from "@/lib/planning";
vi.mock("@/lib/auth", async importOriginal => ({ ...(await importOriginal<typeof import("@/lib/auth")>()), requireUser: () => ({ id: "user-1" }) }));
import { POST } from "@/app/api/meetings/[id]/brief/route";
let seed: Seed;
beforeEach(() => { seed=seedAccount(); vi.stubEnv("AI_FAKE", "1"); });
async function post(body: unknown) {
  const response = await POST(new NextRequest("http://localhost/api/meetings/test/brief", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(body) }), {params:Promise.resolve({id:seed.meetingId})});
  const json=await response.json();
  // Let an unexpectedly accepted run settle before reset; no leaked background work.
  if(json.runId) await vi.waitFor(()=>expect((db().prepare("SELECT status FROM ai_runs WHERE id=?").get(json.runId) as {status:string}).status).not.toBe("running"));
  return { status:response.status, json };
}
function humanEdit() {
  const brief={conversation:{purpose:"Synthetic original purpose",facts:[],questions:["Who decides?"],hypothesis:null,connection:null,uncertainty:"Unconfirmed"},situation:[],deals_in_play:[],attendees:[],changes_since_last:[],questions:[],risks:[],proposed_next_step:{action:"Synthetic original next step",concern:"Unknown timing",owner:null,target_date:null,blocker:null,evidence_ids:[]}};
  applyEntityChange({accountId:seed.accountId,entityType:"meeting",entityId:seed.meetingId,op:"update",payload:{brief_json:JSON.stringify(brief)},actorUserId:USER});
  editPreparation({accountId:seed.accountId,meetingId:seed.meetingId,version:getMeeting(seed.meetingId)!.updated_at,userId:USER,purpose:"Human preparation must survive",questions:["What needs a decision?"],action:"Human next step",concern:"Confirm scope"});
}
describe("preparation request-start concurrency",()=>{
  it("rejects a stale Prepare tab before creating any run or changing human edits",async()=>{
    const stale=getMeeting(seed.meetingId)!;humanEdit();const before=getMeeting(seed.meetingId)!;
    expect((await post({baseVersion:stale.updated_at,replaceHumanEdits:false})).status).toBe(409);
    expect(getMeeting(seed.meetingId)).toEqual(before);
    expect(db().prepare("SELECT COUNT(*) n FROM ai_runs").get()).toEqual({n:0});
  });
  it("requires current human-edit replacement intent even with a current version",async()=>{
    humanEdit();const before=getMeeting(seed.meetingId)!;
    expect((await post({baseVersion:before.updated_at,replaceHumanEdits:false})).status).toBe(409);
    expect(getMeeting(seed.meetingId)).toEqual(before);
    expect(db().prepare("SELECT COUNT(*) n FROM ai_runs").get()).toEqual({n:0});
  });
  it("does not let stale replacement confirmation authorize newer edits",async()=>{
    humanEdit();const stale=getMeeting(seed.meetingId)!;
    editPreparation({accountId:seed.accountId,meetingId:seed.meetingId,version:stale.updated_at,userId:USER,purpose:"Newer human purpose",questions:[],action:"Newer human action",concern:"Validate scope"});
    const before=getMeeting(seed.meetingId)!;
    expect((await post({baseVersion:stale.updated_at,replaceHumanEdits:true})).status).toBe(409);
    expect(getMeeting(seed.meetingId)).toEqual(before);
  });
  it.each([{},null,{baseVersion:"123"},{baseVersion:1,replaceHumanEdits:"true"}])("rejects missing or malformed rendered tokens: %j",async body=>{
    expect((await post(body)).status).toBe(400);
    expect(db().prepare("SELECT COUNT(*) n FROM ai_runs").get()).toEqual({n:0});
  });
  it("allows explicitly confirmed replacement of the current human draft",async()=>{
    humanEdit();const result=await post({baseVersion:getMeeting(seed.meetingId)!.updated_at,replaceHumanEdits:true});
    expect(result.status).toBe(200);
    expect(getMeeting(seed.meetingId)!.brief_edits_json).toBeNull();
    expect((db().prepare("SELECT status FROM ai_runs WHERE id=?").get(result.json.runId) as {status:string}).status).toBe("done");
  });
});
