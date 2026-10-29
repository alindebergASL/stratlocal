import { db } from "../db";

export type SavedRequest = {
  id: string;
  prompt: string;
  created_at: number;
};

/** A private, paginated history; preparing a request is not proof it was sent. */
export function requestHistory(accountId: string, userId: string, requestedPage = 1, pageSize = 20) {
  const size = Number.isSafeInteger(pageSize) ? Math.min(20, Math.max(1, pageSize)) : 20;
  const total = (db().prepare("SELECT count(*) AS n FROM local_requests WHERE account_id=? AND created_by=?").get(accountId, userId) as { n: number }).n;
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Number.isSafeInteger(requestedPage) ? Math.min(pages, Math.max(1, requestedPage)) : 1;
  const rows = db().prepare("SELECT id,prompt,created_at FROM local_requests WHERE account_id=? AND created_by=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?").all(accountId, userId, size, (page - 1) * size) as SavedRequest[];
  return { rows, total, page, pages };
}
