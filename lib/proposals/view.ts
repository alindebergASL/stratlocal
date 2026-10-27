import { displayOrigin } from "./origin";
import type { ProposalRow } from "../db";
import { entityLabels } from "../queries/labels";
import { reviewOrder } from "./order";
import { getDocument } from "../queries/accounts";
import { parseNote } from "../research/notes";

function reviewSource(p: ProposalRow): ProposalView["source_ref"] {
  const source = p.source_ref_json ? (JSON.parse(p.source_ref_json) as NonNullable<ProposalView["source_ref"]>) : null;
  if (!source) return null;
  const refs = [source, ...(source.refs ?? [])].filter((r) => r.kind === "research");
  if (!refs.length) return source;
  const legacy = refs.some((ref) => {
    const [id, position] = (ref.id ?? "").split("#");
    const doc = id ? getDocument(id) : null;
    const note = doc ? parseNote(doc) : null;
    if (!note || doc?.account_id !== p.account_id) return true;
    const index = ref.finding_index ?? (position === undefined ? undefined : Number(position));
    const findings = index === undefined ? note.meta.findings : [note.meta.findings[index]];
    return findings.some((f) => f?.evidence?.kind !== "source_excerpt");
  });
  return {
    ...source,
    verification: legacy ? "report_excerpt" : (source.verification ?? "source_excerpt"),
  };
}
import type { ProposalView } from "@/components/ProposalReview";

// One mapper. This object literal was written out three times — on the
// account page, the meeting page and the review page — and had already begun
// to drift in what it parsed out of source_ref_json.
export function toProposalViews(accountId: string, rows: ProposalRow[]): ProposalView[] {
  const labels = entityLabels(accountId);
  return reviewOrder(rows).map((p) => {
    const payload = JSON.parse(p.payload_json) as Record<string, unknown>;
    const before = p.before_json ? (JSON.parse(p.before_json) as Record<string, unknown>) : null;
    return {
    id: p.id,
    entity_type: p.entity_type,
    entity_id: p.entity_id,
    entity_label: p.entity_id ? (labels[p.entity_id] ?? null) : null,
    op: p.op,
    payload,
    before,
    rationale: p.rationale,
    source_ref: reviewSource(p),
    origin_kind: displayOrigin(p),
    names: namesFor(labels, payload, before),
    };
  });
}

// The names of every record a proposal links to, so a card says "EHR
// Refresh, Avery Example" instead of a deal number and a uuid. Only the ids
// this proposal mentions, so a card carries a handful of names and not the
// account's whole index.
function namesFor(labels: Record<string, string>, ...values: Array<Record<string, unknown> | null>): Record<string, string> {
  const out: Record<string, string> = {};
  const take = (v: unknown) => {
    if (typeof v === "string" && labels[v]) out[v] = labels[v];
  };
  for (const obj of values) {
    if (!obj) continue;
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v) && (k.endsWith("_ids") || k === "attendees")) v.forEach((x) => take(typeof x === "object" && x ? (x as { contact_id?: unknown }).contact_id : x));
      else if (k.endsWith("_id")) take(v);
    }
  }
  return out;
}

export const ORIGIN_LABEL: Record<string, string> = {
  import: "From an imported report",
  meeting: "From a meeting's notes",
  plan_draft: "From a drafted plan",
  ask: "From Ask",
  mail: "From an email",
  salesforce: "From Salesforce",
  playbook: "From the playbook",
  quarterly_refresh: "From the quarterly refresh",
};

// Proposals arrive in batches from different places, and accepting one batch
// is a different decision from accepting another. Grouping them is what makes
// a single "accept all" honest.
export function groupByBatch(rows: ProposalRow[]): Array<{
  batchId: string;
  origin: string;
  label: string;
  rows: ProposalRow[];
}> {
  const byBatch = new Map<string, ProposalRow[]>();
  for (const r of rows) byBatch.set(r.batch_id, [...(byBatch.get(r.batch_id) ?? []), r]);
  return [...byBatch.entries()]
    .map(([batchId, batch]) => ({
      batchId,
      origin: displayOrigin(batch[0]!),
      label: ORIGIN_LABEL[displayOrigin(batch[0]!)] ?? batch[0]!.origin_kind,
      rows: reviewOrder(batch),
    }))
    .sort((a, b) => (a.rows[0]?.created_at ?? 0) - (b.rows[0]?.created_at ?? 0));
}
