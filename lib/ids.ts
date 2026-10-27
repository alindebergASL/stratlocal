import { randomBytes, randomUUID } from "node:crypto";

export function newId(): string {
  return randomUUID();
}

export function randomSessionId(): string {
  return randomBytes(32).toString("hex");
}

// Long random URL-safe token for share links (43 chars of base64url).
export function randomShareToken(): string {
  return randomBytes(32).toString("base64url");
}

// A deal the seller opened before the CRM had one.
//
// `deals.deal_id` is the primary key and was a required field on the manual
// form with no explanation, so people invented one — and when the report later
// arrived with the real id, the import matched on id alone and created a
// second row for the same opportunity. A generated id says plainly that there
// is no CRM id yet, and `local-` is short enough to read out, unchanged by
// encodeURIComponent, and valid raw both in a URL path segment and as the DOM
// anchor a deal row uses.
export function newLocalDealId(): string {
  return `local-${randomBytes(4).toString("hex")}`;
}

export function isLocalDealId(id: string): boolean {
  return /^local-[0-9a-f]{8}$/.test(id);
}
