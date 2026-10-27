// Back up the database and the uploaded reports, and prove it worked.
//
// The obvious version of this — copy strategy.sqlite to S3 nightly — backs up
// nothing. SQLite in WAL mode leaves committed data in the -wal file until a
// checkpoint, and this app runs with the default autocheckpoint: at the time
// this was written the live database was 4 KB beside a 1.8 MB WAL. A copy of
// the .sqlite file alone would have restored an empty app, and would have kept
// doing it every night without a single error.
//
// `VACUUM INTO` is the fix and is why this is a node script rather than a
// shell one: it asks SQLite for a single consistent file including everything
// in the WAL, needs no sqlite3 binary in the image, and better-sqlite3 is
// already a dependency. The result is then opened and counted, because an
// exit code proves only that a file was written.
//
//   node scripts/backup.mjs                    write a snapshot under data/backups
//   node scripts/backup.mjs --to /some/dir     somewhere else
//   BACKUP_S3_URI=s3://bucket/prefix node scripts/backup.mjs   and copy it up
//
// Restoring is documented in deploy/README.md and is deliberately manual:
// stopping the app and moving a file is a thing a person should do on purpose.
import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";

const DB_PATH = process.env.DB_PATH || join(process.cwd(), "data", "strategy.sqlite");
const DATA_DIR = dirname(DB_PATH);
const DOCS_DIR = join(DATA_DIR, "docs");
const S3_URI = process.env.BACKUP_S3_URI || "";
const KEEP = Number(process.env.BACKUP_KEEP ?? 14);

const toIndex = process.argv.indexOf("--to");
const OUT_DIR = toIndex >= 0 ? process.argv[toIndex + 1] : join(DATA_DIR, "backups");

function die(message) {
  console.error(`backup failed: ${message}`);
  process.exit(1);
}

if (!existsSync(DB_PATH)) die(`no database at ${DB_PATH}`);
mkdirSync(OUT_DIR, { recursive: true });

// Local midnight would be ambiguous twice a year and these sort by name.
const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "Z");
const work = mkdtempSync(join(tmpdir(), "strategy-backup-"));
const snapshot = join(work, "strategy.sqlite");

// ---- the snapshot ----------------------------------------------------------

let rowCounts;
try {
  const source = new Database(DB_PATH, { readonly: true });
  // Everything in the WAL included, as one file, without pausing the app.
  source.prepare("VACUUM INTO ?").run(snapshot);
  rowCounts = counts(source);
  source.close();
} catch (e) {
  die(`could not snapshot: ${e instanceof Error ? e.message : e}`);
}

function counts(conn) {
  const of = (table) => {
    try {
      return conn.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    } catch {
      return -1;
    }
  };
  return { accounts: of("accounts"), deals: of("deals"), meetings: of("meetings"), change_log: of("change_log") };
}

// ---- prove it is a database, and that it holds what the live one holds -----

try {
  const restored = new Database(snapshot, { readonly: true });
  const integrity = restored.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") die(`integrity check on the snapshot said "${integrity}"`);
  const back = counts(restored);
  restored.close();
  for (const [table, n] of Object.entries(rowCounts)) {
    // Fewer rows than the source means the snapshot missed writes — which is
    // exactly what copying the .sqlite file alone does, silently.
    if (back[table] < n) die(`snapshot has ${back[table]} ${table} rows against ${n} live`);
  }
  console.log(`snapshot ok: ${Object.entries(back).map(([t, n]) => `${n} ${t}`).join(", ")}`);
} catch (e) {
  die(`snapshot did not open: ${e instanceof Error ? e.message : e}`);
}

// ---- the uploaded reports go with it ---------------------------------------

const archive = join(OUT_DIR, `strategy-${stamp}.tar.gz`);
const tarArgs = ["-czf", archive, "-C", work, "strategy.sqlite"];
if (existsSync(DOCS_DIR) && readdirSync(DOCS_DIR).length > 0) {
  tarArgs.push("-C", DATA_DIR, basename(DOCS_DIR));
}
const tar = spawnSync("tar", tarArgs, { stdio: "inherit" });
// `status` is null when the binary is missing, and "exited null" is how the
// S3 half of this script hid its own absent dependency for a whole phase.
if (tar.error?.code === "ENOENT") die("tar is not installed in this image");
if (tar.status !== 0) die(`tar exited ${tar.status}`);
rmSync(work, { recursive: true, force: true });
console.log(`wrote ${archive} (${(statSync(archive).size / 1024).toFixed(0)} KB)`);

// ---- keep the last few -----------------------------------------------------
//
// Before the offsite copy, not after. die() exits, so an upload that fails —
// which is exactly what happened every night while this shelled out to an
// `aws` binary the image did not install — also meant retention never ran, and
// the local pile grew without limit on top of nothing going offsite.

const mine = readdirSync(OUT_DIR)
  .filter((f) => f.startsWith("strategy-") && f.endsWith(".tar.gz"))
  .sort()
  .reverse();
for (const old of mine.slice(KEEP)) rmSync(join(OUT_DIR, old), { force: true });
if (mine.length > KEEP) console.log(`kept the newest ${KEEP}, removed ${mine.length - KEEP}`);

// ---- offsite ---------------------------------------------------------------

if (S3_URI) {
  // The SDK, not `aws s3 cp`.
  //
  // This shelled out to the AWS CLI, which the deployment image does not
  // install — so spawnSync returned ENOENT, `status` was null, and the script
  // died with "aws s3 cp exited null" every night while every snapshot stayed
  // on the same disk as the database it was protecting. The one job the
  // offsite copy exists to do was the one thing that never happened, and it
  // would have gone on not happening until the box was lost.
  //
  // Same instance-role credential chain, no system package, and it can be
  // asked afterwards whether the object is actually there — which is the habit
  // the rest of this script already has.
  const m = /^s3:\/\/([^/]+)\/?(.*)$/.exec(S3_URI.replace(/\/$/, ""));
  if (!m) die(`BACKUP_S3_URI should look like s3://bucket/prefix, not "${S3_URI}"`);
  const [, bucket, prefix] = m;
  const key = prefix ? `${prefix}/${basename(archive)}` : basename(archive);

  const { S3Client, PutObjectCommand, HeadObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({ region: process.env.AWS_REGION });
  const size = statSync(archive).size;
  // Encrypted at rest, asked for rather than assumed: with a KMS key when
  // BACKUP_S3_KMS_KEY names one (the role then needs kms:GenerateDataKey and
  // kms:Decrypt on it), S3's own keys otherwise. The snapshot holds customer
  // records and up to 30 days of email.
  const kms = (process.env.BACKUP_S3_KMS_KEY ?? "").trim();
  const sse = kms ? { ServerSideEncryption: "aws:kms", SSEKMSKeyId: kms } : { ServerSideEncryption: "AES256" };
  try {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: createReadStream(archive), ContentLength: size, ...sse }));
  } catch (e) {
    // Named, because the three ways this fails on a first deploy read nothing
    // alike: no credentials at all (the instance metadata hop limit, almost
    // always), credentials without s3:PutObject on the prefix, or the wrong
    // bucket. deploy/README.md covers the first.
    die(`could not upload to s3://${bucket}/${key}: ${e instanceof Error ? `${e.name}: ${e.message}` : e}`);
  }
  // An upload that returns 200 and a bucket lifecycle rule that deletes it an
  // hour later both exit zero. Ask.
  let head;
  try {
    head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    if (head.ContentLength !== size) die(`uploaded ${size} bytes but s3 holds ${head.ContentLength}`);
    if (!head.ServerSideEncryption) die(`s3://${bucket}/${key} is not encrypted at rest`);
  } catch (e) {
    die(`uploaded to s3://${bucket}/${key} but could not read it back: ${e instanceof Error ? `${e.name}: ${e.message}` : e}`);
  }
  console.log(`copied to s3://${bucket}/${key} (${(size / 1024).toFixed(0)} KB, ${head.ServerSideEncryption}, confirmed)`);
} else {
  console.log("BACKUP_S3_URI is not set, so this snapshot is on the same disk as the database it came from");
}
