import type { AccountRow } from "../db";
import type { AgentReportExtraction } from "./extractSchema";

export class ImportIdentityError extends Error {
  constructor(detail: string) {
    super(`Account identity conflict: ${detail}. No changes were proposed. Review the original document and choose the correct account or correct its identifiers before importing again.`);
    this.name = "ImportIdentityError";
  }
}

const nameKey = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

// Names are deliberately not fuzzy-matched: a shared acronym or a copied CRM
// identifier is not sufficient evidence that two organizations are the same.
export function assertImportAccountIdentity(
  reported: AgentReportExtraction["account"],
  selected: Pick<AccountRow, "name" | "crm_id">,
  otherAccountWithId?: string,
): void {
  if (nameKey(reported.name) !== nameKey(selected.name)) {
    throw new ImportIdentityError(`the report names “${reported.name}”, but the selected account is “${selected.name}”`);
  }
  const incomingId = reported.crm_id?.trim();
  const currentId = selected.crm_id?.trim();
  if (incomingId && currentId && incomingId !== currentId) {
    throw new ImportIdentityError(`the report's CRM ID “${incomingId}” differs from this account's CRM ID “${currentId}”`);
  }
  if (incomingId && otherAccountWithId) {
    throw new ImportIdentityError(`CRM ID “${incomingId}” is already assigned to “${otherAccountWithId}”`);
  }
}
