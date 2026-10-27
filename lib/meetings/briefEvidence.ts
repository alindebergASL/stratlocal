// What a brief's citation resolves to *now*, on the account the brief belongs
// to.
//
// A brief is stored JSON: it was true about the records at the moment it was
// written, and the records move. A finding can be unticked, a note retracted,
// a deal archived, and the id in the brief stays exactly as it was. So nothing
// here trusts the stored ref — it is matched against current account records,
// and anything that does not match is shown as unavailable rather than
// silently dropped or, worse, linked to whatever now holds that id.
//
// Three failures are separated on purpose, because they mean different things
// to a person about to say the sentence out loud: the record is gone, the
// record is of a different kind than the brief claimed, or the research
// finding behind it is no longer retained.
import { listCustomerDocs } from "../documents/customer";
import type { EvidenceEntry, EvidenceKind } from "./contextPack";
import { keptFindings, loadAcceptedResearch } from "../research/notes";
import type { SelectedEvidence } from "../research/evidence";
import { getAccount, listContacts, listDeals, listPlays } from "../queries/accounts";
import { listActionItems, listMeetings } from "../queries/meetings";
import { accountMail } from "../mail/sync";
import { findingHref } from "../research/anchor";
import { briefRefs } from "./briefView";
import type { MeetingBrief } from "./briefSchema";

export type RefStatus = "current" | "missing" | "kind_mismatch";

export type ResolvedRef = {
  /** The ref as the brief wrote it. */
  requested: { kind: string; id: string };
  status: RefStatus;
  label: string;
  /** Where to read it. Null whenever the ref did not resolve cleanly. */
  href: string | null;
  /** The date the evidence carries, when the record has one. */
  asOf: string | null;
  /** Said in full next to the citation when it is not usable. */
  reason: string | null;
  /** Research only: whether the excerpt behind it is source-bound. */
  verification: "source_excerpt" | "report_excerpt" | null;
};

export type BriefRefMap = Map<string, ResolvedRef>;

/** Refs are keyed by kind *and* id: the same id claimed as two kinds is two different claims. */
export function refKey(ref: { kind: string; id: string }): string {
  return `${ref.kind}:${ref.id}`;
}

function hrefFor(accountId: string, kind: EvidenceKind, id: string): string | null {
  switch (kind) {
    case "deal":
      return `/accounts/${accountId}/deals/${encodeURIComponent(id)}`;
    case "play":
      return `/accounts/${accountId}/plays/${id}`;
    case "contact":
      return `/accounts/${accountId}/contacts/${id}`;
    case "action_item":
      return `/follow-ups/${id}`;
    case "meeting":
      return `/accounts/${accountId}/meetings/${id}`;
    case "account":
      return `/accounts/${accountId}`;
    case "document":
      return `/accounts/${accountId}/documents/${id}`;
    case "email":
      return `/accounts/${accountId}/email#mail-${id}`;
    // Research is handled by the caller: its href is the exact finding, not
    // the note, and it needs the selection to know whether it is still kept.
    case "research":
      return null;
  }
}

export type ResolverOptions = { excludeMeetingId?: string };

/**
 * A resolver bound to one account, so a ref naming a record on another account
 * fails closed: it is simply not in this index, and comes back missing.
 */
export function briefEvidenceResolver(accountId: string, opts: ResolverOptions = {}) {
  // Display/acceptance is not model selection: no cap, text deduplication,
  // summary requirement, or open-action filter can prove a record missing.
  const index = new Map<string, EvidenceEntry>();
  const meetingDates = new Map<string, string>();
  const documentDates = new Map<string, string>();
  const mailDates = new Map<string, string>();
  const research = new Map<string, SelectedEvidence>();
  const account = getAccount(accountId);
  if (account && !account.archived_at) {
    index.set(account.id, { kind: "account", label: account.name });
    for (const d of listDeals(accountId)) index.set(d.deal_id, { kind: "deal", label: d.name });
    for (const p of listPlays(accountId)) index.set(p.id, { kind: "play", label: p.title });
    for (const c of listContacts(accountId)) index.set(c.id, { kind: "contact", label: c.name });
    for (const a of listActionItems(accountId)) index.set(a.id, { kind: "action_item", label: a.text.slice(0, 60) });
    for (const m of listMeetings(accountId)) {
      if (m.merged_into || m.id === opts.excludeMeetingId) continue;
      index.set(m.id, { kind: "meeting", label: `${m.title} (${m.held_at})` });
      meetingDates.set(m.id, m.held_at);
    }
    for (const d of listCustomerDocs(accountId)) {
      index.set(d.id, { kind: "document", label: d.filename });
      documentDates.set(d.id, new Date(d.created_at).toISOString().slice(0, 10));
    }
    // A purged body keeps its subject and date, so a citation still resolves.
    for (const m of accountMail(accountId, 200)) {
      index.set(m.id, { kind: "email", label: `Email · ${m.subject.slice(0, 80)}` });
      mailDates.set(m.id, new Date(m.received_at).toISOString().slice(0, 10));
    }
    for (const { doc, meta } of loadAcceptedResearch(accountId)) {
      const retained = new Set(keptFindings(meta));
      meta.findings.forEach((finding, position) => {
        if (!retained.has(finding)) return;
        const id = `${doc.id}#${position}`;
        research.set(id, { id, noteId: doc.id, index: position, finding, asOf: meta.generated_at, scope: meta.focus ?? "General public-source research" });
        index.set(id, { kind: "research", label: `Retained ${finding.topic} finding` });
      });
    }
  }

  function resolve(ref: { kind: string; id: string }): ResolvedRef {
    const base = { requested: { kind: ref.kind, id: ref.id }, verification: null, asOf: null } as const;
    const entry = index.get(ref.id);
    if (!entry) {
      return {
        ...base,
        status: "missing",
        label: ref.id,
        href: null,
        reason: "evidence unavailable: not among this account's current records — archived, retracted, or never on this account",
      };
    }
    if (entry.kind !== ref.kind) {
      return {
        ...base,
        status: "kind_mismatch",
        label: entry.label,
        href: null,
        reason: `evidence unavailable: cited as a ${ref.kind.replace(/_/g, " ")}, but that id is a ${entry.kind.replace(/_/g, " ")} on this account`,
      };
    }
    if (entry.kind === "research") {
      const found = research.get(ref.id);
      const [noteId, position] = ref.id.split("#");
      if (!found || !noteId || position === undefined) {
        return {
          ...base,
          status: "missing",
          label: entry.label,
          href: null,
          reason: "evidence unavailable: that research finding is no longer retained",
        };
      }
      return {
        requested: base.requested,
        status: "current",
        label: entry.label,
        href: findingHref(accountId, noteId, found.index),
        // The finding's own date when the source carried one, and the date the
        // research was run otherwise. Both are real dates about the evidence;
        // neither is today.
        asOf: found.finding.date ?? found.asOf,
        reason: null,
        verification: found.finding.evidence?.kind === "source_excerpt" ? "source_excerpt" : "report_excerpt",
      };
    }
    return {
      requested: base.requested,
      status: "current",
      label: entry.label,
      href: hrefFor(accountId, entry.kind, ref.id),
      asOf: entry.kind === "meeting" ? (meetingDates.get(ref.id) ?? null) : entry.kind === "document" ? (documentDates.get(ref.id) ?? null) : entry.kind === "email" ? (mailDates.get(ref.id) ?? null) : null,
      reason: null,
      verification: null,
    };
  }

  return {
    /** The live kind of an id, or null when this account has no such record. */
    kindOf(id: string): EvidenceKind | null {
      return index.get(id)?.kind ?? null;
    },
    resolve,
    resolveAll(refs: Array<{ kind: string; id: string }>): BriefRefMap {
      const map: BriefRefMap = new Map();
      for (const ref of refs) if (!map.has(refKey(ref))) map.set(refKey(ref), resolve(ref));
      return map;
    },
  };
}

export type BriefEvidenceResolver = ReturnType<typeof briefEvidenceResolver>;

// Next-step references are stored as ids, unlike the typed body references.
// Resolve both here so the visible inventory and the action use the same set.
export function resolveBriefEvidence(brief: MeetingBrief, resolver: BriefEvidenceResolver) {
  const map = resolver.resolveAll(briefRefs(brief));
  const nextStepEvidence = brief.proposed_next_step.evidence_ids.map((id) =>
    resolver.resolve({ kind: resolver.kindOf(id) ?? "unknown", id }),
  );
  for (const entry of nextStepEvidence) map.set(refKey(entry.requested), entry);
  return { map, nextStepEvidence };
}
