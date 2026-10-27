// The canned answers, held to the same standard as a real one.
//
// AI_FAKE=1 is what every browser flow runs under and what anyone
// demonstrating the app uses. Its answers are not stubs that bypass the
// pipeline: runStructured parses each one with the real Zod schema and then
// runs the real check() over it (lib/ai/runStructured.ts), throwing AiRejected
// if the guards refuse it.
//
// Which means a change to a schema or a guard can break the demo path — and
// every browser flow with it — while `npm test` stays green, because nothing
// imported lib/ai/fake.ts. The break then surfaces to a person clicking
// through, which is the worst place and the latest time to find it.
//
// So: every role's canned answer parses, and passes its own guards, against
// the same fixture the import flow uses.
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resetDbForTests } from "@/lib/db";
import { fakeAnswer } from "@/lib/ai/fake";
import { ROLES } from "@/lib/ai/models";
import { AgentReportExtraction } from "@/lib/import/extractSchema";
import { checkExtraction, sanitizeExtraction } from "@/lib/import/extract";
import { htmlToText } from "@/lib/import/htmlToText";
import { MeetingExtraction } from "@/lib/meetings/extractSchema";
import { checkExtraction as checkMeeting } from "@/lib/meetings/extract";
import { MeetingBrief } from "@/lib/meetings/briefSchema";
import { checkBrief } from "@/lib/meetings/brief";
import { PlanDraft } from "@/lib/plan/schema";
import { checkPlanDraft } from "@/lib/plan/draft";
import { buildContextPack, evidenceIds, evidenceIndex } from "@/lib/meetings/contextPack";
import { seedAccount, type Seed } from "./helpers";

const FIXTURE = readFileSync("tests/fixtures/agent-report.html", "utf8");

let seed: Seed;
beforeEach(() => {
  resetDbForTests();
  seed = seedAccount();
});

describe("every role has an answer", () => {
  it("covers all of them, so no surface fails only under AI_FAKE", () => {
    // The dispatcher throws for a role it does not know, and a new role is
    // exactly the kind of thing that gets wired everywhere except here.
    for (const role of Object.keys(ROLES)) {
      expect(() =>
        fakeAnswer(role as keyof typeof ROLES, {
          pack: buildContextPack(seed.accountId),
          notes: "x",
        }),
      ).not.toThrow();
    }
  });
});

describe("the report import", () => {
  it("uses independently fabricated sequential IDs and self-consistent toy totals", () => {
    const parsed = AgentReportExtraction.parse(fakeAnswer("import"));
    expect(FIXTURE).toContain("SYNTHETIC ONLY");
    expect(parsed.account.crm_id).toBe("SYN-ACCOUNT-001");
    expect(parsed.deals.map((d) => d.deal_id)).toEqual(Array.from({ length: 10 }, (_, i) => `SYN-DEAL-${String(i + 1).padStart(3, "0")}`));
    expect(parsed.deals.map((d) => d.tcv_usd)).toEqual(Array.from({ length: 10 }, (_, i) => 1000 - i * 100));
    expect(parsed.deals.reduce((sum, d) => sum + (d.tcv_usd ?? 0), 0)).toBe(5500);
    expect(parsed.install_base).toHaveLength(8);
    expect(parsed.install_base.reduce((sum, b) => sum + (b.value_usd ?? 0), 0)).toBe(800);
    expect(parsed.install_base.reduce((sum, b) => sum + (b.share_pct ?? 0), 0)).toBe(100);
    expect(parsed.kpis.map((k) => k.value)).toEqual(["$5,500", "$800"]);
  });
  it("parses, and survives the guards that drop unsupported claims", () => {
    const text = htmlToText(FIXTURE);
    const parsed = AgentReportExtraction.parse(fakeAnswer("import"));
    // checkExtraction is what stops a deal id the model invented: it has to be
    // in the text verbatim. The canned answer claims to match this fixture,
    // and nothing has ever verified that claim.
    expect(checkExtraction(parsed, text)).toEqual([]);
    const { extraction, dropped } = sanitizeExtraction(parsed, text);
    expect(dropped).toEqual([]);
    expect(extraction.deals.length).toBeGreaterThan(0);
    for (const d of extraction.deals) expect(text).toContain(d.deal_id);
  });
});

describe("meeting extraction", () => {
  const NOTES = [
    "Met with Finley Example about the EHR refresh.",
    "They have moved into technical validation and want the sizing settled.",
    "I said I would send the storage sizing document by Friday.",
  ].join("\n");

  it("parses, and cites only ids and quotes it was given", () => {
    const pack = buildContextPack(seed.accountId);
    const parsed = MeetingExtraction.parse(fakeAnswer("meeting_extract", { notes: NOTES, pack }));
    // Both guards at once: every cited id has to be one we supplied, and
    // every quote has to appear in the notes. A canned answer that fails
    // these is a demo that fails, and it would fail nowhere else.
    expect(checkMeeting(parsed, { notes: NOTES, ids: evidenceIds(pack) })).toEqual([]);
  });
});

describe("the brief", () => {
  it("parses, and every claim resolves to something in the pack", () => {
    const pack = buildContextPack(seed.accountId);
    const parsed = MeetingBrief.parse(fakeAnswer("brief", { pack }));
    expect(checkBrief(parsed, evidenceIds(pack))).toEqual([]);
  });
});

describe("the plan draft", () => {
  it("parses, and links only deals and people on the account", () => {
    const pack = buildContextPack(seed.accountId);
    const parsed = PlanDraft.parse(fakeAnswer("plan_draft", { pack }));
    expect(checkPlanDraft(parsed, evidenceIndex(pack))).toEqual([]);
    expect(parsed.plays.length).toBeGreaterThanOrEqual(3);
  });
});
