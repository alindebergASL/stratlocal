import { expect, it } from "vitest";
import JSZip from "jszip";
import { accountReadiness, changedDealIds } from "@/lib/local/readiness";
import { stagePackage, parsePackage, proposePackage } from "@/lib/local/packages";
import { db } from "@/lib/db";
import { seedAccount, USER } from "./helpers";

it("distinguishes partial and unknown opportunity coverage without deriving financial metrics", () => {
  const report={account:{name:"Synthetic College"},deals:[{deal_id:"SYN-ONE",name:"Network"}]};
  const partial=accountReadiness(report,[{path:"records.json",value:{account:{name:"Synthetic College"},pipeline_telemetry:{total_open_pipeline_opportunities_count:12}}}]);
  expect(partial.reportedTotal).toBe(12);
  expect(partial.warnings[0]).toContain("12 open opportunities");
  expect(partial.gaps.join(" ")).toContain("pagination");
  expect(accountReadiness(report,[]).reportedTotal).toBeNull();
  expect(accountReadiness(report,[{path:"wrong.json",value:{account:{name:"Another Org"},pipeline_telemetry:{total_open_pipeline_opportunities_count:100}}}]).reportedTotal).toBeNull();
});

it("checks changed IDs only for same-named opportunities, including archived rows", () => {
  const existing=[{deal_id:"OLD-ID",name:"Synthetic Refresh",archived_at:"2026-01-01"}];
  expect(changedDealIds({deals:[{deal_id:"NEW-ID",name:"synthetic refresh"}]},existing)).toHaveLength(1);
  expect(changedDealIds({deals:[{deal_id:"OLD-ID",name:"Synthetic Refresh"}]},existing)).toHaveLength(0);
  expect(changedDealIds({deals:[{deal_id:"NEW-ID",name:"Other deal"}]},existing)).toHaveLength(0);
});

it("requires explicit confirmation before proposing different IDs for a saved deal name", async () => {
  const {accountId}=seedAccount();
  const saved=db().prepare("SELECT deal_id,name FROM deals WHERE account_id=? LIMIT 1").get(accountId) as {deal_id:string;name:string};
  const z=new JSZip();z.file("manifest.json",JSON.stringify({version:1,as_of:"2026-01-01",artifacts:[{path:"source.md"}],accounts:[{key:"one",report:{account:{name:"Synthetic Orchard Lab"},deals:[{deal_id:"NEW-SYNTHETIC-ID",name:saved.name}]},sources:[{path:"source.md"}]}]}));z.file("source.md","Synthetic evidence for review.");
  const p=stagePackage("synthetic.zip",await z.generateAsync({type:"nodebuffer"}),USER,accountId);
  await parsePackage(p.id,accountId);
  expect(()=>proposePackage(p.id,USER)).toThrow(/possible duplicate/);
  expect(db().prepare("SELECT count(*) n FROM proposals WHERE origin_id=?").get(p.id)).toEqual({n:0});
  expect(proposePackage(p.id,USER,true).proposals).toBeGreaterThan(0);
  expect(db().prepare("SELECT count(*) n FROM deals WHERE deal_id='NEW-SYNTHETIC-ID'").get()).toEqual({n:0});
});
