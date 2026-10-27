import { TOPICS, type ResearchMeta, type ResearchFinding, readOf, type FindingRead } from "./schema";
import { todayISO } from "../clock";

export type SelectedEvidence = {
  id: string;
  noteId: string;
  index: number;
  finding: ResearchFinding;
  asOf: string;
  scope: string;
  /** The model's earlier read of it: reason to act, fit, so what. */
  read?: FindingRead;
};
export function selectEvidence(notes: Array<{ doc: { id: string }; meta: ResearchMeta }>, focus = "", limit = 24) {
  const all: SelectedEvidence[] = [];
  for (const n of notes) {
    const kept = new Set(n.meta.accepted_finding_indexes ?? n.meta.findings.map((_, i) => i));
    const retired = new Set((n.meta.resolutions ?? []).map((r) => r.obsolete_index));
    n.meta.findings.forEach((finding, index) => {
      if (kept.has(index) && !retired.has(index))
        all.push({
          id: `${n.doc.id}#${index}`,
          noteId: n.doc.id,
          index,
          finding,
          asOf: n.meta.generated_at,
          scope: n.meta.focus ?? "General public-source research",
          read: readOf(n.meta, index),
        });
    });
  }
  const terms = focus.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  const preferred = /people|leadership|cio|person/i.test(focus)
    ? ["leadership", "technology"]
    : /tech|cloud|infrastructure/i.test(focus)
      ? ["technology", "leadership", "procurement"]
      : [];
  // A reason to act, and a fit with what the team sells, are what a brief
  // or a plan most needs, so they rank above a plain finding of the same topic.
  const readWeight = (e: SelectedEvidence) => (e.read?.signal === "compelling_event" ? 4 : e.read?.signal === "trigger" ? 2 : 0) + (e.read?.fits.length ? 2 : 0);
  const score = (e: SelectedEvidence) => terms.reduce((s, t) => s + (e.finding.text.toLowerCase().includes(t) ? 2 : 0), (preferred.includes(e.finding.topic) ? 3 : 0) + readWeight(e));
  const seen = new Set<string>();
  const unique = all.filter((e) => {
    const key = e.finding.text.trim().replace(/\s+/g, " ").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const ranked = unique.sort((a, b) => score(b) - score(a));
  const included: SelectedEvidence[] = [];
  // One strongest result per topic, then fill with focused results. Never collapse
  // distinct statements just because they share a URL (they may conflict).
  const order = [...new Set([...preferred, ...TOPICS])];
  for (const topic of order) {
    const e = ranked.find((e) => e.finding.topic === topic);
    if (e && included.length < limit) included.push(e);
  }
  for (const e of ranked) if (included.length < limit && !included.includes(e)) included.push(e);
  return { included, omitted: all.length - included.length, total: all.length };
}
/**
 * The one saved excerpt a finding is checked against, and what kind it is.
 *
 * Three surfaces used to disagree about this. The model was shown `text` and
 * `quote`; the presence check searched `text` + `quote` joined; the
 * name–title association check used the source excerpt when there was one and
 * the joined pair otherwise. So an AI paraphrase could supply a job title the
 * source never carried and pass the presence check on its own wording, while a
 * source excerpt that did carry the title could fail it because the paraphrase
 * did not repeat it.
 *
 * One canonical excerpt instead, used by the extraction input and by every
 * deterministic check: the original-source excerpt when the note has one —
 * which is the authoritative text and is not unioned with the model's prose —
 * and the report excerpt otherwise, which stays explicitly unverified
 * everywhere it is shown.
 */
export function canonicalEvidence(finding: ResearchFinding): { text: string; kind: "source_excerpt" | "report_excerpt" } {
  if (finding.evidence?.kind === "source_excerpt") return { text: finding.evidence.text, kind: "source_excerpt" };
  return { text: finding.evidence?.text ?? finding.quote, kind: "report_excerpt" };
}

export function evidenceText(e: SelectedEvidence) {
  const unknown = /\b(not found|unknown|nothing public|no published|no public)\b/i.test(e.finding.text);
  const past = /\b(target|planned|proposed|by|through)\b/i.test(e.finding.text) && [...e.finding.text.matchAll(/\b(20\d{2})\b/g)].some((m) => m[1]! < todayISO().slice(0, 4));
  return `${unknown ? `Not found in this research (${e.scope}; as of ${e.asOf}): ` : ""}${e.finding.text}${past ? " [Past target; completion not established.]" : ""}`;
}
