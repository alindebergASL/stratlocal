import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { db } from "../db";
import { localSettings, packageRow } from "./store";
import { claim, heartbeat, assertLease, finish } from "./queue";
import { parsePackage, stagePackage } from "./packages";
import { runDraft, type DraftInput } from "./models";
import { MAX_PACKAGE_BYTES } from "./zip";

export async function processNext(owner = randomUUID()) {
  const task = claim(owner);
  if (!task) return false;
  const abort = new AbortController();
  const timer = setInterval(() => {
    try {
      heartbeat(task.id, owner, "Processing");
    } catch {
      abort.abort();
    }
  }, 10_000);
  const check = () => {
    assertLease(task.id, owner);
    if (abort.signal.aborted) throw new Error("Task cancelled");
  };
  try {
    const input = JSON.parse(task.payload_json);
    const result =
      task.kind === "import"
        ? await parsePackage(
            input.packageId,
            input.accountId,
            abort.signal,
            check,
          )
        : task.kind === "draft"
          ? await runDraft(
              task.id,
              task.created_by,
              input as DraftInput,
              abort.signal,
              check,
            )
          : (() => {
              throw new Error("Unknown task kind");
            })();
    check();
    finish(task.id, owner, result);
  } catch (e) {
    const error = e instanceof Error ? e.message : "Task failed";
    finish(task.id, owner, null, error);
  } finally {
    clearInterval(timer);
  }
  return true;
}
const observed = new Map<
  string,
  { size: number; mtime: number; seenAt: number }
>();
export function exchangeRoot() {
  // A server-side mount, never a path supplied in an upload or model response.
  return process.env.STRATEGY_EXCHANGE_DIR
    ? path.resolve(process.env.STRATEGY_EXCHANGE_DIR)
    : null;
}
export function scanExchange(now = Date.now()) {
  const root = exchangeRoot();
  if (!root || !localSettings().watchEnabled) return;
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(root).isSymbolicLink())
    throw new Error("Exchange directory cannot be a symlink");
  for (const sub of ["Requests", "Incoming", "Processed"]) {
    const dir = path.join(root, sub);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(dir).isSymbolicLink())
      throw new Error("Exchange subdirectories cannot be symlinks");
  }
  const user = (
    db().prepare("SELECT id FROM users ORDER BY created_at LIMIT 1").get() as
      | { id: string }
      | undefined
  )?.id;
  if (!user) return;
  const incoming = path.join(root, "Incoming");
  for (const entry of fs
    .readdirSync(incoming, { withFileTypes: true })
    .slice(0, 200)) {
    if (
      !entry.isFile() ||
      entry.name.startsWith(".") ||
      /\.(part|tmp|download)$/i.test(entry.name)
    )
      continue;
    const full = path.join(incoming, entry.name),
      stat = fs.statSync(full);
    if (stat.size > MAX_PACKAGE_BYTES || !stat.size) continue;
    const old = observed.get(full);
    if (!old || old.size !== stat.size || old.mtime !== stat.mtimeMs) {
      observed.set(full, { size: stat.size, mtime: stat.mtimeMs, seenAt: now });
      continue;
    }
    if (now - old.seenAt < 5000) continue;
    const bytes = fs.readFileSync(full),
      hash = createHash("sha256").update(bytes).digest("hex");
    let receipt = db()
      .prepare("SELECT package_id FROM local_folder_receipts WHERE sha256=?")
      .get(hash) as { package_id: string } | undefined;
    if (!receipt) {
      const p = stagePackage(entry.name, bytes, user);
      db()
        .prepare(
          "INSERT INTO local_folder_receipts(sha256,filename,package_id) VALUES(?,?,?)",
        )
        .run(hash, entry.name, p.id);
      receipt = { package_id: p.id };
    }
    const p = packageRow(receipt.package_id);
    if (p && ["review", "proposed"].includes(p.state)) {
      const destination = path.join(
        root,
        "Processed",
        `${hash.slice(0, 16)}-${entry.name}`,
      );
      // Recheck before moving a file another process may still be changing.
      if (
        createHash("sha256").update(fs.readFileSync(full)).digest("hex") !==
        hash
      )
        continue;
      if (!fs.existsSync(destination)) fs.renameSync(full, destination);
      db()
        .prepare("UPDATE local_folder_receipts SET moved_at=? WHERE sha256=?")
        .run(now, hash);
      observed.delete(full);
    }
  }
}
const g = globalThis as unknown as { localWorkerStarted?: boolean };
export function startLocalWorker() {
  if (g.localWorkerStarted) return;
  g.localWorkerStarted = true;
  const owner = randomUUID();
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      try {
        scanExchange();
      } catch (e) {
        console.error(
          "[local-exchange]",
          e instanceof Error ? e.message : "failed",
        );
      }
      await processNext(owner);
    } catch (e) {
      console.error(
        "[local-worker]",
        e instanceof Error ? e.message : "failed",
      );
    } finally {
      busy = false;
    }
  }, 2000);
  timer.unref();
}
