// Synthetic fixtures only; no providers are called.
import { expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { seedAccount, USER } from "./helpers";
import { db } from "@/lib/db";
import { applyEntityChange, createProposalBatch } from "@/lib/proposals/apply";
import { FindingRow } from "@/components/FindingList";
import { ChangeSummary } from "@/components/ui";
import { findingSourceIdentity } from "@/components/sourceIdentity";
import { sourceTitle } from "@/lib/research/sourceTitle";
import { fieldLabel } from "@/lib/fieldLabels";
import { harvestEvidence, urlKey } from "@/lib/ai/runWebResearch";
import { sanitizeResearchNote } from "@/lib/research/extract";
import type { ResearchFinding } from "@/lib/research/schema";
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, display_name: "Synthetic User", email: "synthetic@example.test" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
const finding = (url = "https://example.test/report"): ResearchFinding => ({ text: "Synthetic finding.", quote: "Synthetic report wording.", url, date: "2026-09-01", confidence: "medium", topic: "technology" });
const markup = (f: ResearchFinding) => renderToStaticMarkup(createElement(FindingRow, { finding: f, reading: true }));
const create = (accountId: string, entityType: "play" | "deal" | "meeting", payload: Record<string, unknown>) => applyEntityChange({ accountId, entityType, op: "create", payload, actorUserId: USER }).entityId;

it("renders truthful URL identity for legacy sources, preserving exact destinations and missing dates", () => {
 const f=finding("https://example.test/reports/one?year=2026#section"); f.date=null;
 const result=findingSourceIdentity(f);expect(result).toEqual({label:"example.test/reports/one?year=2026#section",href:f.url});
 const html=markup(f);expect(html).not.toContain("2026-09-01");expect(html).toContain("not an original-source quotation");
 expect(findingSourceIdentity(finding("https://example.test/reports/two")).label).not.toBe(result.label);
});
it.each(["javascript:alert(1)","https://user:secret@example.test/report","not a URL","data:text/plain,private"])("never links or exposes unsafe destination %s",url=>{
 const f=finding(url);f.evidence={kind:"source_excerpt",text:f.quote,url,citation:{title:"Private label",url}};
 expect(findingSourceIdentity(f)).toEqual({label:"Source unavailable"});const html=markup(f);expect(html).not.toContain('target="_blank"');expect(html).not.toContain(url);expect(html).not.toContain("Private label");
});
it("uses only matched source-bound titles and disambiguates hosts",()=>{
 const f=finding();f.evidence={kind:"source_excerpt",text:f.quote,url:f.url,citation:{title:"Annual plan",url:f.url}};
 expect(findingSourceIdentity(f).label).toBe("Annual plan — example.test");expect(markup(f)).toContain("Claim not independently verified");
 f.evidence.citation!.url="https://other.test/report";expect(findingSourceIdentity(f).label).toBe("example.test/report");
 f.evidence.citation!.url=f.url;f.evidence.url="https://other.test/report";expect(findingSourceIdentity(f).label).toBe("example.test/report");
 f.evidence.url=f.url;f.evidence.kind="report_excerpt";expect(findingSourceIdentity(f).label).toBe("example.test/report");
 const other=finding("https://other.test/report");other.evidence={kind:"source_excerpt",text:other.quote,url:other.url,citation:{title:"Annual plan",url:other.url}};expect(findingSourceIdentity(other).label).toBe("Annual plan — other.test");
});
it.each([null,undefined,{},42,""," ","x".repeat(601)])("rejects non-title or oversized metadata without fabricating text",value=>expect(sourceTitle(value)).toBeUndefined());
it("keeps supported long titles fully readable, escaped and wrap-safe",()=>{
 const title="<Synthetic> "+"Long report title ".repeat(25);const f=finding();f.evidence={kind:"source_excerpt",text:f.quote,url:f.url,citation:{title,url:f.url}};
 const html=markup(f);expect(html).toContain("&lt;Synthetic&gt;");expect(html).toContain("overflow-wrap:anywhere");expect(findingSourceIdentity(f).label).toBe(title.trim()+" — example.test");
});
it.each(["search","fetch","document"])("preserves provider %s title through evidence binding and rendering",kind=>{
 const f=finding();const title="Synthetic operations report";
 const content=kind==="fetch" ? [{type:"web_fetch_tool_result",content:{type:"web_fetch_result",url:f.url,content:{title,source:{type:"text",data:f.quote}}}}] : [{type:"text",citations:[kind==="search"?{type:"web_search_result_location",url:f.url,title,cited_text:f.quote}:{type:"char_location",document_index:0,document_title:title,cited_text:f.quote}]}];
 const evidence=harvestEvidence(content,[f.url]);expect(evidence[0]?.citation?.title).toBe(title);expect(evidence[0]?.url).toBe(f.url);
 const note=sanitizeResearchNote({title:"Synthetic",summary:"",open_questions:[],findings:[f]},f.quote,new Map([[urlKey(f.url)!,f.url]]),evidence).note;
 expect(note.findings[0]?.evidence?.kind).toBe("source_excerpt");expect(markup(note.findings[0]!)).toContain(title+" — example.test");expect(note.findings[0]?.date).toBe("2026-09-01");
});
it("does not turn a generated or mismatched excerpt into source evidence for its title",()=>{
 const f=finding();const evidence=harvestEvidence([{type:"text",citations:[{type:"web_search_result_location",url:f.url,title:"Provider title",cited_text:"Different source text"}]}]);
 const result=sanitizeResearchNote({title:"Synthetic",summary:"",open_questions:[],findings:[f]},f.quote,new Map([[urlKey(f.url)!,f.url]]),evidence).note.findings[0]!;
 expect(result.evidence?.kind).toBe("report_excerpt");expect(markup(result)).not.toContain("Provider title");
});
it("keeps legacy null title and missing document-index slots without guessing",()=>{
 const evidence=harvestEvidence([{type:"text",citations:[{type:"char_location",document_index:0,document_title:"Never resolve me",cited_text:"Synthetic quote"},{type:"char_location",document_index:1,document_title:null,cited_text:"Synthetic quote"}]}],[null,"https://example.test/real"]);
 expect(evidence).toHaveLength(1);expect(evidence[0]?.url).toBe("https://example.test/real");expect(evidence[0]?.citation?.title).toBeUndefined();
});
it("labels create, change and extra-field summaries without changing values or hiding unknown fields",()=>{
 const row=(field:string,from:string|null,to:string|null)=>({field,from,to,fromBytes:from?.length??0,toBytes:to?.length??0});
 expect(fieldLabel("future_field")).toBe("future field");
 const added=renderToStaticMarkup(createElement(ChangeSummary,{changes:[row("owner_user_id",null,'"id"'),row("raw_notes",null,'"notes"'),row("held_at",null,'"2026-09-24"')],max:2}));
 expect(added).toContain("Assigned owner, Meeting notes, Meeting date");expect(added).not.toContain("owner user id");
 const changes=renderToStaticMarkup(createElement(ChangeSummary,{changes:[row("held_at",'"2026-09-23"','"2026-09-24"'),row("raw_notes",'"old"','"new"'),row("future_field",'"a"','"b"')],max:1}));
 expect(changes).toContain("Meeting date");expect(changes).toContain("2026-09-23");expect(changes).toContain("2026-09-24");expect(changes).toContain("also Meeting notes, future field");
});

it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])("renders inherited-name field %s with the string fallback", field => {
 const label = field.replace(/_/g, " ");
 expect(fieldLabel(field)).toBe(label);
 const change = {field, from: '"old"', to: '"new"', fromBytes: 5, toBytes: 5};
 const html = renderToStaticMarkup(createElement(ChangeSummary, {changes: [change], max: 2}));
 expect(html).toContain(label);
 expect(html).toContain("old");
 expect(html).toContain("new");
});

it("puts review outside the keyed notes workspace without duplicating controls",async()=>{
 const {accountId}=seedAccount();const mid=create(accountId,"meeting",{title:"Synthetic",held_at:"2026-09-24",raw_notes:"Synthetic saved notes"});
 createProposalBatch(accountId,{kind:"meeting",id:mid,aiRunId:null},[{entity_type:"action_item",op:"create",payload:{text:"Synthetic follow-up"}}]);
 const {default:Page}=await import("@/app/accounts/[id]/meetings/[mid]/page");const html=renderToStaticMarkup(await Page({params:Promise.resolve({id:accountId,mid})}));const d=parseHTML(html).document;
 expect(d.querySelectorAll('#review')).toHaveLength(1);expect(d.querySelectorAll('textarea[name="raw_notes"]')).toHaveLength(1);expect(d.querySelector('[data-testid="meeting-workspace"] #review')).toBeNull();expect(d.querySelector('#review a[href="#notes"]')).not.toBeNull();expect(d.querySelector('#review')?.textContent).toContain("1 pending");
});
it("gives real first-use deal guidance and retains archived linked selections",async()=>{
 const accountId=applyEntityChange({accountId:"",entityType:"account",op:"create",payload:{name:"Synthetic empty play lab"},actorUserId:USER}).entityId;const pid=create(accountId,"play",{title:"Synthetic play",thesis:"A play-level hypothesis."});
 const {default:Page}=await import("@/app/accounts/[id]/plays/[playId]/page");const render=async()=>parseHTML(renderToStaticMarkup(await Page({params:Promise.resolve({id:accountId,playId:pid})}))).document;
 let d=await render();expect(d.querySelector('#deals')?.textContent).toContain("No active deals");expect(d.querySelector(`#deals a[href="/accounts/${accountId}/deals"]`)).not.toBeNull();
 const did=create(accountId,"deal",{name:"Synthetic deal",status:"open"});d=await render();expect(d.querySelector('#deals a[href="#edit"]')).not.toBeNull();
 db().prepare('UPDATE deals SET archived_at=? WHERE deal_id=?').run("2026-09-24",did);d=await render();expect(d.querySelector('#deals')?.textContent).toContain("No active deals");
 db().prepare('UPDATE plays SET deal_ids_json=? WHERE id=?').run(JSON.stringify([did]),pid);d=await render();expect(d.querySelector('#deals')?.textContent).toContain("Synthetic deal");
 // ActionForm is collapsed during SSR; persisted links remain represented in the read-only section.
 expect(db().prepare('SELECT deal_ids_json FROM plays WHERE id=?').get(pid)).toEqual({deal_ids_json:JSON.stringify([did])});
 db().prepare('UPDATE plays SET deal_ids_json=?,archived_at=? WHERE id=?').run("[]","2026-09-24",pid);d=await render();expect(d.querySelector('#deals a')).toBeNull();expect(d.querySelector('#deals')?.textContent).toContain("not editable");
});
it.each([[false,false],[false,true],[true,false],[true,true]])("keeps account/play thesis scopes distinct (%s,%s)",async(accountThesis,playThesis)=>{
 const {accountId}=seedAccount();db().prepare('UPDATE accounts SET thesis=? WHERE id=?').run(accountThesis?"Synthetic account direction":null,accountId);
 if(playThesis)create(accountId,"play",{title:"Synthetic play",thesis:"Synthetic play hypothesis"});
 const {default:Page}=await import("@/app/accounts/[id]/plays/page");const d=parseHTML(renderToStaticMarkup(await Page({params:Promise.resolve({id:accountId})}))).document;
 expect(d.querySelector('#plan')?.textContent?.includes('No account thesis yet')).toBe(!accountThesis);
 expect(db().prepare('SELECT thesis FROM accounts WHERE id=?').get(accountId)).toEqual({thesis:accountThesis?"Synthetic account direction":null});
});
