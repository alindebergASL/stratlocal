// SYNTHETIC ONLY: invented sandbox accounts, the in-memory test database, and
// the real freshness route with real sessions.
import { beforeEach, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/accounts/[id]/freshness/route";
import { createSession, SESSION_COOKIE } from "@/lib/auth";
import { db } from "@/lib/db";
import { isNewerRevision, parseRevision, supportsFreshness } from "@/lib/freshness";
import { accountRevision } from "@/lib/queries/freshness";
import { applyEntityChange } from "@/lib/proposals/apply";
import { newId } from "@/lib/ids";
import { seedAccount, USER } from "./helpers";

let seed: ReturnType<typeof seedAccount>;
let session: string;

it("limits refresh to the surfaces whose drafts are protected", () => {
  for (const suffix of ["", "/deals", "/plays", "/people", "/meetings", "/follow-ups", "/details", "/meetings/m1", "/deals/d1", "/contacts/c1", "/plays/p1"]) {
    expect(supportsFreshness(`/accounts/synthetic${suffix}`, "synthetic")).toBe(true);
  }
  for (const path of ["/accounts/synthetic/research", "/accounts/synthetic/review", "/accounts/synthetic/import", "/accounts/synthetic/import-sheet", "/accounts/synthetic/summary", "/accounts/other", "/accounts/synthetic-other"]) {
    expect(supportsFreshness(path, "synthetic")).toBe(false);
  }
});
beforeEach(() => {
  seed = seedAccount();
  db()
    .prepare("INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(USER, "alex@example.com", "unused", "Alex", 1, 1);
  session = createSession(USER).id;
});

function request(id: string, authenticated = true) {
  const req = new NextRequest(`http://localhost/api/accounts/${id}/freshness`);
  if (authenticated) req.cookies.set(SESSION_COOKIE, session);
  return GET(req, { params: Promise.resolve({ id }) });
}

function edit(accountId: string, dealId: string, nextStep: string) {
  applyEntityChange({ accountId, entityType: "deal", op: "update", entityId: dealId, payload: { next_step: nextStep }, actorUserId: USER });
}

it("moves when the account is written to and not otherwise", () => {
  const before = accountRevision(seed.accountId);
  expect(accountRevision(seed.accountId)).toBe(before);
  edit(seed.accountId, seed.dealId, "Book the architecture review");
  const after = accountRevision(seed.accountId);
  expect(after).not.toBe(before);
  expect(isNewerRevision(after, before)).toBe(true);
  expect(isNewerRevision(before, after)).toBe(false);
});

it("is scoped to one account, so another account's work is invisible", () => {
  const other = seedAccount({ name: "Synthetic Harbor Lab", dealId: "SYN-DEAL-002" });
  const mine = accountRevision(seed.accountId);
  edit(other.accountId, other.dealId, "Their next step");
  expect(accountRevision(seed.accountId)).toBe(mine);
  expect(isNewerRevision(accountRevision(other.accountId), mine)).toBe(true);
});

it("separates two changes written in the same millisecond", () => {
  const at = Date.now();
  const insert = db().prepare(
    `INSERT INTO change_log (id, account_id, entity_type, entity_id, field, old_value, new_value, actor_user_id, created_at)
     VALUES (?, ?, 'deal', ?, 'next_step', NULL, ?, ?, ?)`,
  );
  const before = accountRevision(seed.accountId);
  insert.run(newId(), seed.accountId, seed.dealId, "one", USER, at);
  const middle = accountRevision(seed.accountId);
  insert.run(newId(), seed.accountId, seed.dealId, "two", USER, at);
  const after = accountRevision(seed.accountId);
  // Same created_at throughout: a cursor built on MAX(created_at) alone would
  // report the second edit as no change at all.
  expect(isNewerRevision(middle, before)).toBe(true);
  expect(isNewerRevision(after, middle)).toBe(true);
});

it("answers an authenticated caller with a cursor and nothing else", async () => {
  edit(seed.accountId, seed.dealId, "Send the sizing document");
  const res = await request(seed.accountId);
  expect(res.status).toBe(200);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  const body = (await res.json()) as Record<string, unknown>;
  expect(Object.keys(body)).toEqual(["revision"]);
  expect(parseRevision(body.revision)).not.toBeNull();
  expect(JSON.stringify(body)).not.toContain("sizing document");
});

it("refuses an unauthenticated caller and an unknown account", async () => {
  expect((await request(seed.accountId, false)).status).toBe(401);
  const unknown = await request("not-an-account");
  expect(unknown.status).toBe(404);
  // Unknown to an authenticated partner, not a way to tell accounts apart
  // from outside: signed out, an unknown id answers the same 401 as a real one.
  const unknownAnonymous = await request("not-an-account", false);
  expect(unknownAnonymous.status).toBe(401);
});

it("reads unparsable and missing answers as no news, never as current", () => {
  const known = accountRevision(seed.accountId);
  for (const junk of [undefined, null, "", "abc", "1", "1.2.3", "-1.4", "9".repeat(20), {}, 12]) {
    expect(isNewerRevision(junk, known)).toBe(false);
    expect(isNewerRevision(known, junk)).toBe(false);
  }
});

it("every page the notice is scoped to reports its own cursor, not only the layout's", () => {
  // The account layout renders once and is kept across client navigations
  // beneath it, so its cursor goes stale the moment someone walks from the
  // overview to a record page after the other one wrote. Each supported page
  // reports the cursor its own render read.
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  for (const page of ["meetings/[mid]/page.tsx", "deals/[dealId]/page.tsx", "contacts/[contactId]/page.tsx", "plays/[playId]/page.tsx"]) {
    const src = readFileSync(`app/accounts/[id]/${page}`, "utf8");
    expect(src, `${page} does not report its cursor`).toMatch(/<FreshnessBaseline revision=\{accountRevision\(id\)\} \/>/);
  }
  // The Overview and the record tabs report theirs through the account
  // header, which every one of them renders; Research renders it too, and
  // the header leaves the cursor out there.
  const header = readFileSync("components/AccountHeader.tsx", "utf8");
  expect(header).toMatch(/\{tab !== "research" && <FreshnessBaseline revision=\{accountRevision\(id\)\} \/>\}/);
  for (const [page, tab] of [["page.tsx", "overview"], ["deals/page.tsx", "deals"], ["plays/page.tsx", "plan"], ["people/page.tsx", "people"], ["meetings/page.tsx", "meetings"], ["follow-ups/page.tsx", "follow-ups"], ["details/page.tsx", "details"], ["research/page.tsx", "research"]]) {
    expect(readFileSync(`app/accounts/[id]/${page}`, "utf8"), `${page} renders the header`).toContain(`<AccountHeader account={account} tab="${tab}"`);
  }
  for (const page of ["research/page.tsx", "import/page.tsx", "import-sheet/page.tsx"]) {
    const src = readFileSync(`app/accounts/[id]/${page}`, "utf8");
    expect(src, `${page} must not grow a refresh control`).not.toMatch(/FreshnessBaseline/);
  }
});

it("moves when a batch of proposals arrives, and again when one is turned down", async () => {
  // Neither writes history: nothing on the account has changed yet. The
  // other one's extraction filling the review list, or their rejection of a
  // proposal you are looking at, must still be noticed.
  const { createProposalBatch, rejectProposal } = await import("@/lib/proposals/apply");
  const start = accountRevision(seed.accountId);
  const { ids } = createProposalBatch(seed.accountId, { kind: "meeting", id: seed.meetingId, aiRunId: null }, [
    { entity_type: "action_item", op: "create", payload: { text: "Synthetic proposed follow-up", status: "open", meeting_id: seed.meetingId }, rationale: "synthetic" },
  ]);
  const proposed = accountRevision(seed.accountId);
  expect(isNewerRevision(proposed, start)).toBe(true);
  rejectProposal(ids[0]!, USER);
  expect(isNewerRevision(accountRevision(seed.accountId), proposed)).toBe(true);
});
