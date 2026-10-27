// Handing an account to another team.
//
// Two things here are worth enumerating rather than looking at. The snapshot:
// a handoff has to keep saying what it said, because the whole point is that
// the other team reads what you reviewed and sent. And the link: it is the
// only page in this app that is not behind a login, so every way of it not
// working has to actually not work.
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDbForTests } from "@/lib/db";
import { applyEntityChange } from "@/lib/proposals/apply";
import { archiveDocument } from "@/lib/documents";
import { getAccount, getDocument } from "@/lib/queries/accounts";
import { buildHandoff } from "@/lib/handoff/build";
import { needsPassphrase, proofMatches, resetUnlockAttemptsForTests, tryUnlock, unlockProof } from "@/lib/handoff/share";
import {
  handoffByToken,
  listHandoffs,
  newShareToken,
  parseHandoff,
  MIN_PASSPHRASE,
  reshare,
  revokeShare,
  shareState,
  storeHandoff,
} from "@/lib/handoff/store";
import { HandoffReport } from "@/lib/handoff/schema";
import { seedAccount, USER, type Seed } from "./helpers";

const DAY = 86_400_000;

let seed: Seed;

function make(opts: { asks?: string; note?: string | null; days?: number; passphrase?: string | null } = {}) {
  const account = getAccount(seed.accountId)!;
  const report = buildHandoff({
    account,
    by: "Alex Calloway",
    asks: opts.asks ?? "Keep the quarterly cadence with their infrastructure director.",
    note: opts.note ?? null,
  });
  return storeHandoff({ accountId: seed.accountId, userId: USER, report, shareDays: opts.days ?? 30, passphrase: opts.passphrase ?? null });
}

beforeEach(() => {
  resetDbForTests();
  seed = seedAccount();
});

describe("what is in it", () => {
  it("carries the account, the pipeline and the ask", () => {
    const { report } = make({ asks: "Take the storage refresh." });
    expect(report.v).toBe(1);
    expect(report.account.name).toBe("Synthetic Orchard Lab");
    expect(report.open_pipeline_usd).toBe(1_000);
    expect(report.deals.map((d) => d.name)).toEqual(["EHR Refresh"]);
    expect(report.plays.map((p) => p.title)).toEqual(["EHR platform defense"]);
    expect(report.contacts.map((c) => c.name)).toEqual(["Finley Example"]);
    expect(report.asks).toBe("Take the storage refresh.");
  });

  it("resolves a play's linked ids to names, because an id means nothing to them", () => {
    const { report } = make();
    expect(report.plays[0]!.deals).toEqual(["EHR Refresh"]);
  });

  it("leaves out a local deal id, which is this app's placeholder and not a CRM's", () => {
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "create",
      payload: { name: "No id yet", tcv_usd: 100_000 },
      actorUserId: USER,
    });
    const { report } = make();
    const local = report.deals.find((d) => d.name === "No id yet")!;
    expect(local.crm_id).toBeNull();
    expect(report.deals.find((d) => d.name === "EHR Refresh")!.crm_id).toBe("SYN-DEAL-001");
  });

  it("leaves out a dropped play, which is a decision not to do something", () => {
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "play",
      op: "update",
      entityId: seed.playId,
      payload: { status: "dropped" },
      actorUserId: USER,
    });
    expect(make().report.plays).toEqual([]);
  });

  it("is a snapshot, so the account moving on does not rewrite it", () => {
    // The property the whole feature rests on. /accounts/[id]/summary renders
    // live and is right to; a handoff that silently changed after it was sent
    // would be worse than no handoff at all.
    const { doc } = make();
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "update",
      entityId: seed.dealId,
      payload: { tcv_usd: 9_000_000, name: "Renamed after sending" },
      actorUserId: USER,
    });
    const stored = parseHandoff(getDocument(doc.id)!)!;
    expect(stored.report.open_pipeline_usd).toBe(1_000);
    expect(stored.report.deals[0]!.name).toBe("EHR Refresh");
  });

  it("fails on an ask too long to store rather than trimming it", () => {
    // DECISIONS #15: nothing is trimmed to a limit in silence. The build is
    // parsed against its own schema on the way out, so an over-long ask fails
    // here — while the person is still on the page that can say so — instead
    // of being cut at 4000 characters mid-sentence in the copy the other team
    // reads. An empty ask is refused by createHandoff, which is where the
    // message can name the field.
    const account = getAccount(seed.accountId)!;
    expect(() => buildHandoff({ account, by: "Alex", asks: "x".repeat(5000), note: null })).toThrow();
    expect(buildHandoff({ account, by: "Alex", asks: "x".repeat(4000), note: null }).asks).toHaveLength(4000);
  });

  it("is parsed on the way back out, not cast", () => {
    const { doc } = make();
    db().prepare(`UPDATE documents SET meta_json = ? WHERE id = ?`).run(JSON.stringify({ v: 1, nonsense: true }), doc.id);
    expect(parseHandoff(getDocument(doc.id)!)).toBeNull();
    db().prepare(`UPDATE documents SET meta_json = ? WHERE id = ?`).run("{not json", doc.id);
    expect(parseHandoff(getDocument(doc.id)!)).toBeNull();
  });

  it("only ever parses a handoff, never another kind of document", () => {
    // A spreadsheet or an uploaded report is a document on the same table.
    // Reading one as a handoff would render an empty page rather than a 404.
    db()
      .prepare(
        `INSERT INTO documents (id, account_id, kind, filename, byte_size, meta_json, status, created_at)
         VALUES ('doc-other', ?, 'other', 'export.csv', 1, '{}', 'accepted', 1)`,
      )
      .run(seed.accountId);
    expect(parseHandoff(getDocument("doc-other")!)).toBeNull();
    expect(listHandoffs(seed.accountId)).toHaveLength(0);
  });
});

describe("the link", () => {
  it("opens with the token and nothing else", () => {
    const { doc, report } = make();
    const found = handoffByToken(doc.share_token!)!;
    expect(found.report.asks).toBe(report.asks);
    // No account id anywhere in the address, so there is nothing to enumerate
    // and nothing to change into another account's.
    expect(doc.share_token).not.toContain(seed.accountId);
    expect(doc.share_token!.length).toBeGreaterThanOrEqual(40);
  });

  it("gives each handoff its own token", () => {
    expect(new Set([newShareToken(), newShareToken(), newShareToken()]).size).toBe(3);
    expect(make().doc.share_token).not.toBe(make().doc.share_token);
  });

  it("stops at the expiry, to the millisecond", () => {
    const { doc } = make({ days: 7 });
    const at = doc.share_expires_at!;
    expect(handoffByToken(doc.share_token!, at - 1)).not.toBeNull();
    expect(handoffByToken(doc.share_token!, at)).toBeNull();
    expect(handoffByToken(doc.share_token!, at + DAY)).toBeNull();
  });

  it("stops the moment it is ended", () => {
    const { doc } = make();
    const token = doc.share_token!;
    expect(handoffByToken(token)).not.toBeNull();
    revokeShare(doc.id);
    expect(handoffByToken(token)).toBeNull();
    // And the handoff itself is still here — DECISIONS #8, nothing is deleted.
    expect(parseHandoff(getDocument(doc.id)!)).not.toBeNull();
    expect(listHandoffs(seed.accountId)).toHaveLength(1);
  });

  it("gives a new address when it is shared again, so the old one stays dead", () => {
    const { doc } = make();
    const old = doc.share_token!;
    revokeShare(doc.id);
    const fresh = reshare(doc.id, 7);
    expect(fresh).not.toBe(old);
    expect(handoffByToken(old)).toBeNull();
    expect(handoffByToken(fresh)).not.toBeNull();
  });

  it("gives a new address after it merely ran out, not only after it was ended", () => {
    // The case above revokes first, which nulls the token — so it would still
    // pass if reshare reissued whatever token it found. Expiry is the other
    // half and the commoner one: a link runs out on its own, `shareState`
    // returns "expired" with the token still set, and the page offers "Share
    // it again" in that state exactly as it does after an end. Mutating
    // reshare to reuse an existing token broke no test until this one.
    const { doc } = make({ days: 7 });
    const old = doc.share_token!;
    const after = (doc.share_expires_at ?? 0) + 1;
    expect(handoffByToken(old, after)).toBeNull();

    const fresh = reshare(doc.id, 30, after);
    expect(fresh).not.toBe(old);
    // The address that was handed out before must not start working again
    // because a new one was issued.
    expect(handoffByToken(old, after)).toBeNull();
    expect(handoffByToken(fresh, after)).not.toBeNull();
  });

  it("stops when the handoff is archived", () => {
    // Archiving is the natural "I am done with this", and a link that kept
    // working afterwards would make it a lie.
    const { doc } = make();
    archiveDocument(doc.id, USER);
    expect(handoffByToken(doc.share_token!)).toBeNull();
    expect(listHandoffs(seed.accountId)).toHaveLength(0);
  });

  it("answers nothing for a token that was never real", () => {
    make();
    expect(handoffByToken("")).toBeNull();
    expect(handoffByToken(newShareToken())).toBeNull();
    expect(handoffByToken("../../etc/passwd")).toBeNull();
  });

  it("says which of the three states a link is in", () => {
    const { doc } = make({ days: 7 });
    expect(shareState(doc)).toBe("live");
    expect(shareState(doc, (doc.share_expires_at ?? 0) + 1)).toBe("expired");
    revokeShare(doc.id);
    expect(shareState(getDocument(doc.id)!)).toBe("revoked");
  });

  it("cannot be shared again once archived", () => {
    const { doc } = make();
    archiveDocument(doc.id, USER);
    expect(() => reshare(doc.id, 30)).toThrow();
  });
});

describe("the shape it is stored in", () => {
  it("round-trips through JSON unchanged", () => {
    const { doc, report } = make({ note: "They have a new CIO from March." });
    expect(HandoffReport.parse(JSON.parse(doc.meta_json!))).toEqual(report);
  });
});

describe("a word on the link", () => {
  const WORD = "quarterly-cadence";

  beforeEach(() => resetUnlockAttemptsForTests());

  it("is optional, and a link without one behaves exactly as before", () => {
    const { doc } = make();
    expect(needsPassphrase(doc)).toBe(false);
    expect(doc.share_passphrase_hash ?? null).toBeNull();
  });

  it("never stores what was typed", () => {
    // The sender knows the word because they chose it; nothing here needs it
    // back, and a passphrase sitting in the row would be readable by anything
    // that can read the handoff it protects.
    const { doc } = make({ passphrase: WORD });
    expect(doc.share_passphrase_hash).toBeTruthy();
    expect(doc.share_passphrase_hash).not.toContain(WORD);
    expect(JSON.stringify(doc)).not.toContain(WORD);
  });

  it("opens for the right word and not the wrong one", () => {
    const { doc } = make({ passphrase: WORD });
    expect(tryUnlock(doc, "not it").ok).toBe(false);
    const ok = tryUnlock(doc, WORD);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(proofMatches(doc, ok.proof)).toBe(true);
  });

  it("refuses a word too short to be worth the step", () => {
    expect(() => make({ passphrase: "short" })).toThrow();
    expect(() => make({ passphrase: "x".repeat(MIN_PASSPHRASE) })).not.toThrow();
  });

  it("cannot be unlocked by anything derivable from the link itself", () => {
    // The whole design rests on this: the proof is keyed on the stored hash,
    // which is not in the URL, not in the page and not reachable by someone
    // holding the address. If it could be computed from the token, the cookie
    // would be forgeable by exactly the person the passphrase excludes.
    //
    // So this does not merely try the token as a value — it plays the attack
    // out, building the HMAC every way a person holding only the link could.
    // Keying unlockProof on the token instead of the hash passed every other
    // test in this file, which is why the forgery is written out here.
    const { doc } = make({ passphrase: WORD });
    const known = [doc.share_token!, doc.id, `${doc.id}:${doc.share_token}`, ""];
    for (const guess of known) expect(proofMatches(doc, guess)).toBe(false);
    for (const key of known) {
      for (const msg of known) {
        expect(proofMatches(doc, createHmac("sha256", key).update(msg).digest("base64url"))).toBe(false);
        expect(proofMatches(doc, createHmac("sha256", key).update(msg).digest("hex"))).toBe(false);
      }
    }
  });

  it("gives a proof that does not open a different handoff", () => {
    const a = make({ passphrase: WORD }).doc;
    const b = make({ passphrase: WORD }).doc;
    const ok = tryUnlock(a, WORD);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(proofMatches(a, ok.proof)).toBe(true);
      expect(proofMatches(b, ok.proof)).toBe(false);
    }
  });

  it("stops answering after repeated wrong words", () => {
    const { doc } = make({ passphrase: WORD });
    for (let i = 0; i < 5; i++) expect(tryUnlock(doc, "wrong").ok).toBe(false);
    const locked = tryUnlock(doc, WORD);
    // Even the right word waits, which is the point of a lockout.
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("forgets the wrong answers once one is right", () => {
    const { doc } = make({ passphrase: WORD });
    for (let i = 0; i < 4; i++) tryUnlock(doc, "wrong");
    expect(tryUnlock(doc, WORD).ok).toBe(true);
    for (let i = 0; i < 4; i++) expect(tryUnlock(doc, "wrong").ok).toBe(false);
    expect(tryUnlock(doc, WORD).ok).toBe(true);
  });

  it("ends the word when the link ends, and does not carry it to the next one", () => {
    // Two halves of the same rule. A revoked link keeps no hash, and a new
    // address never inherits the old word — otherwise somebody told the old
    // passphrase would hold half of a link they were never given.
    const { doc } = make({ passphrase: WORD });
    revokeShare(doc.id);
    expect(getDocument(doc.id)!.share_passphrase_hash ?? null).toBeNull();

    const fresh = reshare(doc.id, 7);
    const after = getDocument(doc.id)!;
    expect(after.share_token).toBe(fresh);
    expect(needsPassphrase(after)).toBe(false);

    const guarded = reshare(doc.id, 7, Date.now(), "another-good-word");
    const now = getDocument(doc.id)!;
    expect(now.share_token).toBe(guarded);
    expect(needsPassphrase(now)).toBe(true);
    expect(tryUnlock(now, WORD).ok).toBe(false);
    expect(tryUnlock(now, "another-good-word").ok).toBe(true);
  });

  it("drops the word when a still-live link is shared again without one", () => {
    // Deliberately no revoke first. Revoking already clears the hash, so a
    // test that ends the link before re-sharing cannot see whether reshare
    // carries the old word onto the new address — and the same blind spot had
    // already hidden one bug in this file. Sharing a link that simply ran out
    // is the commoner path and the one that exposes it.
    const { doc } = make({ passphrase: WORD, days: 7 });
    const expired = (doc.share_expires_at ?? 0) + 1;
    const fresh = reshare(doc.id, 30, expired);
    const after = getDocument(doc.id)!;
    expect(after.share_token).toBe(fresh);
    expect(needsPassphrase(after)).toBe(false);
    expect(handoffByToken(fresh, expired)).not.toBeNull();
  });

  it("makes a proof issued for the old address useless on the new one", () => {
    const { doc } = make({ passphrase: WORD });
    const before = tryUnlock(doc, WORD);
    expect(before.ok).toBe(true);
    reshare(doc.id, 7, Date.now(), WORD);
    const after = getDocument(doc.id)!;
    if (before.ok) expect(proofMatches(after, before.proof)).toBe(false);
  });

  it("still 404s for a bad token before any passphrase is asked for", () => {
    // Order matters: the box must never be the thing that tells somebody a
    // token is real when it is not.
    make({ passphrase: WORD });
    expect(handoffByToken("nope")).toBeNull();
  });

  it("keeps the proof stable across reads, so a reload does not re-ask", () => {
    const { doc } = make({ passphrase: WORD });
    expect(unlockProof(doc)).toBe(unlockProof(getDocument(doc.id)!));
  });
});

describe("an install base bigger than the cap", () => {
  it("truncates like every other list here, instead of throwing", () => {
    // `HandoffInstallBase.rows` is `.max(100)`, and unlike MEETINGS, NOTES and
    // FINDINGS it was never sliced before validation — so a large snapshot did
    // not produce a shorter handoff, it produced a ZodError and no handoff at
    // all, from the one surface with nowhere for the reader to go and ask.
    for (let i = 0; i < 105; i += 1) {
      applyEntityChange({
        accountId: seed.accountId,
        entityType: "install_base",
        op: "create",
        payload: { product_family: `Family ${String(i).padStart(3, "0")}`, value_usd: 1_000 * (i + 1), as_of: "2026-06-30" },
        actorUserId: USER,
      });
    }
    const account = getAccount(seed.accountId)!;
    const report = buildHandoff({ account, by: "Alex Calloway", asks: "Keep the cadence.", note: null });
    expect(report.install_base.rows).toHaveLength(100);
    // And it keeps the most consequential rows, which is what every other cap
    // in this file promises: latestInstallBase orders by value descending, so
    // the largest families survive and the smallest are the ones dropped.
    expect(report.install_base.rows[0]!.value_usd).toBe(105_000);
    expect(report.install_base.rows.some((r) => r.value_usd === 1_000)).toBe(false);
  });
});
