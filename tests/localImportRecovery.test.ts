// SYNTHETIC ONLY. Recovery must reuse originals without touching account data.
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { db } from "@/lib/db";
import { stagePackage, retryPackage, parsePackage } from "@/lib/local/packages";
import { cancel, claim, finish } from "@/lib/local/queue";
import { job, packageRow, type Job } from "@/lib/local/store";
import { processNext } from "@/lib/local/worker";
import { seedAccount, USER } from "./helpers";

function stage() {
  const { accountId } = seedAccount();
  const bytes = Buffer.from("# Synthetic briefing\nOriginal evidence for recovery.");
  const p = stagePackage("synthetic-recovery.md", bytes, USER, accountId);
  const task = db().prepare("SELECT * FROM local_jobs WHERE request_key=?").get(`import:${p.id}`) as Job;
  return { p, task, bytes, accountId };
}

it("cancels queued imports and retries the same original file and job", async () => {
  const { p, task, bytes, accountId } = stage();
  cancel(task.id, USER);
  expect(packageRow(p.id)?.state).toBe("cancelled");
  expect(job(task.id)?.status).toBe("cancelled");
  expect(stagePackage("synthetic-recovery.md", bytes, USER, accountId).id).toBe(p.id);
  expect(() => retryPackage(p.id, "another-user")).toThrow(/not found/);

  retryPackage(p.id, USER);
  expect(packageRow(p.id)).toMatchObject({ state: "queued", storage_path: p.storage_path, error: null });
  expect(fs.readFileSync(p.storage_path)).toEqual(bytes);
  expect(job(task.id)).toMatchObject({ status: "queued", attempts: 0, owner: null, lease_until: null, error: null, result_json: null, cancel_requested: 0 });
  expect(() => retryPackage(p.id, USER)).toThrow(/no active task/);
  await processNext(randomUUID());
  expect(packageRow(p.id)?.state).toBe("review");
  expect(job(task.id)?.status).toBe("done");
  expect(db().prepare("SELECT count(*) n FROM local_packages").get()).toEqual({ n: 1 });
  expect(db().prepare("SELECT count(*) n FROM proposals").get()).toEqual({ n: 0 });
});

it("waits for running cancellation to finish before allowing retry", () => {
  const { p, task } = stage();
  claim("active-worker");
  cancel(task.id, USER);
  expect(job(task.id)).toMatchObject({ status: "running", cancel_requested: 1 });
  expect(packageRow(p.id)?.state).toBe("queued");
  expect(() => retryPackage(p.id, USER)).toThrow(/no active task/);
  finish(task.id, "active-worker", null, "Task cancelled");
  expect(packageRow(p.id)?.state).toBe("cancelled");
  expect(job(task.id)).toMatchObject({ status: "cancelled", owner: null, lease_until: null });
  retryPackage(p.id, USER);
  expect(job(task.id)?.status).toBe("queued");
});

it("ends abandoned imports after three leases and makes them retryable", () => {
  const { p, task } = stage();
  const now = Date.now();
  claim("first", now);
  claim("second", now + 60_001);
  claim("third", now + 120_002);
  expect(claim("fourth", now + 180_003)).toBeNull();
  expect(packageRow(p.id)).toMatchObject({ state: "failed", error: expect.stringContaining("Interrupted three times") });
  expect(job(task.id)).toMatchObject({ status: "failed", owner: null, lease_until: null });
  retryPackage(p.id, USER);
  expect(job(task.id)).toMatchObject({ status: "queued", attempts: 0 });
  finish(task.id, "third", { stale: true }, "Old worker result");
  expect(packageRow(p.id)?.state).toBe("queued");
  expect(job(task.id)?.status).toBe("queued");
});

it("finalizes cancellation when an interrupted worker's lease expires", () => {
  const { p, task } = stage();
  const now = Date.now();
  claim("interrupted-worker", now);
  cancel(task.id, USER);
  expect(claim("replacement-worker", now + 60_001)).toBeNull();
  expect(packageRow(p.id)?.state).toBe("cancelled");
  retryPackage(p.id, USER);
  expect(job(task.id)).toMatchObject({ status: "queued", cancel_requested: 0 });
});

it("records a parser failure on the package and task together", async () => {
  const p = stagePackage("synthetic-invalid.json", Buffer.from("{invalid json"), USER);
  await processNext(randomUUID());
  const task = db().prepare("SELECT * FROM local_jobs WHERE request_key=?").get(`import:${p.id}`) as Job;
  expect(task.status).toBe("failed");
  expect(packageRow(p.id)).toMatchObject({ state: "failed", error: task.error });
  expect(task.error).toBeTruthy();
  retryPackage(p.id, USER);
  expect(packageRow(p.id)).toMatchObject({ state: "queued", error: null });
});

it("recovers legacy queued packages whose tasks already failed or were cancelled", () => {
  const { p, task } = stage();
  for (const status of ["failed", "cancelled"]) {
    db().prepare("UPDATE local_jobs SET status=?,error='Legacy interruption' WHERE id=?").run(status, task.id);
    expect(packageRow(p.id)?.state).toBe("queued");
    retryPackage(p.id, USER);
    expect(job(task.id)).toMatchObject({ status: "queued", error: null });
  }
  db().prepare("UPDATE local_jobs SET status='failed',error='Legacy interruption' WHERE id=?").run(task.id);
  claim("repair-worker");
  expect(packageRow(p.id)).toMatchObject({ state: "failed", error: "Legacy interruption" });
});

it("refuses inconsistent terminal tasks with unexpired leases and other users' cancellation", () => {
  const { p, task } = stage();
  cancel(task.id, "another-user");
  expect(job(task.id)?.status).toBe("queued");
  db().prepare("UPDATE local_jobs SET status='failed',lease_until=? WHERE id=?").run(Date.now() + 60_000, task.id);
  expect(() => retryPackage(p.id, USER)).toThrow(/no active task/);
  expect(packageRow(p.id)?.state).toBe("queued");
});

it("retains completed parsing if cancellation arrives just before the task finishes", async () => {
  const { p, task, accountId } = stage();
  claim("finishing-worker");
  await parsePackage(p.id, accountId);
  cancel(task.id, USER);
  finish(task.id, "finishing-worker", null, "Task cancelled");
  expect(packageRow(p.id)?.state).toBe("review");
  expect(() => retryPackage(p.id, USER)).toThrow(/Only failed or cancelled/);
});
