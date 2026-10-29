import { expect, it } from "vitest";
import { normalizeSourceLocation } from "@/lib/local/normalize";
import { contextDrafts } from "@/lib/local/accountContext";
import { db, type AccountRow } from "@/lib/db";
import { seedAccount } from "./helpers";
import { USER } from "./helpers";
import { retryPackage, stagePackage } from "@/lib/local/packages";
import { packageRow } from "@/lib/local/store";

const segments = [
  { locator: "section:1", label: "1. Leadership", text: "# 1. Leadership" },
  { locator: "section:2", label: "Executives", text: "A synthetic quoted statement." },
];
it("resolves Markdown headings and exact quotes in subsections without accepting invented quotations", () => {
  const heading = {path:"brief.md",locator:"## 1. Leadership"};
  expect(normalizeSourceLocation(heading,segments)).toContain("unique heading");
  expect(heading.locator).toBe("section:1");
  const quote = {path:"brief.md",locator:"## 1. Leadership",quote:"A synthetic quoted statement."};
  expect(normalizeSourceLocation(quote,segments)).toContain("exact quotation");
  expect(quote.locator).toBe("section:2");
  const invented = {path:"brief.md",locator:"Unknown",quote:"Invented quotation"};
  expect(normalizeSourceLocation(invented,segments)).toBeNull();
  expect(invented.locator).toBe("Unknown");
});
it("does not rewrite an explicit canonical location or guess between repeated headings", () => {
  expect(normalizeSourceLocation({path:"brief.md",locator:"section:1",quote:"A synthetic quoted statement."},segments)).toBeNull();
  expect(normalizeSourceLocation({path:"brief.md",locator:"## Executives"},[segments[1]!,{...segments[1]!,locator:"section:3"}])).toBeNull();
});
it("keeps a customer with a descriptive role while omitting uncorroborated email", () => {
  const {accountId}=seedAccount();const account=db().prepare("SELECT * FROM accounts WHERE id=?").get(accountId) as AccountRow;
  const result=contextDrafts({account:{name:account.name},contacts:[{name:"Synthetic Leader",role:"Finance & Planning Sponsor",email:"leader@example.test"}]},[],account,[],{kind:"document",id:"source"});
  expect(result.drafts).toHaveLength(1);
  expect(result.drafts[0]?.payload).toMatchObject({org:"customer",role:null,email:null,notes:expect.stringContaining("Finance & Planning Sponsor")});
  expect(result.warnings).toHaveLength(2);
});

it("retries failed imports using their original job and forbids retrying active imports", () => {
  const {accountId}=seedAccount();
  const p=stagePackage("synthetic.md",Buffer.from("Synthetic notes"),USER,accountId);
  expect(()=>retryPackage(p.id,USER)).toThrow(/Only failed/);
  db().prepare("UPDATE local_packages SET state='failed',error='Old parser failure' WHERE id=?").run(p.id);
  db().prepare("UPDATE local_jobs SET status='failed',attempts=3,error='Old parser failure' WHERE request_key=?").run(`import:${p.id}`);
  expect(()=>retryPackage(p.id,"someone-else")).toThrow(/not found/);
  retryPackage(p.id,USER);
  expect(packageRow(p.id)?.state).toBe("queued");
  expect(db().prepare("SELECT status,attempts,error FROM local_jobs WHERE request_key=?").get(`import:${p.id}`)).toEqual({status:"queued",attempts:0,error:null});
  expect(()=>retryPackage(p.id,USER)).toThrow(/Only failed/);
});
