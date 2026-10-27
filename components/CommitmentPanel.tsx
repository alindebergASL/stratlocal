
import { listUsers } from "@/lib/auth";
import { commitmentBasis, commitmentId, linkedCommitments, type CommitmentKind, type CommitmentSource } from "@/lib/nextStepCommitments";
import { NextStepCommitment } from "./NextStepCommitment";
export function CommitmentPanel({ accountId, kind, sourceId, source, accountArchived }: { accountId: string; kind: CommitmentKind; sourceId: string; source: CommitmentSource; accountArchived: boolean }) {
  const rows = linkedCommitments(accountId, kind, sourceId);
  const alreadyRecorded = rows.some((row) => row.id === commitmentId(accountId, kind, sourceId, commitmentBasis(source)));
  const owners = listUsers().map((u) => ({ id: u.id, name: u.display_name }));
  return <div id="commitments" className="mt-3 space-y-2">
    <p className="text-micro text-ink-muted">{rows.length ? "Recorded follow-ups from this source (not rewritten when planning text changes)." : source.next_step?.trim() ? "Written next step · no recorded follow-up from this source." : "No next step written · no recorded follow-up from this source."}</p>
    {rows.map((row) => <div key={row.id} className="text-label">
      {row.status === "open" && !row.archived_at && !accountArchived ? <a className="text-accent underline" href={`/follow-ups?who=${encodeURIComponent(row.owner_user_id ?? "unowned")}#action-${row.id}`}>{row.text} →</a> : <span>{row.text}</span>}
      <p className="text-micro text-ink-muted">{row.archived_at ? "archived" : row.status} · {owners.find((o) => o.id === row.owner_user_id)?.name ?? row.owner ?? "unassigned"} · {row.due ?? "no date"}</p>
    </div>)}
    {!alreadyRecorded && !accountArchived && !source.archived_at && !source.merged_into && source.next_step?.trim() && <NextStepCommitment accountId={accountId} kind={kind} sourceId={sourceId} suggestion={source.next_step} basis={commitmentBasis(source)} due={source.next_step_due ?? null} owners={owners} />}
  </div>;
}
