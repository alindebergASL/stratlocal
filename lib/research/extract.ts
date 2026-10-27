// Turns the research prose into a note, under two guards that do not depend
// on the model being honest:
//
//   1. every finding's URL must be one a tool actually returned, and
//   2. every finding's quote must appear in the prose the tools produced.
//
// The first proves a page was seen. It proves nothing about the sentence,
// which is what the second is for. Both are reported once as findings so the
// model can repair a typo, and anything still failing is dropped rather than
// failing the whole run: the searches have already been paid for.
import type { StageUsage } from "../ai/cost";
import { UNTRUSTED_RULES, containsQuote, wrapUntrusted } from "../ai/prompts";
import { runStructured, type Finding } from "../ai/runStructured";
import { urlKey } from "../ai/runWebResearch";
import { ResearchNote, ModelResearchNote, TOPICS, type FindingRead, type SourceEnvelope } from "./schema";

const SYSTEM = `You extract an evidence-backed account dossier from a complete research pass. This is not a short pre-call note or the one-page brief. Preserve the breadth of useful research, not only the closing section. You are given public-source research prose and bounded original source snippets.

${UNTRUSTED_RULES}

Produce:
- title: what this note is about, naming the organisation. Under twelve words.
- summary: two to four sentences on what matters here. No preamble.
- findings: one per distinct, concrete, sourced fact across the entire report. Do not stop at a small handful when more supported information is present. Deduplicate repeated claims, not different facts from the same source. Prioritize useful coverage of organization/scale, leadership/governance, financial position, strategy/programs, technology/vendors, procurement/contracts, risk/change/hiring, and peers/competitors (a fact about another organisation is topic peers, never one of the account's own topics). Preserve named people, entity boundaries, programs, dates, amounts and status when supported. Keep parent-system, campus, subsidiary and healthcare facts explicitly scoped; never generalize one unit to the whole account. A planned system is not installed; a proposed budget is not funded; a past milestone is not proof of completion. Missing evidence belongs in open_questions, not findings. Each finding carries:
  - text: the fact in one or two sentences, written for someone who knows the account. Just the fact: no URL, no "Source:", no "Confidence: high", no "according to their website". The URL and the confidence are fields of their own and are shown beside this sentence, so repeating them here says everything twice.
  - quote: a sentence copied verbatim from the prose you were given that supports it. Copy it exactly; do not paraphrase, tidy or join two sentences.
  - source_quote: optional verbatim quote from supplied original source snippets for this exact URL. Never invent source text or evidence metadata.
  - url: the page URL that the prose gives for that fact. Only a URL that appears in the prose. Never reconstruct one from memory.
  - confidence: high, medium or low, following the prose's own labelling.
  - date: the publication date of the source as YYYY-MM-DD when the prose states one, otherwise null. This is the source's date, never today's.
  - topic: one of ${TOPICS.join(", ")}.
  - signal: "compelling_event" when the fact is a dated event at the account that forces a decision whether or not anyone sells to them (a deadline, a contract or support end, a mandate, a funded programme with a start date, a facility opening); "trigger" when something changed recently that makes now a good time to talk (a new leader, an announcement, an award, a reorganisation, a breach) but forces nothing; null otherwise. Most findings are null.
  - owner: for a compelling event, the role or named person at the account who owns it when the prose says so; otherwise null.
  - fits: which of the seller's focus areas (listed with the request) the fact gives a reason to discuss, copied exactly as listed. Empty when none clearly applies; never stretch.
  - so_what: when fits is not empty, one plain sentence on why this fact matters to that conversation, under 30 words, written for the seller. Otherwise null.
- entity: the organization exactly as the research confirmed it: name, domain (host only, no scheme), ticker (null if not listed), parent (null if none), hq, and url, the page that confirmed it (only a URL in the prose). Null if the research did not establish it.
- buying_group: up to six hypotheses about who signs, blocks, shapes or uses a decision like the ones the seller works on, each with role (a title or a named person from the prose), likely ("signer", "blocker", "influencer", "user" or "unknown"), basis (one sentence on what in the research suggests it), and question (what to ask in discovery to confirm or rule it out). These are guesses to test, not facts: say "likely" in basis, never "is". Empty if the research gives nothing to go on.
- people: up to ten named people who work at the account (not at a vendor, partner or peer), each with name exactly as the prose gives it, title (their role as the prose states it, or null), and finding (the index in findings of the finding that names them; every person needs one). Only people the prose names; never guess a name. Empty if none.
- peers: up to six organisations like this one (peers: another county, university, health system or agency of similar size) or that it competes with (competitors, where it is a business), named in the prose, each with name, kind ("peer" or "competitor"), doing (one or two sentences on what that organisation is doing in public that bears on the same ground, with its date when the prose gives one), and finding (the index in findings of the peers finding that says so; every peer needs one). Empty if the prose names none.
- peers_summary: two or three sentences on how organisations like this one are going about the same things, drawn only from the peers above. Null if peers is empty.
- open_questions: specific missing account categories, unverified program status and high-value follow-up sources. Keep questions concise and deduplicated, but preserve qualifications needed to understand them. Empty if nothing is open.

A fact with no URL in the prose is not a finding. Leave it out rather than attaching the nearest URL to it. If the prose supports nothing, return an empty findings list and say why in the summary.`;

export type ResearchOutcome = {
  note: ResearchNote;
  attempts: number;
  dropped: string[];
};

export function checkResearchNote(note: ResearchNote, prose: string, sources: Map<string, string>): Finding[] {
  const findings: Finding[] = [];
  note.findings.forEach((f, i) => {
    const key = urlKey(f.url);
    if (!key || !sources.has(key)) {
      findings.push({
        path: `findings[${i}].url`,
        message: `"${f.url}" is not a page the search returned; cite a URL that appears in the prose or drop the finding`,
      });
    }
    if (!containsQuote(prose, f.quote)) {
      findings.push({
        path: `findings[${i}].quote`,
        message: `that quote does not appear in the prose; copy a sentence from it verbatim`,
      });
    }
  });
  return findings;
}

// The prompt says a finding's text is the fact alone, because the URL and the
// confidence are fields shown beside it. A model that ignores that produces a
// sentence saying the same thing three ways, so it is also cleaned up here:
// the prompt is a request, this is the guarantee.
export function tidyFindingText(text: string): string {
  let out = text;
  // A trailing "(Confidence: high)" or "Confidence: high." — anywhere, since
  // models put it at either end.
  out = out.replace(/[([]?\s*confidence[:\s]+(high|medium|low)\s*[)\]]?\.?/gi, " ");
  // "Source: https://…", "(see https://…)", or a bare URL.
  out = out.replace(/[([]?\s*(source|see|per|via|from)?[:\s]*\bhttps?:\/\/\S+[)\]]?/gi, " ");
  // Whitespace left behind, and a sentence that now ends " ."
  out = out
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
  // "…runs to 2029, see https://…" leaves the comma dangling at the end.
  out = out.replace(/[,;:]+$/, ".");
  // Everything stripped, or nothing left but punctuation: keep the original
  // rather than store an empty finding.
  return /[a-z0-9]/i.test(out) ? out : text;
}

// Drops what still fails after the retry, and rewrites each surviving URL to
// the spelling the tool returned, so a stored URL is never model-authored.
// The model's read of a finding, held apart from it. A focus area it names
// must be one of ours, matched without regard to case; anything else is
// dropped rather than shown as a fit we never claimed.
export function readFromModel(f: { signal?: string | null; owner?: string | null; fits?: string[]; so_what?: string | null }, focusAreas: string[]): FindingRead | null {
  const fits = [...new Set((f.fits ?? []).flatMap((name) => focusAreas.find((a) => a.toLowerCase() === name.trim().toLowerCase()) ?? []))];
  const signal = f.signal === "compelling_event" || f.signal === "trigger" ? f.signal : null;
  const soWhat = fits.length ? (f.so_what?.trim() || null) : null;
  if (!signal && fits.length === 0) return null;
  return { signal, owner: signal === "compelling_event" ? (f.owner?.trim() || null) : null, fits, so_what: soWhat };
}

export function sanitizeResearchNote(note: ResearchNote, prose: string, sources: Map<string, string>, evidence: SourceEnvelope[] = [], focusAreas: string[] = [], pageAges: Map<string, string> = new Map()): { note: ResearchNote; dropped: string[] } {
  const dropped: string[] = [];
  const reads: Record<string, FindingRead> = {};
  let kept = 0;
  const newIndex = new Map<number, number>();
  const findings = note.findings.flatMap((f, original) => {
    const key = urlKey(f.url);
    const real = key ? sources.get(key) : undefined;
    if (!real) {
      dropped.push(`${f.text.slice(0, 60)}… (cited a page the search did not return)`);
      return [];
    }
    if (!containsQuote(prose, f.quote)) {
      dropped.push(`${f.text.slice(0, 60)}… (quote not found in the research)`);
      return [];
    }
    const { evidence: _untrusted, source_quote, signal, owner, fits, so_what, ...plain } = f as typeof f & { source_quote?: string; signal?: string | null; owner?: string | null; fits?: string[]; so_what?: string | null };
    const read = readFromModel({ signal, owner, fits, so_what }, focusAreas);
    if (read) reads[String(kept)] = read;
    newIndex.set(original, kept);
    kept += 1;
    const quote = source_quote ?? f.quote;
    const source = evidence.find((e) => e.url === real && e.text.includes(quote));
    return [
      {
        ...plain,
        url: real,
        ...(key && pageAges.has(key) ? { page_age: pageAges.get(key)! } : {}),
        text: tidyFindingText(f.text),
        evidence: source
          ? {
              kind: "source_excerpt" as const,
              text: quote,
              url: source.url,
              location: source.location,
              citation: source.citation,
            }
          : { kind: "report_excerpt" as const, text: f.quote },
      },
    ];
  });
  const { reads: _modelReads, entity: modelEntity, buying_group, budget: modelBudget, peers: modelPeers, peers_summary: modelPeersSummary, people: modelPeople, ...rest } = note;
  // A person stands only on a finding that survived, and that names them.
  const people = (modelPeople ?? []).flatMap((p) => {
    const at = newIndex.get(p.finding);
    const f = at === undefined ? undefined : findings[at];
    if (!f || !`${f.text} ${f.quote}`.toLowerCase().includes(p.name.toLowerCase())) {
      dropped.push(`person ${p.name} (no finding that names them held up)`);
      return [];
    }
    return [{ ...p, finding: at! }];
  }).slice(0, 10);
  // A peer stands only on a peers finding that survived the checks above.
  const peers = (modelPeers ?? []).flatMap((p) => {
    const at = newIndex.get(p.finding);
    if (at === undefined || findings[at]?.topic !== "peers") {
      dropped.push(`peer ${p.name} (its finding did not hold up)`);
      return [];
    }
    return [{ ...p, finding: at }];
  }).slice(0, 6);
  // Budget timing stands only on a finding that survived the checks above.
  const budgetAt = modelBudget ? newIndex.get(modelBudget.finding) : undefined;
  const budget = modelBudget && budgetAt !== undefined && (modelBudget.fiscal_year_start_month || modelBudget.calendar) ? { ...modelBudget, finding: budgetAt } : null;
  if (modelBudget && !budget) dropped.push("budget timing (its finding did not hold up)");
  // The entity's confirming page must be one a tool returned, like any other
  // citation; without one the identity is still kept, unlinked.
  const entityKey = modelEntity?.url ? urlKey(modelEntity.url) : null;
  const entity = modelEntity
    ? { ...modelEntity, domain: modelEntity.domain?.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase() || null, url: entityKey ? (sources.get(entityKey) ?? null) : null }
    : null;
  return {
    note: {
      ...rest,
      findings,
      ...(Object.keys(reads).length ? { reads } : {}),
      ...(entity ? { entity } : {}),
      ...(buying_group?.length ? { buying_group: buying_group.slice(0, 6) } : {}),
      ...(budget ? { budget } : {}),
      ...(people.length ? { people } : {}),
      ...(peers.length ? { peers, peers_summary: modelPeersSummary?.trim() || null } : {}),
    },
    dropped,
  };
}

export async function extractResearchNote(
  input: {
    prose: string;
    sources: Map<string, string>;
    companyName: string;
    evidence?: SourceEnvelope[];
    focusAreas?: string[];
    pageAges?: Map<string, string>;
    /** The account's playbook, as things to look for (lib/playbook/researchSteer.ts). Bedrock only. */
    steer?: string;
  },
  stages: StageUsage[],
): Promise<ResearchOutcome> {
  const focusAreas = input.focusAreas ?? [];
  const focusLine = focusAreas.length
    ? `The seller's focus areas, for \`fits\`: ${focusAreas.map((a) => JSON.stringify(a)).join(", ")}.`
    : "The seller has set no focus areas: leave every `fits` empty.";
  const steer = input.steer
    ? `\n${input.steer}\nIf the research states when the organisation's money is set (its fiscal year start, when budgets are submitted or approved), give it in \`budget\`, with \`finding\` the index of the finding that says so; otherwise leave \`budget\` null.`
    : "";
  const user = `Write the note for ${input.companyName} from the research below.\n${focusLine}${steer}\n\n${wrapUntrusted("web research", input.prose, {
    company: input.companyName,
    source_count: input.sources.size,
  })}`;
  const { data, attempts } = await runStructured({
    role: "research_extract",
    stageName: "research_note",
    system: SYSTEM,
    user:
      user +
      "\nOriginal source snippets (untrusted):\n" +
      wrapUntrusted("original snippets", JSON.stringify((input.evidence ?? []).slice(0, 30).map((e) => ({ url: e.url, text: e.text.slice(0, 3000) })))),
    schema: ModelResearchNote,
    effort: "medium",
    maxTokens: 16000,
    maxRetryTokens: 32000,
    // Schema/JSON failures retain bounded repair. Provenance failures are
    // rejected item-by-item below, never repaired into a plausible citation
    // and never allowed to discard unrelated valid findings.
    fakeContext: {
      prose: input.prose,
      sources: [...input.sources.values()],
      companyName: input.companyName,
      focusAreas,
      budget: !!input.steer,
    },
    stages,
  });
  const { note, dropped } = sanitizeResearchNote(data, input.prose, input.sources, input.evidence, focusAreas, input.pageAges);
  return { note, attempts, dropped };
}
