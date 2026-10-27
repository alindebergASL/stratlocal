// Report templates: a question and the section headings its report must
// have. Four are built in; the two of you can save more from any report you
// liked. A template on a schedule (step 9) is the same template, run by an
// assistant.
import { z } from "zod";
import { db } from "../db";
import { newId } from "../ids";
import { ApplyError } from "../proposals/apply";
import { currentPlaybook } from "../playbook/store";
import type { Playbook } from "../playbook/schema";

export type TemplateScope = "all" | "account";
export type AskTemplate = { id: string; name: string; question: string; sections: string[]; scope: TemplateScope; builtIn: boolean; createdBy: string | null };

/** The written one-pager, started from an account's One page. */
export const ONE_PAGER = "account_one_pager";

export const BUILT_IN_TEMPLATES: AskTemplate[] = [
  {
    id: "weekly_pipeline",
    name: "Weekly pipeline review",
    question: "Write the weekly pipeline review: what moved this week, what is at risk, and what needs a decision.",
    sections: ["Headline", "What moved", "At risk", "Decisions needed", "Next week"],
    scope: "all",
    builtIn: true,
    createdBy: null,
  },
  {
    id: "quarter_forecast",
    name: "Quarter forecast",
    question: "Write the forecast for the current fiscal quarter: open pipeline by stage, what is likely, what is at risk and what slipped, with the reasons from the records.",
    sections: ["The number", "By stage", "Likely to close", "At risk", "Slipped or pushed"],
    scope: "all",
    builtIn: true,
    createdBy: null,
  },
  {
    id: ONE_PAGER,
    name: "Account one-pager",
    question: "Write a one-page brief on this account: where it stands, the deals, the people, the plan and what is next.",
    sections: ["Where it stands", "Deals", "People", "The plan", "Next steps"],
    scope: "account",
    builtIn: true,
    createdBy: null,
  },
  {
    id: "before_1on1",
    name: "Before my 1:1",
    question: "Prepare me for my 1:1 with my manager: wins, what moved, risks, where I need help, and what I committed to.",
    sections: ["Wins", "What moved", "Risks", "Where I need help", "Commitments"],
    scope: "all",
    builtIn: true,
    createdBy: null,
  },
  {
    id: "friday_review",
    name: "Friday review",
    question: "Write my Friday pipeline review: the deals that need a look and why, what moved this week, a suggested next step for each from the records, and three lines I can send my manager.",
    sections: ["Needs a look", "What moved", "Suggested next steps", "For your manager"],
    scope: "all",
    builtIn: true,
    createdBy: null,
  },
];

/**
 * The playbook's artifacts as account templates (DECISIONS #74): each asks Ask
 * to read the account through the playbook tool and write what a step
 * produces, under headings taken from the playbook itself where it has them.
 * They exist only while the team has a playbook, and change when it does.
 */
export const PLAYBOOK_TEMPLATE_PREFIX = "playbook_";

export function playbookTemplates(playbook: Playbook | null = currentPlaybook()?.playbook ?? null): AskTemplate[] {
  if (!playbook) return [];
  const first = playbook.steps[0];
  const t = (id: string, name: string, question: string, sections: string[]): AskTemplate => ({
    id: `${PLAYBOOK_TEMPLATE_PREFIX}${id}`,
    name,
    question: `${question} Read the account through the playbook tool first, and follow the team's playbook ("${playbook.name}").`,
    sections: sections.filter(Boolean).slice(0, 12),
    scope: "account",
    builtIn: true,
    createdBy: null,
  });
  const out = [
    t(
      "intelligence_brief",
      "Intelligence brief",
      `Write the pre-meeting intelligence brief for this account${first ? `, as the playbook's "${first.name}" step asks` : ""}: what they have said publicly, when their money is set, what is already installed, how their peers and competitors are going about the same things, and the hypothesis to test.`,
      [...(first?.checklist.length ? first.checklist : ["Strategy and mandates", "Budget timing", "Leaders in their own words", "What is installed"]), "Peers and competitors", "Hypothesis to test"],
    ),
    t("question_guide", "Question guide", "Write a question guide for the next meeting on this account: by person attending, the playbook's questions in their terms, and what each would tell us about qualification.", [...playbook.movements.map((m) => m.name), "What we still need to find out"]),
    t("outcome_readout", "Outcome readout", "Write the outcome readout to send after the discovery meeting: their words back to them, the outcomes they named, where we can help, the proposed next step, and a short note they can forward to line-of-business leaders.", ["What we heard", "The outcomes you named", "Where we can help", "Proposed next step", "A note to forward"]),
    t("roadmap_map", "Roadmap and action plan", "Write the joint roadmap and Mutual Action Plan for this account: the phases and what is in each, the dated milestones on both sides, and how they line up with the customer's budget calendar.", ["Phase 1", "Phase 2", "Phase 3", "Dated milestones", "Budget timing"]),
    t("quarterly_refresh", "Quarterly refresh", "Write the quarterly intelligence refresh for this account: what changed in their world and in ours, whether the archetype still holds, what qualification is still open, and the focus for next quarter.", ["What changed", "Archetype: still true?", "Qualification still open", "Focus for next quarter"]),
  ];
  if (playbook.workshop.length) out.splice(3, 0, t("workshop_pack", "Workshop pack", "Write the pack for the line-of-business workshop on this account: the agenda with who leads each part, the use cases to bring, and where each should run and why.", [...playbook.workshop.map((w) => w.name), "Use cases and where they run"]));
  return out;
}

const Sections = z.array(z.string().trim().min(1).max(200)).min(1).max(12);
type Row = { id: string; name: string; question: string; sections_json: string; scope: TemplateScope; created_by: string | null };

function fromRow(r: Row): AskTemplate | null {
  try {
    const sections = Sections.parse(JSON.parse(r.sections_json));
    return { id: r.id, name: r.name, question: r.question, sections, scope: r.scope, builtIn: false, createdBy: r.created_by };
  } catch {
    return null;
  }
}

/** With an account, the playbook templates are that account's playbook's. */
export function listTemplates(scope?: TemplateScope, accountId?: string | null): AskTemplate[] {
  const saved = (db().prepare(`SELECT * FROM ask_templates WHERE archived_at IS NULL ORDER BY created_at`).all() as Row[]).map(fromRow).filter((t): t is AskTemplate => t !== null);
  return [...BUILT_IN_TEMPLATES, ...playbookTemplates(currentPlaybook({ accountId })?.playbook ?? null), ...saved].filter((t) => !scope || t.scope === scope);
}

export function getTemplate(id: string, accountId?: string | null): AskTemplate | null {
  const built = BUILT_IN_TEMPLATES.find((t) => t.id === id) ?? (id.startsWith(PLAYBOOK_TEMPLATE_PREFIX) ? playbookTemplates(currentPlaybook({ accountId })?.playbook ?? null).find((t) => t.id === id) : undefined);
  if (built) return built;
  const r = db().prepare(`SELECT * FROM ask_templates WHERE id = ? AND archived_at IS NULL`).get(id) as Row | undefined;
  return r ? fromRow(r) : null;
}

export function saveTemplate(input: { name: string; question: string; sections: string[]; scope: TemplateScope; userId: string }): AskTemplate {
  const name = input.name.replace(/\s+/g, " ").trim().slice(0, 80);
  if (name.length < 2) throw new ApplyError("Give the template a name.", "validation");
  const question = input.question.trim().slice(0, 4000);
  if (question.length < 2) throw new ApplyError("A template needs its question.", "validation");
  const sections = Sections.parse(input.sections);
  const id = newId();
  db()
    .prepare(`INSERT INTO ask_templates (id, name, question, sections_json, scope, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, name, question, JSON.stringify(sections), input.scope, input.userId, Date.now());
  return getTemplate(id)!;
}

export function archiveTemplate(id: string): void {
  db().prepare(`UPDATE ask_templates SET archived_at = ? WHERE id = ?`).run(new Date().toISOString().slice(0, 10), id);
}

/** The question that wrote a report, so the report can become a template. */
export function questionForReport(docId: string): string | null {
  const answer = db().prepare(`SELECT thread_id, created_at, rowid FROM ask_messages WHERE report_doc_id = ? LIMIT 1`).get(docId) as
    | { thread_id: string; created_at: number; rowid: number }
    | undefined;
  if (!answer) return null;
  const q = db()
    .prepare(`SELECT text FROM ask_messages WHERE thread_id = ? AND role = 'user' AND rowid < ? ORDER BY rowid DESC LIMIT 1`)
    .get(answer.thread_id, answer.rowid) as { text: string } | undefined;
  return q?.text ?? null;
}

/** What the model is told when a question comes from a template. */
export function templatePrompt(t: AskTemplate): string {
  return `This question is the report template "${t.name}". Look up what it needs, then call create_report exactly once with exactly these section headings, in this order: ${t.sections.map((s) => `"${s}"`).join(", ")}. Then answer in a sentence or two that the report is ready.`;
}
