import { sameName } from "../format";

type RecordValue = Record<string, unknown>;
const object = (v: unknown): RecordValue => v && typeof v === "object" && !Array.isArray(v) ? v as RecordValue : {};
export function changedDealIds(report: RecordValue, existing: {deal_id: string; name: string; archived_at?: string | null}[]) {
  const rows = Array.isArray(report.deals) ? report.deals : [];
  const knownIds = new Set(existing.map(d => d.deal_id));
  return rows.flatMap(value => {
    const row = object(value);
    if (typeof row.deal_id !== "string" || typeof row.name !== "string" || knownIds.has(row.deal_id)) return [];
    return existing.filter(d => sameName(d.name, row.name as string)).map(d => ({name: row.name as string, incomingId: row.deal_id as string, existingId: d.deal_id}));
  });
}

export function accountReadiness(report: RecordValue, sources: {path: string; value: unknown}[]) {
  const account = object(report.account);
  const count = (key: string) => Array.isArray(report[key]) ? report[key].length : 0;
  const warnings: string[] = [];
  const gaps: string[] = [];
  if (typeof account.summary !== "string" || !account.summary.trim()) gaps.push("Provide a sourced general account summary in report.account.summary.");
  if (!count("contacts")) gaps.push("Provide sourced customer contacts in report.contacts, or state why none could be retrieved. Evidence may contain contacts not yet represented in the manifest.");
  if (!count("deals")) gaps.push("Report active-opportunity retrieval coverage: no matching records, inaccessible, or not yet retrieved are different outcomes.");
  let reportedTotal: number | null = null;
  for (const source of sources) {
    const value = object(source.value);
    const identity = object(value.account);
    if (typeof identity.name !== "string" || typeof account.name !== "string" || !sameName(identity.name, account.name)) continue;
    if (identity.crm_id && account.crm_id && identity.crm_id !== account.crm_id) continue;
    const telemetry = object(value.pipeline_telemetry);
    const coverage = object(object(value.coverage).opportunities);
    const total = telemetry.total_open_pipeline_opportunities_count ?? coverage.total_matching;
    if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0) continue;
    if (reportedTotal !== null && reportedTotal !== total) warnings.push(`Conflicting opportunity totals in the supplied evidence (${reportedTotal} and ${total}); reconcile scope and retrieval dates.`);
    reportedTotal = total;
    if (total !== count("deals")) {
      const message = `${source.path} reports ${total} open opportunities; this account report supplies ${count("deals")} structured deals. This is an author-reported comparison, not verified CRM coverage.`;
      warnings.push(message);
      gaps.push(`Reconcile the ${total} reported open opportunities with the ${count("deals")} packaged deals. Retrieve all accessible records with pagination, or explicitly explain omissions and scope differences.`);
    }
  }
  if (reportedTotal === null) gaps.push("Supply an opportunity coverage ledger with total_matching, returned count, filters, retrieval date, and pagination/access limitations; completeness is currently unknown.");
  return { summary: !!(typeof account.summary === "string" && account.summary.trim()), contacts: count("contacts"), deals: count("deals"), plays: count("plays"), reportedTotal, warnings: [...new Set(warnings)], gaps: [...new Set(gaps)] };
}
