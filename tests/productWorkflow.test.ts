import { expect, it, vi } from "vitest";
import { chooseAgendaTask, meetingFocus, scheduledUpcoming, focusFromHash, activityDescription, MEETING_SECTIONS } from "@/lib/workflow";
import { listAttention, listDueToday } from "@/lib/queries/attention";
import type { AttentionItem } from "@/lib/queries/attention";
import type { UpcomingMeeting, RecentChange } from "@/lib/queries/today";
import { upcomingMeetings, meetingsAwaitingNotes } from "@/lib/queries/today";
import { applyEntityChange } from "@/lib/proposals/apply";
import { db, OWN_WORK_ACCOUNT_ID } from "@/lib/db";
import { listOpenFollowUps } from "@/lib/queries/meetings";
import { briefEntryGaps, conversationView } from "@/lib/meetings/briefView";
import { seedAccount, USER } from "./helpers";

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, name: "Synthetic", email: "synthetic@example.test" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
const day = "2026-09-24";
const now = new Date("2026-09-24T19:00:00Z"); // noon Pacific
const m = (id: string, heldAt = day): UpcomingMeeting => ({ id, title: id, accountId: "a", accountName: "Synthetic account", heldAt, heldTime: "13:00", inProgress: false, hasBrief: false, hasNotes: false, attendees: 0, href: `/accounts/a/meetings/${id}` });
const w = (kind: AttentionItem["kind"], due = day): AttentionItem => ({ kind, accountId: "a", accountName: "Synthetic account", text: kind, detail: null, due, href: `/${kind}`, unit: "follow-up", count: 2 });

it("account notes eligibility matches Today across the previous-day midnight boundary", async () => {
 const {renderToStaticMarkup}=await import("react-dom/server");const {parseHTML}=await import("linkedom");const {default:Account}=await import("@/app/accounts/[id]/page");
 const accountId=applyEntityChange({accountId:"",entityType:"account",op:"create",payload:{name:"Synthetic midnight"},actorUserId:USER}).entityId;
 const mid=applyEntityChange({accountId,entityType:"meeting",op:"create",payload:{title:"Late scheduled meeting",held_at:"2026-09-24",held_time:"23:50"},actorUserId:USER}).entityId;
 const label=async()=>parseHTML(renderToStaticMarkup(await Account({params:Promise.resolve({id:accountId})}))).document.querySelector('[data-testid="needs-you"]')?.textContent ?? "";
 vi.useFakeTimers();
 try {
  vi.setSystemTime(new Date("2026-09-25T07:10:00Z"));
  expect(meetingsAwaitingNotes().some(m=>m.id===mid)).toBe(false);
  expect(await label()).not.toContain("Add notes");
  vi.setSystemTime(new Date("2026-09-25T07:50:00Z"));
  expect(meetingsAwaitingNotes().some(m=>m.id===mid)).toBe(true);
  expect(await label()).toContain("Add notes from Late scheduled meeting");
 } finally { vi.useRealTimers(); }
});
it("archived-account meetings retain follow-ups without an unreachable work-list link", async () => {
 const {renderToStaticMarkup}=await import("react-dom/server");const {default:Meeting}=await import("@/app/accounts/[id]/meetings/[mid]/page");const s=seedAccount();
 applyEntityChange({accountId:s.accountId,entityType:"action_item",op:"create",payload:{text:"Retained synthetic follow-up",meeting_id:s.meetingId,owner_user_id:USER,status:"open"},actorUserId:USER});
 const render=async()=>renderToStaticMarkup(await Meeting({params:Promise.resolve({id:s.accountId,mid:s.meetingId})}));
 expect(await render()).toContain("Open in Follow-ups");
 db().prepare("UPDATE accounts SET archived_at=? WHERE id=?").run(day,s.accountId);
 const archived=await render();expect(archived).toContain("Retained synthetic follow-up");expect(archived).not.toContain("Open in Follow-ups");
 expect(listOpenFollowUps({ownerUserId:USER}).some(i=>i.account_id===s.accountId)).toBe(false);
});

it("selects the specified agenda order without mutating or scoring the queues", () => {
  const queues = [w("due_today"), w("overdue", "2026-09-01"), w("proposals")];
  const snapshot = JSON.stringify(queues);
  expect(chooseAgendaTask(day,[m("today")],[],queues)?.href).toContain("today#brief");
  expect(chooseAgendaTask(day,[m("future","2026-09-26")],[],queues)?.href).toBe("/overdue");
  expect(chooseAgendaTask(day,[],[],queues.filter(i => i.kind !== "overdue"))?.href).toBe("/due_today");
  expect(chooseAgendaTask(day,[m("future","2026-09-26")],[],[w("proposals")])?.href).toBe("/proposals");
  expect(chooseAgendaTask(day,[{...m("future","2026-09-26"),hasBrief:true}],[],[])?.label).toBe("Read brief");
  expect(chooseAgendaTask(day,[],[m("gap","2026-09-23")],[])?.href).toContain("gap#notes");
  expect(chooseAgendaTask(day,[],[],[])).toBeNull();
  expect(JSON.stringify(queues)).toBe(snapshot);
});
it("breaks ties deterministically and labels play work explicitly", () => {
  expect(chooseAgendaTask(day,[m("z"),m("a")],[],[])?.title).toBe("a");
  expect(chooseAgendaTask(day,[],[],[{...w("overdue"),unit:"play"}])?.label).toBe("Review play next step");
  expect(chooseAgendaTask(day,[],[],[w("overdue","2026-09-23"),{...w("overdue","2026-09-01"),text:"oldest"}])?.title).toBe("oldest");
});
it("uses the same timing boundary as both Today queues, including unknown times and midnight", () => {
  const s = seedAccount({heldAt:day});
  db().prepare("UPDATE meetings SET held_time='11:00' WHERE id=?").run(s.meetingId);
  expect(scheduledUpcoming({id:s.meetingId,held_at:day,held_time:"11:00"},now)).toBe(false);
  expect(upcomingMeetings(now).some(m=>m.id===s.meetingId)).toBe(false);
  expect(meetingsAwaitingNotes(now).some(m=>m.id===s.meetingId)).toBe(true);
  expect(scheduledUpcoming({id:"x",held_at:day,held_time:"11:01"},now)).toBe(true);
  expect(scheduledUpcoming({id:"x",held_at:day,held_time:null},now)).toBe(true);
  expect(scheduledUpcoming({id:"x",held_at:day,held_time:"00:15"},new Date("2026-09-24T07:30:00Z"))).toBe(true);
});
it("keeps due today separate from overdue and account scope separate from assignee", () => {
  const s = seedAccount();
  db().prepare("UPDATE accounts SET owner_user_id=? WHERE id=?").run(USER,s.accountId);
  const create = (due: string|null, status="open") => applyEntityChange({accountId:s.accountId,entityType:"action_item",op:"create",payload:{text:"Synthetic due work",due,status,owner_user_id:null},actorUserId:USER}).entityId;
  const todayId=create(day), pastId=create("2026-09-23"); create(null); create(day,"done");
  applyEntityChange({accountId:s.accountId,entityType:"play",entityId:s.playId,op:"update",payload:{next_step_due:day,next_step:"Review the play"},actorUserId:USER});
  const scope={filter:"mine" as const,me:USER};
  const due = listDueToday(now,scope);
  expect(due).toHaveLength(2);
  expect(due.map(i=>i.unit).sort()).toEqual(["follow-up","play"]);
  expect(due.find(i=>i.unit==="follow-up")?.href).toBe(`/follow-ups/${todayId}`);
  expect(listAttention(now,scope).filter(i=>i.kind==="overdue").map(i=>i.href)).toEqual([`/follow-ups/${pastId}`]);
  expect(listOpenFollowUps({ownerUserId:USER}).some(i=>i.id===todayId)).toBe(false);
  expect(listOpenFollowUps({unowned:true}).some(i=>i.id===todayId)).toBe(true);
  expect(listDueToday(new Date("2026-09-24T06:59:00Z"),scope).some(i=>i.href.endsWith(todayId))).toBe(false);
  db().prepare("UPDATE accounts SET archived_at=? WHERE id=?").run(day,s.accountId);
  expect(listDueToday(now,scope)).toEqual([]);
});
it("Own work links use the assignee scope that actually reveals the record", () => {
  const id=applyEntityChange({accountId:OWN_WORK_ACCOUNT_ID,entityType:"action_item",op:"create",payload:{text:"Synthetic own work",due:day,status:"open"},actorUserId:USER}).entityId;
  expect(listDueToday(now).find(i=>i.href.endsWith(id))?.href).toBe(`/follow-ups?who=unowned#action-${id}`);
});
it("prioritizes explicit section choice and never infers occurrence or completion", () => {
  const base={archived:false,pending:0,upcoming:false,hasNotes:false,openFollowUps:0};
  expect(meetingFocus({...base,pending:2,upcoming:true})).toBe("review");
  expect(meetingFocus({...base,upcoming:true})).toBe("brief");
  expect(meetingFocus(base)).toBe("notes");
  expect(meetingFocus({...base,hasNotes:true,openFollowUps:1})).toBe("follow-ups");
  expect(meetingFocus({...base,hasNotes:true})).toBe("notes");
  expect(meetingFocus({...base,archived:true,pending:3})).toBe("notes");
  for (const section of MEETING_SECTIONS) expect(focusFromHash(`#${section}`,"review")).toBe(section);
  expect(focusFromHash("#unknown","notes")).toBe("notes");
});
it("describes unknown and truncated audit fields conservatively and preserves batching", () => {
  const edit:RecentChange={kind:"edit",accountId:"a",accountName:"Synthetic",entityType:"meeting",entityId:"m",changes:[{field:"title",from:null,to:null,fromBytes:400,toBytes:500}],at:1,actors:["a","b"]};
  expect(activityDescription(edit)).toBe("Meeting updated");
  expect(activityDescription({...edit,entityType:"unknown"})).toBe("Record updated");
  expect(activityDescription({...edit,entityType:"action_item",changes:[{...edit.changes[0]!,field:"due"}]})).toBe("Follow-up due date changed");
  expect(activityDescription({kind:"batch",accountId:"a",accountName:"Synthetic",batchId:"b",origin:"meeting",records:28,fields:40,at:1,actors:[]})).toBe("Proposed changes applied");
});
it("summarizes missing brief entry fields without inventing replacements", () => {
  const view=conversationView({situation:[],deals_in_play:[],changes_since_last:[],risks:[],questions:[],attendees:[],proposed_next_step:{action:"Ask about scope",concern:"Unknown scope",owner:null,target_date:null,blocker:null,evidence_ids:[]}} as Parameters<typeof conversationView>[0]);
  expect(briefEntryGaps(view)).toEqual(["purpose","cited facts","hypothesis","questions","deal or play connection","uncertainty note"]);
  expect(view.nextStep.action).toBe("Ask about scope");
});

it("renders truthful empty, research-only and play-only account overviews", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { parseHTML } = await import("linkedom");
  const { default: Account } = await import("@/app/accounts/[id]/page");
  const createAccount = () => applyEntityChange({accountId:"",entityType:"account",op:"create",payload:{name:"Synthetic start"},actorUserId:USER}).entityId;
  const render = async (id:string) => parseHTML(renderToStaticMarkup(await Account({params:Promise.resolve({id})}))).document;
  const emptyId=createAccount();
  // An empty account says what is missing, once, with a way to start.
  let doc=await render(emptyId);
  const row = (d: Document, kind: string) => d.querySelector(`[data-testid="needs-you-row"][data-kind="${kind}"]`);
  expect(row(doc, "no-meeting")?.querySelector("a")?.getAttribute("href")).toBe(`/accounts/${emptyId}/meetings#meeting-new`);
  expect(doc.querySelector('#research [data-testid="research-open"]')?.textContent).toBe("Run research");
  expect(doc.querySelector('#plan-glance')?.textContent).toContain("No plays yet.");
  applyEntityChange({accountId:emptyId,entityType:"play",op:"create",payload:{title:"Synthetic play",status:"active"},actorUserId:USER});
  doc=await render(emptyId);
  expect(doc.querySelector('#plan-glance a[href*="/plays/"]')?.textContent).toBe("Synthetic play");
  const researchId=createAccount();
  const { insertResearchNote }=await import("./briefFixtures");
  insertResearchNote(researchId);
  doc=await render(researchId);
  expect(doc.querySelector('#research [data-testid="research-panel-counts"]')).not.toBeNull();
});
it("puts populated customer work before empty Own work while retaining its creation destination", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { parseHTML } = await import("linkedom");
  const { default: FollowUps }=await import("@/app/follow-ups/page");
  const s=seedAccount();
  applyEntityChange({accountId:s.accountId,entityType:"action_item",op:"create",payload:{text:"Synthetic assigned task",owner_user_id:USER},actorUserId:USER});
  const render=async(add?:string)=>parseHTML(renderToStaticMarkup(await FollowUps({searchParams:Promise.resolve({add})}))).document;
  const doc=await render();
  expect(doc.querySelector('[data-testid="account-group"], [data-testid="own-work-group"]')?.getAttribute("data-testid")).toBe("account-group");
  expect(doc.querySelector('[data-testid="follow-up-add-top"]')?.getAttribute("href")).toBe("/follow-ups?add=1#own-work-group");
  expect(doc.querySelector('#own-work-group')).not.toBeNull();
  const adding=await render("1");
  expect(adding.querySelector('[data-testid="account-group"], [data-testid="own-work-group"]')?.id).toBe("own-work-group");
});
