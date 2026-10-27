// SYNTHETIC ONLY: actual HTTP route, real sessions, and the test in-memory DB.
import { beforeEach, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/research-notes/[id]/route";
import { createSession, SESSION_COOKIE } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDocument } from "@/lib/queries/accounts";
import { parseNote, storeDraftNote } from "@/lib/research/notes";
import { keptFindings } from "@/lib/research/schema";
import { seedAccount, USER } from "./helpers";

let accountId: string;
let session: string;
beforeEach(() => {
  accountId = seedAccount().accountId;
  db().prepare("INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(USER, "test@example.com", "unused", "Test", 1, 1);
  session = createSession(USER).id;
});

function draft() {
  const findings = Array.from({ length: 121 }, (_, i) => ({
    text: `Synthetic unit ${i} published a fictional project update.`,
    quote: `Synthetic unit ${i} published a fictional project update.`,
    url: `https://example.com/reference/${i}`,
    confidence: "high" as const,
    date: null,
    topic: "strategy" as const,
  }));
  return storeDraftNote({
    accountId,
    userId: USER,
    aiRunId: "synthetic-acceptance-route",
    note: { title: "Synthetic acceptance dossier", summary: "Fictional findings only.", findings, open_questions: ["Which fictional milestone needs review?"] },
    prose: findings.map((finding) => finding.quote).join("\n"),
    sources: findings.map((finding) => finding.url),
    focus: null,
    depth: "deep",
    searches: 0,
    fetches: 0,
    dropped: [],
  });
}

function request(id: string, body: unknown, authenticated = true) {
  return POST(new NextRequest(`http://localhost/api/research-notes/${id}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(authenticated ? { cookie: `${SESSION_COOKIE}=${session}` } : {}) },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) });
}

it("accepts every selected finding above 100 and preserves the complete original note", async () => {
  const doc = draft();
  const original = parseNote(doc)!.meta;
  const keep = original.findings.map((_, i) => i);
  expect(keep.length).toBeGreaterThan(100);
  const response = await request(doc.id, { action: "accept", keep });
  expect(response.status).toBe(200);
  expect.soft(await response.json()).toEqual({ status: "accepted", kept: keep.length, documentId: doc.id });

  const saved = getDocument(doc.id)!;
  const meta = parseNote(saved)!.meta;
  expect(saved.status).toBe("accepted");
  expect(saved.content_text).toBe(doc.content_text);
  expect.soft(meta.accepted_finding_indexes).toEqual(keep);
  expect.soft(keptFindings(meta)).toEqual(original.findings);
  expect(meta).toEqual({ ...original, accepted_finding_indexes: meta.accepted_finding_indexes, accepted_by: USER, accepted_at: expect.any(String) });
});

it("reports the persisted unique valid count for duplicate, unordered and invalid indexes", async () => {
  const doc = draft();
  const original = parseNote(doc)!.meta;
  const response = await request(doc.id, {
    action: "accept",
    keep: [120, 0, 120, 100, 0, -1, 121, 99999, 1.5, "1", null, true, {}],
  });
  expect(response.status).toBe(200);
  expect.soft(await response.json()).toEqual({ status: "accepted", kept: 3, documentId: doc.id });
  const meta = parseNote(getDocument(doc.id)!)!.meta;
  expect(meta.accepted_finding_indexes).toEqual([0, 100, 120]);
  expect(keptFindings(meta)).toEqual([original.findings[0], original.findings[100], original.findings[120]]);
  expect(meta.findings).toEqual(original.findings);
});

it("reports zero retained findings when no requested index is valid", async () => {
  const doc = draft();
  const response = await request(doc.id, { action: "accept", keep: [-1, 121, 121, 0.5, "0", null] });
  expect(response.status).toBe(200);
  expect.soft(await response.json()).toEqual({ status: "accepted", kept: 0, documentId: doc.id });
  const meta = parseNote(getDocument(doc.id)!)!.meta;
  expect(meta.accepted_finding_indexes).toEqual([]);
  expect(keptFindings(meta)).toEqual([]);
  expect(meta.findings).toEqual(parseNote(doc)!.meta.findings);
});

it("requires authentication before accepting or mutating a note", async () => {
  const doc = draft();
  const response = await request(doc.id, { action: "accept", keep: [0, 120] }, false);
  expect(response.status).toBe(401);
  expect(getDocument(doc.id)).toEqual(doc);
});

it("accepts a 64 KiB body but rejects one byte more without mutating persistence", async () => {
  const doc = draft();
  const body = { action: "accept", keep: [0, 120], padding: "" };
  body.padding = "x".repeat(64 * 1024 - Buffer.byteLength(JSON.stringify(body), "utf8"));
  expect(Buffer.byteLength(JSON.stringify(body), "utf8")).toBe(64 * 1024);
  const accepted = await request(doc.id, body);
  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toEqual({ status: "accepted", kept: 2, documentId: doc.id });
  const saved = getDocument(doc.id)!;
  expect(parseNote(saved)!.meta.accepted_finding_indexes).toEqual([0, 120]);

  const response = await request(doc.id, { ...body, padding: `${body.padding}x` });
  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({ error: "Request body too large" });
  expect(getDocument(doc.id)).toEqual(saved);
});
