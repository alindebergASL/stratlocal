import { db } from "../db";
import { newId } from "../ids";
import { job, type Job } from "./store";

export function enqueue(
  kind: "import" | "draft",
  requestKey: string,
  payload: unknown,
  userId: string,
): Job {
  const encoded = JSON.stringify(payload);
  return db()
    .transaction(() => {
      const prior = db()
        .prepare("SELECT * FROM local_jobs WHERE request_key=?")
        .get(requestKey) as Job | undefined;
      if (prior) {
        if (prior.kind !== kind || prior.payload_json !== encoded)
          throw new Error(
            "Request identifier already used for different content",
          );
        return prior;
      }
      const id = newId(),
        now = Date.now();
      db()
        .prepare(
          "INSERT INTO local_jobs(id,request_key,kind,payload_json,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        )
        .run(id, requestKey, kind, encoded, userId, now, now);
      return job(id)!;
    })
    .immediate();
}
export function claim(owner: string, now = Date.now()): Job | null {
  return db()
    .transaction(() => {
      db()
        .prepare(
          "UPDATE local_jobs SET status='cancelled',progress='Cancelled',updated_at=? WHERE cancel_requested=1 AND (status='queued' OR (status='running' AND lease_until<=?))",
        )
        .run(now, now);
      db()
        .prepare(
          "UPDATE local_jobs SET status='failed',error='Interrupted three times; inspect the source before retrying.',updated_at=? WHERE status='running' AND lease_until<=? AND attempts>=3",
        )
        .run(now, now);
      if (
        db()
          .prepare(
            "SELECT 1 FROM local_jobs WHERE status='running' AND lease_until>?",
          )
          .get(now)
      )
        return null;
      const row = db()
        .prepare(
          "SELECT * FROM local_jobs WHERE status='queued' OR (status='running' AND lease_until<=?) ORDER BY created_at,id LIMIT 1",
        )
        .get(now) as Job | undefined;
      if (!row) return null;
      db()
        .prepare(
          "UPDATE local_jobs SET status='running',owner=?,lease_until=?,attempts=attempts+1,progress='Starting',updated_at=? WHERE id=?",
        )
        .run(owner, now + 60_000, now, row.id);
      return job(row.id)!;
    })
    .immediate();
}
export function heartbeat(
  id: string,
  owner: string,
  progress = "Working",
  now = Date.now(),
) {
  const changed = db()
    .prepare(
      "UPDATE local_jobs SET lease_until=?,progress=?,updated_at=? WHERE id=? AND owner=? AND status='running' AND lease_until>? AND cancel_requested=0",
    )
    .run(now + 60_000, progress, now, id, owner, now);
  if (!changed.changes) throw new Error("Task cancelled or lease lost");
}
export function assertLease(id: string, owner: string) {
  const row = job(id);
  if (
    !row ||
    row.status !== "running" ||
    row.owner !== owner ||
    (row.lease_until ?? 0) <= Date.now() ||
    row.cancel_requested
  )
    throw new Error("Task cancelled or lease lost");
}
export function finish(
  id: string,
  owner: string,
  result: unknown,
  error?: string,
) {
  db()
    .prepare(
      "UPDATE local_jobs SET status=CASE WHEN cancel_requested=1 THEN 'cancelled' WHEN ? IS NOT NULL THEN 'failed' ELSE 'done' END,progress='Finished',result_json=?,error=?,lease_until=NULL,updated_at=? WHERE id=? AND owner=? AND status='running' AND lease_until>?",
    )
    .run(
      error ?? null,
      JSON.stringify(result),
      error ?? null,
      Date.now(),
      id,
      owner,
      Date.now(),
    );
}
export function cancel(id: string, userId: string) {
  db()
    .prepare(
      "UPDATE local_jobs SET cancel_requested=1,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,updated_at=? WHERE id=? AND created_by=? AND status IN ('queued','running')",
    )
    .run(Date.now(), id, userId);
}
