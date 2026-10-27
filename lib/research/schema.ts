// What a research run is allowed to produce.
//
// Individual finding fields stay bounded for downstream proposal validation.
// Finding counts and question length are not proposal-field constraints: the
// original report and review UI already retain them in full. The extraction
// response is bounded by runStructured's existing output-token/retry budgets;
// arbitrary presentation limits must not reject an otherwise valid dossier.
import { z } from "zod";

export const Confidence = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof Confidence>;

export const TOPICS = ["org", "leadership", "financial", "strategy", "technology", "procurement", "risk", "peers", "other"] as const;
export const Topic = z.enum(TOPICS);
export type Topic = z.infer<typeof Topic>;

export const TOPIC_LABELS: Record<Topic, string> = {
  org: "The organisation",
  leadership: "Leadership",
  financial: "Money",
  strategy: "Strategy",
  technology: "Technology",
  procurement: "Buying",
  risk: "Risk",
  peers: "Peers and competitors",
  other: "Other",
};

// z.url() accepts javascript: and data: — both are valid URLs and neither is
// a web page. These strings become hrefs, so the scheme is checked here as
// well as in urlKey.
const webUrl = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => /^https?:\/\//i.test(v), {
    message: "cite an http or https page URL",
  });

export const ResearchFinding = z
  .object({
    text: z.string().trim().min(1).max(600),
    // A sentence copied verbatim from your own prose, so the finding can be
    // traced back to what the search actually returned.
    quote: z.string().trim().min(8).max(600),
    url: webUrl,
    confidence: Confidence,
    // Publication date of the source, not today.
    date: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
      .nullable(),
    topic: Topic,
    // The search tool's own age for the page ("April 30, 2025", "3 days
    // ago"), when it gave one: the publication date as the index saw it, not
    // the model's reading of the text. Copied in code, never by the model.
    page_age: z.string().max(60).optional(),
    evidence: z
      .object({
        kind: z.enum(["source_excerpt", "report_excerpt"]),
        text: z.string(),
        location: z.string().optional(),
        url: z.string().optional(),
        citation: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
  })
  .strict();

export type ResearchFinding = z.infer<typeof ResearchFinding>;

// Our read of a finding, kept apart from the finding itself. The finding is
// what a source said; this is what the model made of it for us: whether it is
// a reason to act now, which of the team's focus areas it touches, and one
// line on why that matters. It is AI-written, labelled so wherever it is
// shown, and it never changes what the finding says (DECISIONS #58).
export const Signal = z.enum(["compelling_event", "trigger"]);
export type Signal = z.infer<typeof Signal>;
export const FindingRead = z.object({
  signal: Signal.nullable(),
  // Who owns a compelling event at the account, when the source names one.
  owner: z.string().trim().max(120).nullable().optional(),
  fits: z.array(z.string().trim().max(120)).max(4).default([]),
  so_what: z.string().trim().max(240).nullable().optional(),
});
export type FindingRead = z.infer<typeof FindingRead>;

const ReadFields = {
  signal: Signal.nullable().optional(),
  owner: z.string().trim().max(120).nullable().optional(),
  fits: z.array(z.string().trim().max(120)).max(4).optional(),
  so_what: z.string().trim().max(240).nullable().optional(),
};

// The organisation the research is about, as the run confirmed it. Its URL
// must be one a tool returned, or it is dropped.
export const ResearchEntity = z.object({
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().max(120).nullable().optional(),
  ticker: z.string().trim().max(20).nullable().optional(),
  parent: z.string().trim().max(200).nullable().optional(),
  hq: z.string().trim().max(200).nullable().optional(),
  url: z.string().max(1000).nullable().optional(),
});
export type ResearchEntity = z.infer<typeof ResearchEntity>;

// Who is likely to sign, block or shape a decision, as a hypothesis to test
// in discovery. Never a fact, and never shown as one.
export const BuyingRole = z.object({
  role: z.string().trim().min(1).max(120),
  likely: z.enum(["signer", "blocker", "influencer", "user", "unknown"]),
  basis: z.string().trim().max(300),
  question: z.string().trim().min(1).max(300),
});
export type BuyingRole = z.infer<typeof BuyingRole>;

export const ModelResearchFinding = ResearchFinding.omit({
  evidence: true,
  page_age: true,
}).extend({ source_quote: z.string().trim().min(8).max(600).optional(), ...ReadFields });

// An organisation like the account (a peer: another county, university or
// health system) or one it competes with, and what it is doing in public,
// tied to the finding that says so (by index). From public research only;
// never from our records (DECISIONS #90).
export const Peer = z.object({
  name: z.string().trim().min(1).max(160),
  kind: z.enum(["peer", "competitor"]),
  doing: z.string().trim().min(1).max(600),
  finding: z.number().int().min(0),
});
export type Peer = z.infer<typeof Peer>;

// A named person at the account, as public research found them, tied to the
// finding that names them (by index). Offered as a contact to accept, never
// written (DECISIONS #91).
export const ResearchPerson = z.object({
  name: z.string().trim().min(2).max(120),
  title: z.string().trim().max(200).nullable(),
  finding: z.number().int().min(0),
});
export type ResearchPerson = z.infer<typeof ResearchPerson>;

export const ResearchNote = z
  .object({
    title: z.string().trim().min(1).max(120),
    summary: z.string().trim().max(1200),
    findings: z.array(ResearchFinding),
    open_questions: z.array(z.string().trim().min(1)),
    // Keyed by the finding's index in `findings`.
    reads: z.record(z.string(), FindingRead).optional(),
    entity: ResearchEntity.nullable().optional(),
    buying_group: z.array(BuyingRole).max(8).optional(),
    // When the organisation's money is set, as the research found it, tied to
    // the finding that says so (by index). Asked for only when the team has a
    // playbook; it becomes a proposal, never a write (DECISIONS #84).
    budget: z
      .object({
        fiscal_year_start_month: z.number().int().min(1).max(12).nullable(),
        calendar: z.string().trim().max(600).nullable(),
        finding: z.number().int().min(0),
      })
      .nullable()
      .optional(),
    peers: z.array(Peer).max(8).optional(),
    // A few sentences on how organisations like this one are going about the
    // same things, from the peers above.
    peers_summary: z.string().trim().max(800).nullable().optional(),
    people: z.array(ResearchPerson).max(12).optional(),
  })
  .strict();

export type ResearchNote = z.infer<typeof ResearchNote>;
export const ModelResearchNote = ResearchNote.extend({
  findings: z.array(ModelResearchFinding),
});

// Tool-returned URLs need not fit an extracted finding's field limit.
// Preserve all of them, but only http(s) URLs can become links.
export const ResearchSource = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}, "expected an http or https source URL");

export const SourceEnvelope = z.object({
  url: z.string(),
  text: z.string(),
  location: z.string().optional(),
  citation: z.record(z.string(), z.unknown()).optional(),
});
export type SourceEnvelope = z.infer<typeof SourceEnvelope>;
export const ReportCapture = z.object({status:z.enum(["complete","partial"]),reasons:z.array(z.string())});
export const ResearchReport = z.object({
  text: z.string(),
  sources: z.array(ResearchSource).default([]),
  evidence: z.array(SourceEnvelope).optional(),
  capture: ReportCapture.optional(),
  // urlKey -> the search tool's page_age for that result.
  page_ages: z.record(z.string(), z.string()).optional(),
});
export type ResearchReport = z.infer<typeof ResearchReport>;

// What lands in documents.meta_json. `findings` is never rewritten after the
// note is stored: accepting records which ones were kept, so an over-eager
// untick is recoverable and the model's original answer survives.
//
// Kept findings are recorded by position, not by URL. Two findings can
// legitimately cite the same page — one article supporting two facts — and a
// URL cannot tell them apart: unticking one used to drop both, silently. The
// findings array is immutable once stored, so the index is stable.
export const ResearchMeta = z
  .object({
    title: z.string(),
    summary: z.string(),
    findings: z.array(ResearchFinding),
    open_questions: z.array(z.string()),
    focus: z.string().nullable(),
    depth: z.enum(["standard", "deep"]),
    generated_at: z.string(),
    searches: z.number().int().nonnegative().default(0),
    fetches: z.number().int().nonnegative().default(0),
    dropped: z.array(z.string()).default([]),
    sources: z.array(ResearchSource).default([]),
    report_evidence: z.array(SourceEnvelope).optional(),
    capture: ReportCapture.optional(),
    reads: z.record(z.string(), FindingRead).optional(),
    read_at: z.string().optional(),
    entity: ResearchEntity.nullable().optional(),
    buying_group: z.array(BuyingRole).optional(),
    peers: z.array(Peer).optional(),
    peers_summary: z.string().nullish(),
    people: z.array(ResearchPerson).optional(),
    // When a person last said a kept finding is still true, by its index.
    checked_at: z.record(z.string(), z.string()).optional(),
    accepted_finding_indexes: z.array(z.number().int().nonnegative()).nullish(),
    accepted_by: z.string().nullish(),
    accepted_at: z.string().nullish(),
    resolutions: z
      .array(
        z.object({
          obsolete_index: z.number().int().nonnegative(),
          supporting_ids: z.array(z.string()),
          reason: z.string(),
          actor: z.string(),
          at: z.string(),
        }),
      )
      .optional(),
  })
  .loose();

export type ResearchMeta = z.infer<typeof ResearchMeta>;

// The findings a note actually stands behind: everything before it is
// accepted, and the kept subset afterwards.
export function keptFindings(meta: ResearchMeta): ResearchFinding[] {
  const kept = meta.accepted_finding_indexes ?? meta.findings.map((_, i) => i);
  const set = new Set(kept);
  const retired = new Set((meta.resolutions ?? []).map((r) => r.obsolete_index));
  return meta.findings.filter((_, i) => set.has(i) && !retired.has(i));
}

/** Our read of one stored finding, if one was made. */
export function readOf(meta: { reads?: Record<string, FindingRead> }, index: number): FindingRead | undefined {
  return meta.reads?.[String(index)];
}
