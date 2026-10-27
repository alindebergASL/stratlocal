// Saved evidence -> pending proposals only. No web tools or record mutations.
import { z } from "zod";
import { explicitCurrentRole } from "./people";
import { db } from "../db";
import { BudgetError, startRun, runDetached } from "../ai/guard";
import { runStructured } from "../ai/runStructured";
import { UNTRUSTED_RULES, wrapUntrusted } from "../ai/prompts";
import { getAccount, listContacts } from "../queries/accounts";
import { createProposalBatch } from "../proposals/apply";
import type { ProposalDraft, SourceRef } from "../proposals/schema";
import { researchSelection } from "./notes";
import { canonicalEvidence, type SelectedEvidence } from "./evidence";

export const SuggestedUpdates = z
  .object({
    updates: z
      .array(
        z.discriminatedUnion("type", [
          z
            .object({
              type: z.literal("contact"),
              name: z.string().trim().min(2).max(200),
              title: z.string().trim().min(2).max(200),
              evidence_id: z.string(),
            })
            .strict(),
          z
            .object({
              type: z.literal("account"),
              field: z.enum(["legal_entity", "hq", "region", "segment"]),
              value: z.string().min(1).max(300),
              evidence_id: z.string(),
            })
            .strict(),
          z
            .object({
              type: z.literal("follow_up"),
              text: z.string().min(1).max(1000),
              evidence_id: z.string(),
            })
            .strict(),
        ]),
      )
      .max(12),
  })
  .strict();
export type SuggestedUpdates = z.infer<typeof SuggestedUpdates>;
type Suggestion = SuggestedUpdates["updates"][number];

// One suggestion the evidence does not support, kept as a result instead of
// being thrown away with its eleven valid siblings.
//
// This is the whole shape of the fix: the grounding rules are unchanged — a
// name, a title or an account value that is not literally in the retained
// evidence still never becomes a record — but refusing one suggestion used to
// abort the batch, so a person saw "Name and title must be explicit in saved
// evidence" and no suggestions at all, with nothing saying which of them the
// sentence was about. A withheld suggestion says what was proposed, which
// evidence it cited, why it was refused and what to do next.
export class WithheldSuggestionError extends Error {
  constructor(
    message: string,
    readonly next: string,
  ) {
    super(message);
    this.name = "WithheldSuggestionError";
  }
}
export type WithheldSuggestion = {
  what: string;
  reason: string;
  next: string;
  evidenceId: string;
  noteId: string | null;
  findingIndex: number | null;
  url: string | null;
};
export type UpdatesResult = {
  batchId: string;
  proposals: number;
  /** How many suggestions the model returned at all. */
  suggestions: number;
  /** Suggestions that were supported but changed nothing on file. */
  unchanged: number;
  withheld: WithheldSuggestion[];
  included: number;
  omitted: number;
};

const FIELD_LABEL: Record<string, string> = {
  legal_entity: "Legal entity",
  hq: "Headquarters",
  region: "Region",
  segment: "Segment",
};

/** What a suggestion was, said in one line, so a withheld one is identifiable. */
export function suggestionLabel(u: Suggestion): string {
  if (u.type === "contact") return `Person · ${u.name} — ${u.title}`;
  if (u.type === "account") return `Account fact · ${FIELD_LABEL[u.field] ?? u.field} → ${u.value}`;
  return `Follow-up · ${u.text.slice(0, 120)}`;
}

const norm = (s: string) => s.trim().toLowerCase();

// Does the evidence actually say this? A plain substring test answered yes to
// "US" inside "business" and to "Ann" inside "Joanna", so a short value could
// ground itself on a word that merely contains it. Now the value has to stand
// as whole words in the excerpt. A hyphen joins a word rather than ending
// one, so "Mary Smith" is not stated by "Mary Smith-Jones" and "Jean" is not
// stated by "Jean-Luc". A short value in capitals is an acronym and is
// matched as written, so "IT" is not stated by "it is" nor "US" by "contact
// us". A single character is a word somewhere in almost any sentence, so a
// value needs two characters and at least one letter or digit — which still
// lets "C#" and "C++" through.
export function statedIn(evidence: string, value: string): boolean {
  const raw = value.trim().replace(/\s+/g, " ");
  if (raw.length < 2 || !/[\p{L}\p{N}]/u.test(raw)) return false;
  const letters = raw.replace(/[^\p{L}]/gu, "");
  const acronym = letters.length > 0 && letters.length <= 5 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
  const want = acronym ? raw : norm(raw);
  const text = (acronym ? evidence : norm(evidence)).replace(/\s+/g, " ");
  const escaped = want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}-])${escaped}(?![\\p{L}\\p{N}-])`, "u").test(text);
}

// The whole batch still fails on the things that mean the run itself cannot be
// trusted — an archived account, an evidence id nobody supplied, a response
// that will not parse, evidence that moved while the model was reading it.
// Only a suggestion the retained evidence does not support is isolated.
type UpdateContext = {
  accountId: string;
  account: NonNullable<ReturnType<typeof getAccount>>;
  contacts: ReturnType<typeof listContacts>;
  evidence: SelectedEvidence[];
  seen: Set<string>;
};

function draftsForSuggestion(ctx: UpdateContext, u: Suggestion): ProposalDraft[] {
  const { accountId, account, contacts, seen } = ctx;
  {
    const e = ctx.evidence.find((e) => e.id === u.evidence_id);
    if (!e) throw new Error("Unknown evidence id");
    // The one excerpt the model was shown for this finding, and the one every
    // check below reads. Source excerpts are authoritative when the note has
    // one: the model's own paraphrase is not unioned into them, so prose that
    // invents a title the source never carried cannot supply its own proof.
    const canonical = canonicalEvidence(e.finding);
    const ref: SourceRef = {
      kind: "research",
      id: e.noteId,
      finding_index: e.index,
      url: e.finding.url,
      quote: canonical.text.slice(0, 1000),
      origin: "ai_generated",
      verification: canonical.kind,
      refs: [{ kind: "research", id: e.noteId, finding_index: e.index }],
    };
    let draft: ProposalDraft;
    if (u.type === "contact") {
      // Extraction, not inference: name and job title must occur in saved evidence.
      if (!statedIn(canonical.text, u.name) || !statedIn(canonical.text, u.title))
        throw new WithheldSuggestionError(
          "Name and title must be explicit in saved evidence",
          "Open the cited finding. If the person is really named there, keep the wording it uses; otherwise add the person by hand on People.",
        );
      if (!explicitCurrentRole(canonical.text, u.name, u.title))
        return [
          {
            entity_type: "action_item" as const,
            op: "create" as const,
            payload: {
              text: `Internal discovery: confirm the current role of ${u.name}. The retained evidence does not establish this name–title association. ${e.finding.text}`,
              owner: null,
              due: null,
              status: "open",
            },
            source_ref: ref,
            rationale: "Ambiguous or historical role; not a factual People update.",
          },
        ];
      const matches = contacts.filter((c) => norm(c.name) === norm(u.name));
      if (matches.length > 1)
        // Not "merge them": two records sharing a name are very often two
        // people, and a routine instruction to merge is an instruction to
        // destroy one of them. The collision itself stays fatal to the
        // suggestion — nothing is guessed at and nothing is written.
        throw new WithheldSuggestionError(
          `Ambiguous name: ${u.name}`,
          "Two people on this account carry that name. Open People and compare the two records: merge them only if they are confirmed to be the same person, and otherwise edit the right one by hand.",
        );
      const match = matches[0];
      if (match?.archived_at)
        throw new WithheldSuggestionError("Matching contact is archived; restore and review first", "Restore the archived person from the account's Archived block first.");
      if (match && norm(match.title ?? "") === norm(u.title)) return [];
      draft = {
        entity_type: "contact",
        op: match ? "update" : "create",
        entity_id: match?.id,
        payload: match ? { title: u.title } : { name: u.name, title: u.title, org: "customer" },
      };
    } else if (u.type === "account") {
      if (!statedIn(canonical.text, u.value))
        throw new WithheldSuggestionError(
          "Account value must be explicit in saved evidence",
          "Open the cited finding and compare the wording. Edit the account by hand if the source really says this.",
        );
      if (norm(account[u.field] ?? "") === norm(u.value)) return [];
      draft = {
        entity_type: "account",
        op: "update",
        entity_id: accountId,
        payload: { [u.field]: u.value },
      };
    } else {
      draft = {
        entity_type: "action_item",
        op: "create",
        payload: {
          text: `Internal discovery — public ${ref.verification === "report_excerpt" ? "unverified report" : "source-bound"}: ${u.text}`,
          owner: null,
          due: null,
          status: "open",
        },
      };
    }
    const key = JSON.stringify([draft.entity_type, draft.entity_id, draft.payload]);
    if (seen.has(key)) return [];
    seen.add(key);
    return [
      {
        ...draft,
        source_ref: ref,
        rationale: "AI-suggested from retained public evidence. Not customer confirmation. Technology initiatives are follow-ups, not confirmed installations.",
      },
    ];
  }
}

function contextFor(accountId: string, evidence: SelectedEvidence[]): UpdateContext {
  const account = getAccount(accountId);
  if (!account || account.archived_at) throw new BudgetError("Account missing or archived");
  return { accountId, account, contacts: listContacts(accountId, { includeArchived: true }), evidence, seen: new Set<string>() };
}

// The strict helper, unchanged in contract: anything the evidence does not
// support throws, and nothing partial comes back. Callers that want the whole
// batch or nothing keep using this.
export function updatesToDrafts(accountId: string, data: SuggestedUpdates, evidence: SelectedEvidence[]): ProposalDraft[] {
  data = SuggestedUpdates.parse(data);
  const ctx = contextFor(accountId, evidence);
  return data.updates.flatMap((u) => draftsForSuggestion(ctx, u));
}

// The same guards, one suggestion at a time. A refusal becomes a withheld
// result carrying the suggestion's identity and its evidence; its valid
// siblings still become pending proposals. Nothing here writes.
// Suggestions every one of whose drafts the batch declined — already proposed
// or already refused, so nothing new to review. Counted in suggestions, the
// unit the rest of the sentence on screen uses: this used to add the number
// of declined *drafts* to a count of *suggestions*, and one suggestion can
// make more than one draft.
export function declinedSuggestions(owners: number[], kept: number[]): number {
  const keptOwners = new Set(kept.map((k) => owners[k]));
  return new Set(owners.filter((o) => !keptOwners.has(o))).size;
}

export function partitionUpdates(
  accountId: string,
  data: SuggestedUpdates,
  evidence: SelectedEvidence[],
): { drafts: ProposalDraft[]; withheld: WithheldSuggestion[]; unchanged: number; suggestions: number; owners: number[] } {
  data = SuggestedUpdates.parse(data);
  const ctx = contextFor(accountId, evidence);
  const drafts: ProposalDraft[] = [];
  const withheld: WithheldSuggestion[] = [];
  let unchanged = 0;
  // owners[i] is the suggestion draft i came from.
  const owners: number[] = [];
  for (const [i, u] of data.updates.entries()) {
    try {
      const made = draftsForSuggestion(ctx, u);
      if (made.length === 0) unchanged += 1;
      else {
        drafts.push(...made);
        owners.push(...made.map(() => i));
      }
    } catch (err) {
      if (!(err instanceof WithheldSuggestionError)) throw err;
      const e = evidence.find((e) => e.id === u.evidence_id);
      withheld.push({
        what: suggestionLabel(u),
        reason: err.message,
        next: err.next,
        evidenceId: u.evidence_id,
        noteId: e?.noteId ?? null,
        findingIndex: e?.index ?? null,
        url: e?.finding.url ?? null,
      });
    }
  }
  return { drafts, withheld, unchanged, suggestions: data.updates.length, owners };
}
export function startResearchUpdates(accountId: string, userId: string, focus = "people technology") {
  const account = getAccount(accountId);
  if (!account || account.archived_at) throw new BudgetError("Account missing or archived");
  const selected = researchSelection(accountId, focus);
  if (!selected.total) throw new BudgetError("No retained research evidence. Accept at least one finding first.");
  const existing = db()
    .prepare("SELECT id FROM proposals WHERE account_id=? AND origin_kind='plan_draft' AND origin_id='research_updates' AND status='pending' LIMIT 1")
    .get(accountId);
  if (existing) throw new BudgetError("Suggested updates already await review. Review them before generating again.");
  const run = startRun({
    role: "plan_draft",
    kind: "research_updates",
    accountId,
    userId,
    inputSummary: "saved-evidence-only account update suggestions",
  });
  runDetached(run.id, async (stages) => {
    const { data } = await runStructured({
      role: "plan_draft",
      stageName: "research_updates",
      schema: SuggestedUpdates,
      stages,
      maxTokens: 5000,
      system: `Suggest only factual account identity, explicit named people and job titles, and internal discovery follow-ups from saved evidence. Every name, job title and account value you propose must appear literally in that entry's \`evidence_text\`, which is the only text checked; \`text\` is the model's earlier paraphrase and does not support anything on its own. ${UNTRUSTED_RULES} Never infer emails, buying roles, owner, due date, deal value, installed spend, quantity or share. Technology announcements route to follow_up, never confirmed install_base. Preserve proposed/planned versus approved and past targets versus completion. Unknown means not found in this research. Cite supplied evidence_id exactly. No live search.`,
      user: wrapUntrusted(
        "saved research",
        JSON.stringify(
          // The same canonical excerpt the presence and association checks
          // read, tagged with what it is. Sending `text` and `quote` while
          // checking the saved source excerpt was asking the model to ground
          // itself in one set of words and then refusing it for not using
          // another.
          selected.included.map((e) => {
            const canonical = canonicalEvidence(e.finding);
            return {
              evidence_id: e.id,
              text: e.finding.text,
              evidence_text: canonical.text,
              evidence_kind: canonical.kind,
              as_of: e.asOf,
              scope: e.scope,
            };
          }),
        ),
      ),
      // The fake answer is built from the same canonical excerpt the model is
      // shown, so the browser flows exercise the grounding check rather than
      // a paraphrase it never reads.
      fakeContext: { researchUpdates: selected.included.map((e) => ({ ...e, evidenceText: canonicalEvidence(e.finding).text })) },
      check: (d) => d.updates.flatMap((u, i) => (selected.included.some((e) => e.id === u.evidence_id) ? [] : [{ path: `updates.${i}`, message: "Use a supplied evidence_id" }])),
    });
    const current = researchSelection(accountId, focus);
    if (data.updates.some((u) => !current.included.some((e) => e.id === u.evidence_id))) throw new Error("Supporting evidence changed during generation");
    // Unsupported suggestions are isolated; everything that means the run
    // cannot be trusted still throws out of here and fails the run.
    const { drafts, withheld, unchanged, suggestions, owners } = partitionUpdates(accountId, data, current.included);
    const batch = createProposalBatch(accountId, { kind: "plan_draft", id: "research_updates", aiRunId: run.id }, drafts);
    const result: UpdatesResult = {
      batchId: batch.batchId,
      proposals: batch.ids.length,
      suggestions,
      unchanged: unchanged + declinedSuggestions(owners, batch.kept),
      withheld,
      included: selected.included.length,
      omitted: selected.omitted,
    };
    return result;
  });
  return run.id;
}
