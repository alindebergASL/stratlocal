import fs from "node:fs";
import { db, type AccountRow, type ContactRow } from "../db";
import { sameName } from "../format";
import { matchContact } from "../matchContact";
import { jsonExtraction } from "../import/jsonReport";
import { ContactPatch, ContactRole, contactEmail, AccountPatch, type ProposalDraft, type SourceRef } from "../proposals/schema";
import { artifact } from "./store";

type ObjectValue = Record<string, unknown>;
const object = (v: unknown): ObjectValue => v && typeof v === "object" && !Array.isArray(v) ? v as ObjectValue : {};
const str = (v: unknown) => typeof v === "string" ? v.trim() : "";
export type ContextSource = { value: ObjectValue; ref: SourceRef };

// Only the explicitly mapped report and identity-matched evidence may supply people.
// Never search arbitrary nested arrays or infer customer contacts from the seller team.
export function contextDrafts(report: ObjectValue, sources: ContextSource[], account: AccountRow, existing: ContactRow[], reportRef: SourceRef) {
  const drafts: ProposalDraft[] = [], warnings: string[] = [];
  const metadata: ObjectValue = {};
  for (const key of ["crm_id", "legal_entity", "region", "segment", "hq"] as const) {
    const value = str(object(report.account)[key]);
    if (value && value !== account[key]) metadata[key] = value;
  }
  if (Object.keys(metadata).length && !jsonExtraction(JSON.stringify(report), account.name)) {
    const parsed = AccountPatch.safeParse(metadata);
    if (parsed.success) drafts.push({ entity_type: "account", entity_id: account.id, op: "update", payload: parsed.data, source_ref: reportRef, rationale: "General account information from the imported report" });
    else warnings.push("Some general account fields exceed supported lengths; inspect the report.");
  }
  const summary = str(object(report.account).summary);
  if (summary && summary !== account.research_summary) {
    const payload = AccountPatch.safeParse({ research_summary: summary });
    if (payload.success) drafts.push({ entity_type: "account", entity_id: account.id, op: "update", payload: payload.data, source_ref: reportRef, rationale: "Researched account overview; separate from the account plan and customer-confirmed answers" });
    else warnings.push("Account overview exceeds the supported length; keep it within 4,000 characters.");
  }
  const inputs: { row: unknown; ref: SourceRef }[] = [];
  if (Array.isArray(report.contacts) && report.contacts.length) {
    for (const row of report.contacts) inputs.push({ row, ref: reportRef });
  } else {
    const identity = object(report.account);
    for (const source of sources) {
      const value = source.value;
      const rows = value.contacts ?? value.stakeholders_and_executives;
      if (!Array.isArray(rows)) continue;
      const sourceIdentity = object(value.account);
      const name = str(sourceIdentity.name) || str(value.account_name);
      const crmId = str(sourceIdentity.crm_id);
      if (!name || !sameName(name, str(identity.name)) || (crmId && str(identity.crm_id) && crmId !== str(identity.crm_id)) || (crmId && account.crm_id && crmId !== account.crm_id.trim())) {
        warnings.push("Customer contacts in a source were skipped because its account identity is missing or conflicts with the report.");
        continue;
      }
      for (const row of rows) inputs.push({ row, ref: source.ref });
    }
  }
  const seen: { name: string; email: string | null }[] = [], claimed = new Set<string>();
  for (const input of inputs) {
    const row = object(input.row);
    const name = str(row.name) || [str(row.first_name), str(row.last_name)].filter(Boolean).join(" ");
    if (!name) { warnings.push("Skipped a customer contact without a name."); continue; }
    if (row.org != null && row.org !== "customer") { warnings.push(`Skipped ${name}: customer contacts must be separate from seller/partner records.`); continue; }
    const roleText = str(row.role);
    const normalizedRole = roleText.toLowerCase().replace(/[ -]+/g, "_");
    const role = ContactRole.safeParse(normalizedRole).success ? normalizedRole : null;
    if (roleText && role !== row.role) warnings.push(`Customer contact ${name}: ${role ? "normalized role spelling" : "preserved descriptive role in notes without inferring buying authority"}.`);
    let email = str(row.email) || null;
    const invalidEmail = email && !contactEmail.safeParse(email).success;
    if (invalidEmail) { email = null; warnings.push(`Customer contact ${name}: invalid email omitted; original retained for review.`); }
    if (email && Array.isArray(report.contacts) && report.contacts.length) {
      const corroborated = sources.some(s => {
        const rows = s.value.contacts ?? s.value.stakeholders_and_executives;
        return Array.isArray(rows) && rows.some(candidate => {
          const c = object(candidate);
          const sourceName = str(c.name) || [str(c.first_name), str(c.last_name)].filter(Boolean).join(" ");
          return sameName(sourceName, name) && str(c.email).toLowerCase() === email!.toLowerCase();
        });
      });
      if (!corroborated) { email = null; warnings.push(`Customer contact ${name}: email appears in the report but is not corroborated by a matching contact in the JSON evidence; omitted from the People proposal. Inspect the original before adding it manually.`); }
    }
    const notes = [str(row.notes), roleText && !role ? `Reported role (unverified): ${roleText}` : "", ...["organization", "department", "function", "contact_id", "record_url", "relationship", "last_interaction"].map(k => str(row[k]) ? `${k.replaceAll("_", " ")}: ${str(row[k])}` : "")].filter(Boolean).join("\n");
    const payload = ContactPatch.safeParse({ name, title: str(row.title) || null, email, org: "customer", role, notes: notes || null });
    if (!payload.success) { warnings.push(`Skipped customer contact ${name}: invalid email, role, or field length; inspect the source.`); continue; }
    const person = payload.data as { name: string; email: string | null; title: string | null; org: "customer"; role: string | null; notes: string | null };
    if (matchContact(seen, person)) { warnings.push(`Duplicate customer contact ${name} in the package; review source differences.`); continue; }
    seen.push(person);
    const candidates = existing.filter(c => matchContact([c], person));
    if (candidates.some(c => c.org !== "customer" || c.merged_into) || candidates.length > 1) { warnings.push(`Customer contact ${name} needs manual identity review: ambiguous, merged, or seller/partner match.`); continue; }
    const found = candidates[0];
    if (found) {
      if (claimed.has(found.id)) { warnings.push(`Multiple rows match ${name}; review contact identity manually.`); continue; }
      claimed.add(found.id);
      const patch: ObjectValue = {};
      for (const field of ["title", "email", "role", "notes"] as const) {
        if (person[field] && !found[field]) patch[field] = person[field];
      }
      if (found.archived_at) patch.archived_at = null;
      if (person.title && found.title && person.title !== found.title) warnings.push(`Conflicting title for ${name}; existing title retained for manual review.`);
      if (Object.keys(patch).length) drafts.push({ entity_type: "contact", entity_id: found.id, op: "update", payload: patch, source_ref: input.ref, rationale: "Fill missing customer contact information from imported evidence" });
    } else drafts.push({ entity_type: "contact", op: "create", payload: person, source_ref: input.ref, rationale: "Customer stakeholder in imported evidence; review identity and organization before accepting" });
  }
  return { drafts, warnings };
}

export function contextSources(paths: Record<string, string>, refs: { path: string }[], accountId: string): ContextSource[] {
  const result: ContextSource[] = [];
  for (const ref of refs) {
    if (!/\.json$/i.test(ref.path)) continue;
    const a = artifact(paths[ref.path] ?? "");
    if (!a) continue;
    const link = db().prepare("SELECT document_id FROM local_artifact_links WHERE artifact_id=? AND account_id=? AND meeting_id=''").get(a.id, accountId) as { document_id: string } | undefined;
    if (!link) continue;
    try { result.push({ value: object(JSON.parse(fs.readFileSync(a.storage_path, "utf8"))), ref: { kind: "document", id: link.document_id } }); }
    catch { /* Extraction warnings already expose unreadable evidence. */ }
  }
  return result;
}
