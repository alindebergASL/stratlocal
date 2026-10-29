import { expect, it } from "vitest";
import JSZip from "jszip";
import { db, type AccountRow } from "@/lib/db";
import { seedAccount, USER } from "./helpers";
import { parsePackage, stagePackage, proposePackage, proposeAccountContext } from "@/lib/local/packages";
import { contextDrafts } from "@/lib/local/accountContext";
import { acceptProposal } from "@/lib/proposals/apply";
import { listContacts } from "@/lib/queries/accounts";

async function imported(report: Record<string, unknown>, evidence: Record<string, unknown> = {}) {
  const { accountId } = seedAccount();
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify({ version: 1, as_of: "2026-01-01", artifacts: [{path:"sources/records.json"}], accounts: [{ key:"one", report, sources:[{path:"sources/records.json"}] }] }));
  zip.file("sources/records.json", JSON.stringify(evidence));
  const p = stagePackage("synthetic.zip", await zip.generateAsync({type:"nodebuffer"}), USER);
  await parsePackage(p.id, accountId);
  return { accountId, packageId:p.id };
}

it("proposes an independent overview and customer people, accepts them and avoids repeats", async () => {
  const { accountId, packageId } = await imported({ account: {name:"Synthetic Orchard Lab", summary:"Synthetic public research institution.", hq:"Synthetic City"}, contacts:[{name:"Synthetic Customer", title:"Director", org:"customer", department:"Research", contact_id:"SYN-CONTACT"}] });
  expect(proposePackage(packageId,USER).proposals).toBe(3);
  expect(listContacts(accountId).some(c=>c.name==="Synthetic Customer")).toBe(false);
  expect((db().prepare("SELECT research_summary FROM accounts WHERE id=?").get(accountId) as AccountRow).research_summary).toBeNull();
  expect(proposeAccountContext(packageId,USER).proposals).toBe(0);
  const proposals = db().prepare("SELECT id FROM proposals WHERE origin_id=? AND status='pending'").all(packageId) as {id:string}[];
  for (const p of proposals) expect(acceptProposal(p.id,USER,{ackEvidence:true}).status).toBe("accepted");
  const account = db().prepare("SELECT * FROM accounts WHERE id=?").get(accountId) as AccountRow;
  expect(account.research_summary).toBe("Synthetic public research institution.");
  expect(account.thesis).not.toBe(account.research_summary);
  expect(account.hq).toBe("Synthetic City");
  expect(listContacts(accountId).find(c=>c.name==="Synthetic Customer")).toMatchObject({org:"customer",title:"Director",notes:expect.stringContaining("SYN-CONTACT")});
  expect(proposeAccountContext(packageId,USER).proposals).toBe(0);
});

it("recovers people from identity-matched legacy Salesforce evidence and preserves source provenance", async () => {
  const {accountId,packageId} = await imported({ account:{name:"Synthetic Orchard Lab"} }, {account:{name:"Synthetic Orchard Lab"},stakeholders_and_executives:[{first_name:"Synthetic",last_name:"Executive",title:"CIO",organization:"Synthetic Orchard Lab"}]});
  expect(proposePackage(packageId,USER).proposals).toBe(1);
  const p=db().prepare("SELECT payload_json,source_ref_json FROM proposals WHERE origin_id=?").get(packageId) as {payload_json:string;source_ref_json:string};
  expect(JSON.parse(p.payload_json)).toMatchObject({name:"Synthetic Executive",org:"customer"});
  expect(JSON.parse(p.source_ref_json).kind).toBe("document");
  expect(listContacts(accountId).some(c=>c.name==="Synthetic Executive")).toBe(false);
});

it("skips mismatched source accounts and does not turn sellers into customers", async () => {
  const {accountId,packageId} = await imported({account:{name:"Synthetic Orchard Lab"}}, {account:{name:"Different Synthetic Org"},contacts:[{name:"Wrong Person"}]});
  expect(proposePackage(packageId,USER).proposals).toBe(0);
  const account=db().prepare("SELECT * FROM accounts WHERE id=?").get(accountId) as AccountRow;
  const result=contextDrafts({account:{name:account.name},contacts:[{name:"Synthetic Seller"},{name:"Bad Email",email:"not-an-email"}]},[],account,[{id:"seller",account_id:accountId,name:"Synthetic Seller",org:"vendor",title:null,email:null,role:null,notes:null,created_at:0,updated_at:0}],{kind:"document",id:"source"});
  expect(result.drafts).toHaveLength(1);
  expect(result.drafts[0]?.payload).toMatchObject({name:"Bad Email",email:null});
  expect(result.warnings).toHaveLength(2);
});

it("retains conflicting titles and flags duplicate or ambiguous customer rows", () => {
  const {accountId}=seedAccount();
  const account=db().prepare("SELECT * FROM accounts WHERE id=?").get(accountId) as AccountRow;
  const contacts=[{id:"customer",account_id:accountId,name:"Synthetic Person",org:"customer" as const,title:"Director",email:null,role:null,notes:null,created_at:0,updated_at:0}];
  const result=contextDrafts({account:{name:account.name},contacts:[{name:"Synthetic Person",title:"CIO"},{name:"Synthetic Person",title:"CTO"}]},[],account,contacts,{kind:"document",id:"source"});
  expect(result.drafts).toHaveLength(0);
  expect(result.warnings.join(" ")).toMatch(/Conflicting title/);
  expect(result.warnings.join(" ")).toMatch(/Duplicate/);
});
