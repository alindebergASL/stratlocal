// Research notes are `documents` rows, written here rather than through
// applyEntityChange: a document is not an entity and nothing can propose one
// (DECISIONS #8). lib/documents.ts owns archiving and the history lines.
import { peersForPrompt } from "./peers";
import { db, type DocumentRow } from "../db";
import { newId } from "../ids";
import { todayISO } from "../clock";
import { ApplyError } from "../proposals/apply";
import { archiveDocument, logDocumentChange } from "../documents";
import { wrapUntrusted } from "../ai/prompts";
import { getAccount, getDocument, listDocuments } from "../queries/accounts";
import { keptFindings, ResearchMeta, ResearchSource, type FindingRead, type ResearchNote, type ResearchReport } from "./schema";

import { selectEvidence, evidenceText } from "./evidence";

export type ParsedNote = { doc: DocumentRow; meta: ResearchMeta };

// meta_json is attacker-influenced: it was written from web pages. It is
// parsed, never cast.
export function parseNote(doc: DocumentRow): ParsedNote | null {
  if (doc.kind !== "research_note" || !doc.meta_json) return null;
  try {
    const parsed = ResearchMeta.safeParse(JSON.parse(doc.meta_json));
    return parsed.success ? { doc, meta: parsed.data } : null;
  } catch {
    return null;
  }
}

// The note's own title, falling back to the filename when meta_json will not
// parse. Safe to call on any document row.
export function noteTitle(doc: DocumentRow): string {
  return parseNote(doc)?.meta.title ?? doc.filename;
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "note"
  );
}

export function listNotes(accountId: string, status?: "draft" | "accepted"): ParsedNote[] {
  return listDocuments(accountId, { kinds: ["research_note"] })
    .filter((d) => !status || d.status === status)
    .map(parseNote)
    .filter((n): n is ParsedNote => n !== null);
}

export function listArchivedNotes(accountId: string): ParsedNote[] {
  return listDocuments(accountId, {
    kinds: ["research_note"],
    includeArchived: true,
  })
    .filter((d) => d.archived_at != null)
    .map(parseNote)
    .filter((n): n is ParsedNote => n !== null);
}

export function storeDraftNote(input: {
  accountId: string;
  userId: string | null;
  aiRunId: string;
  note: ResearchNote;
  prose: string;
  sources?: string[];
  reportEvidence?: ResearchReport["evidence"];
  capture?: ResearchReport["capture"];
  focus: string | null;
  depth: "standard" | "deep";
  searches: number;
  fetches: number;
  dropped: string[];
}): DocumentRow {
  const conn = db();
  return conn.transaction((): DocumentRow => {
    // An account archived during research must not acquire a new draft.
    const account = getAccount(input.accountId);
    if (!account || account.archived_at) throw new ApplyError("That account is missing or archived.", "state");
    // Two runs in a row would otherwise leave two drafts to review. The older
    // one is archived rather than dropped, so nothing is lost.
    for (const prior of listDocuments(input.accountId, {
      kinds: ["research_note"],
    })) {
      if (prior.status === "draft") archiveDocument(prior.id, input.userId);
    }
    const id = newId();
    const generatedAt = todayISO();
    const meta = {
      ...(input.reportEvidence ? {report_evidence:input.reportEvidence} : {}),
      ...(input.capture ? {capture:input.capture} : {}),
      title: input.note.title,
      summary: input.note.summary,
      findings: input.note.findings,
      open_questions: input.note.open_questions,
      ...(input.note.reads ? { reads: input.note.reads, read_at: new Date().toISOString() } : {}),
      ...(input.note.entity ? { entity: input.note.entity } : {}),
      ...(input.note.buying_group?.length ? { buying_group: input.note.buying_group } : {}),
      ...(input.note.people?.length ? { people: input.note.people } : {}),
      ...(input.note.peers?.length ? { peers: input.note.peers, peers_summary: input.note.peers_summary ?? null } : {}),
      focus: input.focus,
      depth: input.depth,
      generated_at: generatedAt,
      searches: input.searches,
      fetches: input.fetches,
      dropped: input.dropped,
      sources: (input.sources ?? []).filter((url) => ResearchSource.safeParse(url).success),
    };
    conn
      .prepare(
        `INSERT INTO documents (id, account_id, kind, filename, mime, byte_size, content_text, meta_json, status, ai_run_id, created_by, created_at)
         VALUES (?, ?, 'research_note', ?, 'text/markdown', ?, ?, ?, 'draft', ?, ?, ?)`,
      )
      .run(
        id,
        input.accountId,
        `research-${generatedAt}-${slug(input.note.title)}.md`,
        Buffer.byteLength(input.prose, "utf8"),
        input.prose,
        JSON.stringify(meta),
        input.aiRunId,
        input.userId,
        Date.now(),
      );
    return getDocument(id) as DocumentRow;
  })();
}

// Accepting does not rewrite the note: it records which findings were kept.
// The model's original answer and the prose it came from stay exactly as they
// were, so an untick can be undone by accepting again.
export function acceptNote(documentId: string, keepIndexes: number[], userId: string): DocumentRow {
  const conn = db();
  return conn.transaction((): DocumentRow => {
    const doc = getDocument(documentId);
    if (!doc) throw new ApplyError(`document ${documentId} not found`, "not_found");
    const account = getAccount(doc.account_id);
    if (!account || account.archived_at) throw new ApplyError("Account missing or archived", "state");
    if (doc.archived_at) throw new ApplyError("that research note is archived; restore it first", "state");
    const parsed = parseNote(doc);
    if (!parsed) throw new ApplyError("that document is not a research note", "validation");
    const kept = [...new Set(keepIndexes)].filter((i) => Number.isInteger(i) && i >= 0 && i < parsed.meta.findings.length).sort((a, b) => a - b);
    const meta = {
      ...parsed.meta,
      accepted_finding_indexes: kept,
      accepted_by: userId,
      accepted_at: new Date().toISOString(),
    };
    conn.prepare(`UPDATE documents SET meta_json = ?, status = 'accepted' WHERE id = ?`).run(JSON.stringify(meta), documentId);
    if (doc.status !== "accepted") {
      logDocumentChange({
        accountId: doc.account_id,
        documentId,
        field: "status",
        oldValue: doc.status,
        newValue: "accepted",
        actorUserId: userId,
      });
    }
    logDocumentChange({
      accountId: doc.account_id,
      documentId,
      field: "accepted_findings",
      oldValue: parsed.meta.accepted_finding_indexes?.length ?? null,
      newValue: `${kept.length} of ${parsed.meta.findings.length}`,
      actorUserId: userId,
    });
    return getDocument(documentId) as DocumentRow;
  })();
}

// ---- what a prompt is allowed to read ---------------------------------------

// Accepted, unarchived notes with the findings a person kept. This is the
// only way research content reaches a model, and it always arrives wrapped:
// the text was written from public web pages, so it is evidence, not
// instruction (DECISIONS #2).
export function loadAcceptedResearch(accountId: string, _limit?: number): ParsedNote[] {
  return listNotes(accountId, "accepted").filter((n) => keptFindings(n.meta).length > 0);
}

export function researchSelection(accountId: string, focus = "") {
  return selectEvidence(loadAcceptedResearch(accountId), focus);
}
export function researchForPrompt(accountId: string, focus: string | number = ""): string {
  const selection = researchSelection(accountId, typeof focus === "string" ? focus : "");
  if (!selection.total) return "";
  const blocks = selection.included.map((e) =>
    wrapUntrusted(
      "research_note",
      `[${e.id}] ${evidenceText(e)}\nPublished: ${e.finding.date ?? (e.finding.page_age ? `${e.finding.page_age} (search index)` : "undated")}\nModel confidence: ${e.finding.confidence}; ${e.finding.evidence?.kind === "source_excerpt" ? "source-bound excerpt, not independent claim verification" : "UNVERIFIED report excerpt"}${readLine(e.read)}\n${e.finding.quote}\n${e.finding.url}`,
      { research_id: e.id, as_of: e.asOf },
    ),
  );
  // Who the research is about, and who might decide: the second is a guess
  // from public sources, sent as one and never as a person on file.
  const notes = loadAcceptedResearch(accountId).sort((a, b) => b.meta.generated_at.localeCompare(a.meta.generated_at));
  const entity = notes.find((n) => n.meta.entity)?.meta.entity;
  const group = notes.find((n) => n.meta.buying_group?.length)?.meta.buying_group ?? [];
  const extra = [
    peersForPrompt(accountId) || null,
    entity ? wrapUntrusted("research_entity", `Researched as: ${[entity.name, entity.domain, entity.ticker && `ticker ${entity.ticker}`, entity.parent && `part of ${entity.parent}`, entity.hq].filter(Boolean).join(" · ")}`) : null,
    group.length
      ? wrapUntrusted(
          "buying_group_hypotheses",
          `HYPOTHESES ONLY, from public sources, to test in discovery. None is a person on file; never propose one as a contact, a title or a fact, and never cite these.\n${group.map((g) => `- ${g.role} (${g.likely}): ${g.basis} Ask: ${g.question}`).join("\n")}`,
        )
      : null,
  ].filter(Boolean);
  return `Accepted research: ${selection.included.length} included, ${selection.omitted} omitted; all retained evidence remains in Research. Cite only supplied research_id values. Preserve planned/proposed qualifiers. A past target does not prove completion. Unknown means not found in this research, not absence in the world. Do not equate investment IT with enterprise IT. An "Earlier read" is the model's own earlier judgement of a finding, not evidence: use it to prioritise, and cite the finding.\n${[...extra, ...blocks].join("\n")}`;
}

function readLine(read: FindingRead | undefined): string {
  if (!read || (!read.signal && read.fits.length === 0)) return "";
  const parts = [
    read.signal === "compelling_event" ? `compelling event${read.owner ? `, owned by ${read.owner}` : ""}` : read.signal === "trigger" ? "trigger: a reason to talk now" : null,
    read.fits.length ? `touches ${read.fits.join(", ")}` : null,
    read.so_what ? `so what: ${read.so_what}` : null,
  ].filter(Boolean);
  return `\nEarlier read (model's, not verified): ${parts.join("; ")}`;
}

export function resolveNote(documentId: string, obsoleteIndex: number, supportingIds: string[], reason: string, userId: string): DocumentRow {
  return db().transaction(() => {
    const doc = getDocument(documentId);
    if (!doc) throw new ApplyError("Research note not found", "not_found");
    const account = getAccount(doc.account_id);
    const parsed = parseNote(doc);
    if (!account || account.archived_at || doc.archived_at || doc.status !== "accepted" || !parsed)
      throw new ApplyError("Account and research must be current and accepted", "state");
    if (
      !Number.isInteger(obsoleteIndex) ||
      obsoleteIndex < 0 ||
      !parsed.meta.findings[obsoleteIndex] ||
      typeof reason !== "string" ||
      !reason.trim() ||
      reason.length > 1000 ||
      !Array.isArray(supportingIds) ||
      !supportingIds.length ||
      supportingIds.length > 40 ||
      supportingIds.some((id) => typeof id !== "string" || !/^.+#\d+$/.test(id))
    )
      throw new ApplyError("A finding, supporting evidence and reason are required", "validation");
    const target = `${documentId}#${obsoleteIndex}`;
    const notes = listNotes(doc.account_id, "accepted");
    const current = new Set(notes.flatMap((n) => n.meta.findings.flatMap((f, i) => (keptFindings(n.meta).includes(f) ? [`${n.doc.id}#${i}`] : []))));
    if (!current.has(target)) throw new ApplyError("Obsolete finding must still be retained and unresolved", "state");
    const ids = [...new Set(supportingIds)];
    if (ids.some((id) => id === target || !current.has(id))) throw new ApplyError("Supporting evidence must be other retained current same-account findings", "validation");
    const edges = new Map<string, string[]>(notes.flatMap((n) => (n.meta.resolutions ?? []).map((r) => [`${n.doc.id}#${r.obsolete_index}`, r.supporting_ids] as const)));
    const reaches = (id: string, seen = new Set<string>()): boolean =>
      id === target || (!seen.has(id) && (seen.add(id), (edges.get(id) ?? []).some((next) => reaches(next, seen))));
    if (ids.some((id) => reaches(id))) throw new ApplyError("Resolution would create a cycle", "validation");
    const resolution = {
      obsolete_index: obsoleteIndex,
      supporting_ids: ids,
      reason: reason.trim(),
      actor: userId,
      at: new Date().toISOString(),
    };
    db()
      .prepare("UPDATE documents SET meta_json=? WHERE id=?")
      .run(
        JSON.stringify({
          ...parsed.meta,
          resolutions: [...(parsed.meta.resolutions ?? []), resolution],
        }),
        documentId,
      );
    logDocumentChange({
      accountId: doc.account_id,
      documentId,
      field: "resolution",
      oldValue: null,
      newValue: JSON.stringify(resolution),
      actorUserId: userId,
    });
    return getDocument(documentId)!;
  })();
}

export { keptFindings };

// ---- still true? ---------------------------------------------------------------

function keptNote(documentId: string, index: number) {
  const doc = getDocument(documentId);
  if (!doc || doc.archived_at) throw new ApplyError("That research note is gone.", "not_found");
  const parsed = parseNote(doc);
  if (!parsed || doc.status !== "accepted") throw new ApplyError("That is not a kept research note.", "validation");
  const kept = parsed.meta.accepted_finding_indexes ?? parsed.meta.findings.map((_, i) => i);
  if (!kept.includes(index)) throw new ApplyError("That finding is no longer kept.", "state");
  return { doc, meta: parsed.meta, kept };
}

/** A person says a kept finding is still true; it leaves the list for a while. */
export function markStillTrue(documentId: string, index: number, userId: string): void {
  db().transaction(() => {
    const { doc, meta } = keptNote(documentId, index);
    const checked = { ...(meta.checked_at ?? {}), [String(index)]: new Date().toISOString() };
    db().prepare("UPDATE documents SET meta_json = ? WHERE id = ?").run(JSON.stringify({ ...meta, checked_at: checked }), documentId);
    logDocumentChange({ accountId: doc.account_id, documentId, field: "finding_checked", oldValue: null, newValue: `finding ${index + 1} still true`, actorUserId: userId });
  })();
}

/**
 * A person says a kept finding is no longer true. It is unticked, the way a
 * re-review would, without counting as a new review of the whole note (so the
 * note's other findings do not show as new). Nothing is deleted.
 */
export function dropKeptFinding(documentId: string, index: number, userId: string): void {
  db().transaction(() => {
    const { doc, meta, kept } = keptNote(documentId, index);
    const next = kept.filter((i) => i !== index);
    db().prepare("UPDATE documents SET meta_json = ? WHERE id = ?").run(JSON.stringify({ ...meta, accepted_finding_indexes: next }), documentId);
    logDocumentChange({ accountId: doc.account_id, documentId, field: "accepted_findings", oldValue: `${kept.length} of ${meta.findings.length}`, newValue: `${next.length} of ${meta.findings.length} (finding ${index + 1} no longer true)`, actorUserId: userId });
  })();
}
