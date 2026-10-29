// SYNTHETIC ONLY. Evidence supports review; only the user's explicit choice records confirmation.
import { expect, it } from "vitest";
import { db } from "@/lib/db";
import { saveDiscoveryRecord } from "@/lib/local/discovery";
import { linkArtifact, preserveArtifact } from "@/lib/local/evidence";
import { seedAccount, USER } from "./helpers";

const QUOTE = "The research director owns validation.";
async function fixture() {
  const account = seedAccount();
  const source = await preserveArtifact("synthetic-discovery.md", Buffer.from(`# Discovery\n${QUOTE}\n# Seller hypothesis\nWe may need a workshop.`));
  linkArtifact(source.id, account.accountId, USER, account.meetingId);
  const record = {
    accountId: account.accountId, meetingId: account.meetingId,
    question: "Who owns validation?", state: "confirmed",
    answer: "The research director.", speaker: "Synthetic Customer",
    confirmedAt: "2026-10-29T10:30:00-07:00", artifactId: source.id,
    locator: "section:1", quote: QUOTE,
  };
  return { ...account, source, record };
}

const count = () => (db().prepare("SELECT count(*) AS n FROM local_confirmations").get() as { n: number }).n;

it("saves explicitly confirmed answers with a source locator, exact quote, speaker, and offset time", async () => {
  const { record } = await fixture();
  const id = saveDiscoveryRecord({ ...record, operation: "confirmation" }, USER);
  const saved = db().prepare("SELECT * FROM local_confirmations WHERE id=?").get(id) as Record<string, unknown>;
  expect(saved).toMatchObject({ question: record.question, answer: record.answer, state: "confirmed", speaker: record.speaker, confirmed_at: record.confirmedAt, created_by: USER });
  expect(JSON.parse(saved.source_json as string)).toEqual({ artifactId: record.artifactId, locator: record.locator, quote: QUOTE });
});

it("keeps questions and hypotheses separate even when source and speaker inputs are present", async () => {
  const { record } = await fixture();
  expect(count()).toBe(0); // Importing and linking evidence does not confirm anything.
  for (const state of ["question", "hypothesis"]) {
    const id = saveDiscoveryRecord({ ...record, state, answer: "Potential workshop", locator: "section:2" }, USER);
    expect(db().prepare("SELECT state,speaker,confirmed_at,source_json,answer FROM local_confirmations WHERE id=?").get(id)).toEqual({ state, speaker: null, confirmed_at: null, source_json: null, answer: "Potential workshop" });
  }
});

it("requires complete confirmation fields and a real timestamp with a timezone", async () => {
  const { record } = await fixture();
  for (const field of ["answer", "speaker", "confirmedAt", "quote"])
    expect(() => saveDiscoveryRecord({ ...record, [field]: " " }, USER)).toThrow(/needs an answer, speaker, time, and source quotation/);
  for (const confirmedAt of ["2026-10-29", "2026-10-29T10:30", "2026-02-30T10:30:00Z", "2026-10-29T25:30:00Z", "invalid"])
    expect(() => saveDiscoveryRecord({ ...record, confirmedAt }, USER)).toThrow(/valid ISO date\/time with a timezone/);
  expect(count()).toBe(0);
  expect(() => saveDiscoveryRecord({ ...record, confirmedAt: "2026-10-29T17:30:00.000Z" }, USER)).not.toThrow();
});

it("checks source-account membership and exact text in the selected section on save", async () => {
  const { record } = await fixture();
  const other = seedAccount({ name: "Synthetic Harbor Lab", dealId: "SYN-HARBOR" });
  const foreignSource = await preserveArtifact("synthetic-other.md", Buffer.from(`# Other\n${QUOTE}`));
  linkArtifact(foreignSource.id, other.accountId, USER);
  expect(() => saveDiscoveryRecord({ ...record, artifactId: foreignSource.id }, USER)).toThrow(/Source does not belong/);
  expect(() => saveDiscoveryRecord({ ...record, locator: "section:2" }, USER)).toThrow(/Quotation does not match/);
  expect(() => saveDiscoveryRecord({ ...record, quote: "The director confirmed all funding." }, USER)).toThrow(/Quotation does not match/);
  db().prepare("DELETE FROM local_artifact_links WHERE artifact_id=?").run(record.artifactId);
  expect(() => saveDiscoveryRecord(record, USER)).toThrow(/Source does not belong/);
  expect(count()).toBe(0);
});

it("refuses a meeting from another account and stale archived or merged meetings", async () => {
  const { record, meetingId } = await fixture();
  const other = seedAccount({ name: "Synthetic Harbor Lab", dealId: "SYN-HARBOR" });
  expect(() => saveDiscoveryRecord({ ...record, meetingId: other.meetingId }, USER)).toThrow(/active meeting belonging/);
  for (const change of [{ archived_at: "2026-10-29", merged_into: null }, { archived_at: null, merged_into: other.meetingId }]) {
    db().prepare("UPDATE meetings SET archived_at=?,merged_into=? WHERE id=?").run(change.archived_at, change.merged_into, meetingId);
    expect(() => saveDiscoveryRecord(record, USER)).toThrow(/active meeting belonging/);
    expect(() => linkArtifact(record.artifactId, record.accountId, USER, meetingId)).toThrow(/active meeting belonging/);
  }
  expect(count()).toBe(0);
});

it("refuses stale archived or merged accounts before linking evidence or saving discovery records", async () => {
  const { record, accountId } = await fixture();
  const other = seedAccount({ name: "Synthetic Harbor Lab", dealId: "SYN-HARBOR" });
  const linksBefore = db().prepare("SELECT count(*) AS n FROM local_artifact_links").get();
  for (const change of [{ archived_at: "2026-10-29", merged_into: null }, { archived_at: null, merged_into: other.accountId }]) {
    db().prepare("UPDATE accounts SET archived_at=?,merged_into=? WHERE id=?").run(change.archived_at, change.merged_into, accountId);
    expect(() => saveDiscoveryRecord(record, USER)).toThrow(/Choose an active account/);
    expect(() => linkArtifact(record.artifactId, accountId, USER)).toThrow(/Choose an active account/);
  }
  expect(db().prepare("SELECT count(*) AS n FROM local_artifact_links").get()).toEqual(linksBefore);
  expect(count()).toBe(0);
});

it("validates direct submissions and trims ordinary text without weakening exact quotation checks", async () => {
  const { record } = await fixture();
  expect(() => saveDiscoveryRecord({ ...record, question: " " }, USER)).toThrow(/question: A question is required/);
  expect(() => saveDiscoveryRecord({ ...record, quote: "x".repeat(1001) }, USER)).toThrow(/quote:/);
  expect(() => saveDiscoveryRecord({ ...record, state: "automatically_confirmed" }, USER)).toThrow(/state:/);
  const id = saveDiscoveryRecord({ ...record, question: ` ${record.question} `, quote: ` ${QUOTE} ` }, USER);
  expect(db().prepare("SELECT question FROM local_confirmations WHERE id=?").get(id)).toEqual({ question: record.question });
});
