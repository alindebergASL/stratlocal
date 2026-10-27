// SYNTHETIC ONLY: independently invented sandbox IDs, people and amounts.
import { applyEntityChange } from "@/lib/proposals/apply";

export const USER = "user-1";

export type Seed = { accountId: string; dealId: string; playId: string; contactId: string; meetingId: string };

// A small account with one of everything, for tests that need real ids.
//
// `name` and `dealId` are overridable so a test can seed more than one
// account: the deal id is the deals table's primary key, so a second call
// with the default would fail rather than produce a second account.
export function seedAccount(opts: { heldAt?: string; name?: string; dealId?: string; closeDate?: string } = {}): Seed {
  const accountId = applyEntityChange({
    accountId: "",
    entityType: "account",
    op: "create",
    payload: { name: opts.name ?? "Synthetic Orchard Lab", region: "Central" },
    actorUserId: USER,
  }).entityId;

  const dealId = applyEntityChange({
    accountId,
    entityType: "deal",
    op: "create",
    payload: { deal_id: opts.dealId ?? "SYN-DEAL-001", name: "EHR Refresh", stage: 3, close_date: opts.closeDate ?? "2026-12-01", tcv_usd: 1000 },
    actorUserId: USER,
  }).entityId;

  const contactId = applyEntityChange({
    accountId,
    entityType: "contact",
    op: "create",
    payload: { name: "Finley Example", org: "customer", role: "it_leader" },
    actorUserId: USER,
  }).entityId;

  const playId = applyEntityChange({
    accountId,
    entityType: "play",
    op: "create",
    payload: { title: "EHR platform defense", status: "active", deal_ids: [dealId] },
    actorUserId: USER,
  }).entityId;

  const meetingId = applyEntityChange({
    accountId,
    entityType: "meeting",
    op: "create",
    payload: { title: "Quarterly review", held_at: opts.heldAt ?? "2026-09-15", attendees: [{ contact_id: contactId, name: "Finley Example", note: null }] },
    actorUserId: USER,
  }).entityId;

  return { accountId, dealId, playId, contactId, meetingId };
}

// The smallest PDF with one line of text, built by hand with a correct xref.
export function tinyPdf(line: string): Buffer {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 12 Tf 72 720 Td (${line}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
