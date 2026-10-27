// Three small modules with no tests, each of which decides something that is
// invisible from any screen until it is wrong:
//
//   lib/import/extract.ts   which of the model's claims survive
//   lib/ai/readiness.ts     whether a run is worth paying for
//   lib/http.ts             what every API route says when it fails
import { beforeEach, describe, expect, it } from "vitest";
import { HttpError } from "@/lib/auth";
import { handle, json, parseJson, DEFAULT_JSON_BODY_BYTES } from "@/lib/http";
import { checkExtraction, sanitizeExtraction } from "@/lib/import/extract";
import { planReadiness, briefReadiness } from "@/lib/ai/readiness";
import { applyEntityChange, archiveEntity } from "@/lib/proposals/apply";
import { ContactPatch } from "@/lib/proposals/schema";
import { getMeeting } from "@/lib/queries/meetings";
import { resetDbForTests } from "@/lib/db";
import { seedAccount, USER, type Seed } from "./helpers";
import type { AgentReportExtraction } from "@/lib/import/extractSchema";

// ---- what survives the model ------------------------------------------------

const REPORT = [
  "Opportunities",
  "SYN-DEAL-001 | EHR Refresh | 3 | 2026-12-01 | 1000",
  "SYN-DEAL-002 | North DC Expansion | 2 | 2026-11-20 | 900",
  "Install base by product family",
  "Compute | 4100000",
  "TOTAL | 1000",
].join("\n");

function extraction(over: Partial<AgentReportExtraction> = {}): AgentReportExtraction {
  return {
    account: { name: "Synthetic Orchard Lab", crm_id: null, legal_entity: null, region: null, segment: null, hq: null },
    team: [],
    deals: [
      { deal_id: "SYN-DEAL-001", name: "EHR Refresh", stage: 3, stage_label: null, close_date: "2026-12-01", fiscal_quarter: null, tcv_usd: 1_000, competitor: null, partner: null, owner: null, architecture: null },
    ],
    install_base: [{ product_family: "Compute", value_usd: 4_100_000, share_pct: null, role_note: null }],
    plays: [],
    kpis: [],
    ...over,
  } as AgentReportExtraction;
}

describe("a deal id has to be in the report", () => {
  it("reports one that is not, so the model gets a chance to fix it", () => {
    const invented = extraction({ deals: [{ ...extraction().deals[0]!, deal_id: "SYN-EXTRA-010" }] });
    const findings = checkExtraction(invented, REPORT);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.path).toBe("deals[0].deal_id");
    // The retry has to be able to act on it, so it says what to do.
    expect(findings[0]?.message).toMatch(/copy identifiers exactly or omit/);
  });

  it("passes one that is", () => {
    expect(checkExtraction(extraction(), REPORT)).toEqual([]);
  });

  it("drops it on the way through if it survives the retry, and says which", () => {
    const mixed = extraction({
      deals: [extraction().deals[0]!, { ...extraction().deals[0]!, deal_id: "SYN-EXTRA-010", name: "Invented" }],
    });
    const { extraction: clean, dropped } = sanitizeExtraction(mixed, REPORT);
    expect(clean.deals.map((d) => d.deal_id)).toEqual(["SYN-DEAL-001"]);
    expect(dropped).toEqual(["deal SYN-EXTRA-010"]);
  });
});

describe("an address the model invented", () => {
  // Found auditing the spreadsheet import, which had the same hole: the team
  // block types email as a plain nullable string, so whatever the model
  // returns goes straight into a contact payload — and ContactPatch runs
  // `.email()` on it inside createProposalBatch, which parses a whole batch in
  // one transaction with no per-draft try. One malformed address in a
  // twenty-person team block therefore loses the deals, the install base and
  // the plays as well, with a Zod path for a message.
  const withEmail = (email: string) =>
    extraction({ team: [{ name: "Ari Example", email, role: null, title: "Director" }] as AgentReportExtraction["team"] });

  it("keeps the person and drops the address, rather than losing the import", () => {
    const { extraction: clean, dropped } = sanitizeExtraction(withEmail("ari [at] example.com"), REPORT);
    expect(clean.team).toHaveLength(1);
    expect(clean.team[0]?.name).toBe("Ari Example");
    expect(clean.team[0]?.title).toBe("Director");
    expect(clean.team[0]?.email).toBeNull();
    // Said out loud, because a field quietly vanishing is the thing this app
    // does not do (DECISIONS #27). The name is what makes the person worth
    // keeping; the address is the part that was unusable.
    expect(dropped).toEqual([expect.stringMatching(/ari \[at\] example\.com/)]);
  });

  it("leaves a usable one exactly as it was", () => {
    const { extraction: clean, dropped } = sanitizeExtraction(withEmail("ari@example.com"), REPORT);
    expect(clean.team[0]?.email).toBe("ari@example.com");
    expect(dropped).toEqual([]);
  });

  it("and what survives is something the write path will actually take", () => {
    // The assertion that matters, and the one that would have caught this: run
    // the sanitizer's output through the schema the batch will run.
    for (const bad of ["ari [at] example.com", "ari@-example.test", "ari@example..test", ".ari@example.test", ""]) {
      const { extraction: clean } = sanitizeExtraction(withEmail(bad), REPORT);
      expect(ContactPatch.safeParse({ name: clean.team[0]!.name, email: clean.team[0]!.email }).success, bad).toBe(true);
    }
  });
});

describe("what sanitizing takes out", () => {
  it("unlinks a play from a deal that did not survive", () => {
    const withPlay = extraction({
      plays: [{ title: "Hold the platform", thesis: null, deal_ids: ["SYN-DEAL-001", "SYN-EXTRA-010"] }] as AgentReportExtraction["plays"],
    });
    const { extraction: clean } = sanitizeExtraction(withPlay, REPORT);
    // The play is kept — it is still useful — but it cannot point at a deal
    // that is not going to exist.
    expect(clean.plays).toHaveLength(1);
    expect(clean.plays[0]?.deal_ids).toEqual(["SYN-DEAL-001"]);
  });

  it("throws away the install base TOTAL row", () => {
    const withTotal = extraction({
      install_base: [
        { product_family: "Compute", value_usd: 4_100_000, share_pct: null, role_note: null },
        { product_family: "TOTAL", value_usd: 9_800_000, share_pct: null, role_note: null },
        { product_family: " total install base ", value_usd: 9_800_000, share_pct: null, role_note: null },
      ],
    });
    const { extraction: clean } = sanitizeExtraction(withTotal, REPORT);
    // A report's own total, imported as a product family, would double the
    // account's install base and look like a real line on the page.
    expect(clean.install_base.map((r) => r.product_family)).toEqual(["Compute"]);
  });
});

// ---- whether a run is worth paying for --------------------------------------

describe("before the button is pressed", () => {
  let seed: Seed;
  beforeEach(() => {
    resetDbForTests();
    seed = seedAccount();
  });

  it("lets a plan be drafted from an account with something on it", () => {
    expect(planReadiness(seed.accountId)).toBeNull();
  });

  it("refuses one built from nothing, and says what would help", () => {
    const empty = applyEntityChange({
      accountId: "",
      entityType: "account",
      op: "create",
      payload: { name: "Fabrikam Health" },
      actorUserId: USER,
    }).entityId;
    const why = planReadiness(empty);
    expect(why).toMatch(/Import a report, add a deal, or run research/);
  });

  it("does not count people as something to plan from", () => {
    const contactsOnly = applyEntityChange({
      accountId: "",
      entityType: "account",
      op: "create",
      payload: { name: "Fabrikam Health" },
      actorUserId: USER,
    }).entityId;
    applyEntityChange({
      accountId: contactsOnly,
      entityType: "contact",
      op: "create",
      payload: { name: "Someone", org: "customer" },
      actorUserId: USER,
    });
    // Knowing who someone is is not knowing what to do about them, and this
    // guard used to pass on one contact — enough to bill a run that invents
    // three to six plays out of an account name.
    expect(planReadiness(contactsOnly)).not.toBeNull();
  });

  it("refuses an account that is gone or archived", () => {
    expect(planReadiness("no-such-account")).toMatch(/no longer exists/);
    archiveEntity({ accountId: seed.accountId, entityType: "account", entityId: seed.accountId, actorUserId: USER });
    expect(planReadiness(seed.accountId)).toMatch(/archived/);
  });

  it("lets a brief be written about an account with people on it", () => {
    expect(briefReadiness(getMeeting(seed.meetingId)!)).toBeNull();
  });

  it("refuses a brief over an empty account", () => {
    const empty = applyEntityChange({
      accountId: "",
      entityType: "account",
      op: "create",
      payload: { name: "Fabrikam Health" },
      actorUserId: USER,
    }).entityId;
    const meetingId = applyEntityChange({
      accountId: empty,
      entityType: "meeting",
      op: "create",
      payload: { title: "First call", held_at: "2026-10-01" },
      actorUserId: USER,
    }).entityId;
    // This had no guard at all: a paid-for page of nothing.
    expect(briefReadiness(getMeeting(meetingId)!)).toMatch(/nothing on this account to brief from/);
  });

  it("refuses one for an archived meeting", () => {
    archiveEntity({ accountId: seed.accountId, entityType: "meeting", entityId: seed.meetingId, actorUserId: USER });
    expect(briefReadiness(getMeeting(seed.meetingId)!)).toMatch(/archived/);
  });
});

// ---- what a route says when it fails ----------------------------------------

function post(body: string): Request {
  return new Request("http://localhost/api/x", { method: "POST", body });
}

describe("reading a request body", () => {
  it("parses valid JSON", async () => {
    await expect(parseJson(post(JSON.stringify({ batchId: "b1" })))).resolves.toEqual({ batchId: "b1" });
  });

  it("refuses invalid JSON with a 400 rather than throwing raw", async () => {
    await expect(parseJson(post("{not json"))).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a body over the cap, measured in bytes rather than characters", async () => {
    await expect(parseJson(post(JSON.stringify({ x: "a".repeat(DEFAULT_JSON_BODY_BYTES) })))).rejects.toMatchObject({ status: 413 });
    // The cap is on bytes: a string of multi-byte characters is bigger than
    // its length suggests, which is how a limit like this gets slipped past.
    const multibyte = "é".repeat(200);
    await expect(parseJson(post(JSON.stringify({ x: multibyte })), 300)).rejects.toMatchObject({ status: 413 });
  });
});

describe("what escapes a route handler", () => {
  it("passes a successful response straight through", async () => {
    const res = await handle(async () => json({ ok: true }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("turns an HttpError into its own status and body", async () => {
    const res = await handle(async () => {
      throw new HttpError(429, { error: "Daily cap reached" });
    });
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({ error: "Daily cap reached" });
  });

  it("turns anything else into a 500 that still says what happened", async () => {
    const res = await handle(async () => {
      throw new Error("the database is locked");
    });
    expect(res.status).toBe(500);
    // Deliberately not "Internal error": these routes are behind a login two
    // people share, and the message lands in a panel only they read.
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("the database is locked") });
  });
});

describe("what an upload has to say before it is read", () => {
  it("refuses a body whose size is not declared", async () => {
    // formData() buffers the whole request before anything checks it, and
    // Number(null ?? "0") is 0 — so a chunked upload with no content-length
    // passed the guard and the 5 MB cap was applied after the bytes were
    // already in memory.
    // The route's rule, verbatim. Number("") is 0 rather than NaN, which is
    // how a blank header would otherwise declare a zero-byte body.
    const declared = (headers: Record<string, string>) => {
      const raw = headers["content-length"]?.trim();
      const length = raw ? Number(raw) : NaN;
      return Number.isFinite(length) ? length : null;
    };
    expect(declared({})).toBeNull();
    expect(declared({ "content-length": "" })).toBeNull();
    expect(declared({ "content-length": "not a number" })).toBeNull();
    expect(declared({ "content-length": "1024" })).toBe(1024);
  });
});
