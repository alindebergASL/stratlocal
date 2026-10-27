// Asks the model to read a report's text and fill the extraction schema,
// then applies checks that do not depend on the model being honest.
import type { StageUsage } from "../ai/cost";
import { UNTRUSTED_RULES, wrapUntrusted } from "../ai/prompts";
import { runStructured, type Finding } from "../ai/runStructured";
import { AgentReportExtraction } from "./extractSchema";
import { contactEmail } from "../proposals/schema";

const SYSTEM = `You extract structured facts from an account plan report that a seller exported from an internal sales tool. The report may have been saved as HTML, PDF, Word, Markdown, plain text or JSON and converted to text. From HTML, table rows appear as cells separated by " | ", header metadata as "label: value", headings as "## ..."; from a PDF, table cells may run together on a line; from JSON, records are keys and values.

${UNTRUSTED_RULES}

What to extract:
- account: the customer's name, its CRM/account identifier if the header shows one, legal entity, coverage region, segment, headquarters city/state, and a one-sentence summary of what the plan is about.
- team: the seller-side people named in the header or footer (account executives, systems engineers, specialists) with email if shown. Map their function to a role: ae, se, specialist_ae, specialist_se, partner, or other. Do NOT include customer employees here.
- deals: every row of the opportunities table. deal_id is the identifier column copied exactly. stage is the leading number of the stage cell (1-6) and stage_label its wording. close_date as YYYY-MM-DD. fiscal_quarter exactly as written if the row shows one (e.g. "FY27 Q2"). tcv_usd as an integer number of dollars. competitor is the named competing vendor if any; partner is the named channel partner if any; owner is the named owner if any; architecture is the focus/description cell.
- install_base: every row of the install base table except any TOTAL row. value_usd integer dollars, share_pct as a number.
- plays: each named play / strategy section, with the deal ids it references (only ids that appear in the deals table), the people it names as stakeholders, and its next step if one is stated.
- kpis: the headline metric cards (label, value as written, sub-text).

Leave a field null when the report does not state it. Do not compute or infer values that are not written.`;

export type ExtractOutcome = { extraction: AgentReportExtraction; attempts: number; dropped: string[] };

export function checkExtraction(parsed: AgentReportExtraction, text: string): Finding[] {
  const findings: Finding[] = [];
  parsed.deals.forEach((d, i) => {
    if (!text.includes(d.deal_id)) findings.push({ path: `deals[${i}].deal_id`, message: `"${d.deal_id}" does not appear in the report; copy identifiers exactly or omit the row` });
  });
  return findings;
}

// Post-processing that silently drops rather than retries: a play that names
// a deal id we did not extract is still a useful play.
export function sanitizeExtraction(parsed: AgentReportExtraction, text: string): { extraction: AgentReportExtraction; dropped: string[] } {
  const dropped: string[] = [];
  const deals = parsed.deals.filter((d) => {
    const ok = text.includes(d.deal_id);
    if (!ok) dropped.push(`deal ${d.deal_id}`);
    return ok;
  });
  const dealIds = new Set(deals.map((d) => d.deal_id));
  const plays = parsed.plays.map((p) => ({ ...p, deal_ids: p.deal_ids.filter((id) => dealIds.has(id)) }));
  const install_base = parsed.install_base.filter((r) => !/^total\b/i.test(r.product_family.trim()));
  // An address the model produced has to be one ContactPatch will take, because
  // it goes into a contact payload and createProposalBatch parses the whole
  // batch in one transaction with no per-draft try — so one malformed address
  // in the team block loses the deals and the install base with it. The team
  // block types email as a plain string, so nothing upstream checks this.
  //
  // The person is kept and the address dropped rather than the other way
  // round: the name is why the row is worth having, and a contact with no
  // address is an ordinary thing this app already handles.
  const team = parsed.team.map((m) => {
    if (m.email === null || contactEmail.safeParse(m.email).success) return m;
    dropped.push(`email “${m.email}” for ${m.name}`);
    return { ...m, email: null };
  });
  return { extraction: { ...parsed, deals, team, plays, install_base }, dropped };
}

export async function extractAgentReport(text: string, filename: string, stages: StageUsage[]): Promise<ExtractOutcome> {
  const user = `Extract the account plan below.\n\n${wrapUntrusted("report", text, { filename })}`;
  const { data, attempts } = await runStructured({
    role: "import",
    stageName: "import_extract",
    system: SYSTEM,
    user,
    schema: AgentReportExtraction,
    effort: "medium",
    maxTokens: 16000,
    check: (parsed) => checkExtraction(parsed, text),
    stages,
  });
  const { extraction, dropped } = sanitizeExtraction(data, text);
  return { extraction, attempts, dropped };
}
