// Is this deployment actually wired up?
//
// Nothing here has ever met real AWS and no model call has been made against a
// real provider, so the first hour after the first deploy is where it will go
// wrong — and every one of those failures reads, from a screen, as "the button
// is broken". This is one page that says which part is not connected, and it
// is safe to open any time: a rotated key, a changed bucket policy and a
// rebuilt instance all show up here first.
import fs from "node:fs";
import path from "node:path";
import { db, DB_PATH, DOCS_DIR } from "./db";
import { appTimeZone, todayISO, nowHHMM } from "./clock";
import { currentFiscalQuarter, fiscalYearStartMonth } from "./fiscal";
import { dailyCapCents, todaySpend } from "./ai/guard";
import { ROLES } from "./ai/models";
import { priceFor } from "./ai/models";
import { providerProblem } from "./ai/client";
import { fakeEnabled } from "./ai/fake";
import { lastTick, MIN_SECRET_LENGTH, schedulerSecret } from "./assistants/scheduler";
import { ASSISTANTS } from "./assistants/registry";
import { assistantMode } from "./assistants/settings";
import { sealingReady } from "./crypto/secretBox";
import { googleConfigured, googleServiceEmail, graphConfigured } from "./calendar/providers";
import { localOnly } from "./localMode";

export type CheckState = "ok" | "warn" | "bad";

export type SetupCheck = {
  label: string;
  state: CheckState;
  /** What it is, when it is fine. */
  value?: string;
  /** What to do, when it is not. */
  detail?: string;
};

function writable(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// The database, and the mistake that costs the most on day one.
//
// DB_PATH's default is relative to process.cwd(), and under the standalone
// server that is .next/standalone — so an unset DB_PATH puts the database and
// every uploaded report inside the image layer, where the next
// `up --force-recreate` destroys them. deploy/compose.yml sets it and
// deploy/README.md warns about it; neither is visible from a running app.
export function databaseChecks(): SetupCheck[] {
  const out: SetupCheck[] = [];
  const resolved = DB_PATH === ":memory:" ? ":memory:" : path.resolve(DB_PATH);
  const explicit = Boolean(process.env.DB_PATH);
  const inBuild = resolved.includes(`${path.sep}.next${path.sep}`);
  out.push({
    label: "Database file",
    state: inBuild ? "bad" : explicit ? "ok" : "warn",
    value: resolved,
    detail: inBuild
      ? "This is inside the build output, which is part of the image: the next `docker compose up --force-recreate` deletes it along with every uploaded report. Set DB_PATH to a path on the mounted volume (deploy/compose.yml does)."
      : explicit
        ? undefined
        : "DB_PATH is not set, so this path came from the working directory. That is fine locally and dangerous in a container — set it explicitly.",
  });

  const dir = path.dirname(resolved);
  out.push({
    label: "Database directory is writable",
    state: resolved === ":memory:" || writable(dir) ? "ok" : "bad",
    value: dir,
    detail: resolved === ":memory:" || writable(dir) ? undefined : "The app cannot write here. Check the volume mount and the container's user id.",
  });

  out.push({
    label: "Uploads directory",
    state: writable(DOCS_DIR) ? "ok" : "bad",
    value: DOCS_DIR,
    detail: writable(DOCS_DIR) ? undefined : "Imported reports are stored here and cannot be written.",
  });

  try {
    const conn = db();
    const mode = (conn.pragma("journal_mode", { simple: true }) as string) ?? "";
    out.push({
      label: "Write-ahead logging",
      state: mode.toLowerCase() === "wal" ? "ok" : "warn",
      value: mode,
      // Not cosmetic: with WAL on, a backup that copies the database file
      // alone restores something with no tables in it. scripts/backup.mjs uses
      // VACUUM INTO for exactly this reason.
      detail: mode.toLowerCase() === "wal" ? undefined : "Expected WAL. The backup and the concurrency behaviour both assume it.",
    });
    const version = conn.prepare(`SELECT COUNT(*) AS n FROM schema_migrations`).get() as { n: number };
    const counts = conn
      .prepare(
        `SELECT (SELECT COUNT(*) FROM accounts WHERE kind = 'customer') a, (SELECT COUNT(*) FROM deals) d,
                (SELECT COUNT(*) FROM meetings) m, (SELECT COUNT(*) FROM change_log) c,
                (SELECT COUNT(*) FROM users) u`,
      )
      .get() as { a: number; d: number; m: number; c: number; u: number };
    out.push({ label: "Migrations applied", state: "ok", value: String(version.n) });
    out.push({
      label: "What is in it",
      state: counts.u > 0 ? "ok" : "bad",
      value: `${counts.u} user${counts.u === 1 ? "" : "s"} · ${counts.a} accounts · ${counts.d} deals · ${counts.m} meetings · ${counts.c} history rows`,
      detail: counts.u > 0 ? undefined : "No users, so nobody can sign in. Set USER1_EMAIL and USER1_PASSWORD and restart — they are only seeded when the table is empty.",
    });
  } catch (e) {
    out.push({ label: "Database", state: "bad", value: "unreadable", detail: e instanceof Error ? e.message : String(e) });
  }
  return out;
}

// What day the app thinks it is. Wrong here and every "overdue", every
// "coming up" and every date stamped on a record is wrong with it.
export function clockChecks(now = new Date()): SetupCheck[] {
  const zone = appTimeZone();
  const configured = Boolean(process.env.APP_TIMEZONE);
  return [
    {
      label: "Timezone",
      state: "ok",
      value: zone,
      detail: configured ? undefined : "APP_TIMEZONE is not set, so this is the default. Set it if the two of you are not on US Pacific.",
    },
    { label: "Today, here", state: "ok", value: `${todayISO(now)} at ${nowHHMM(now)}` },
    {
      label: "Fiscal quarter",
      state: "ok",
      value: `${currentFiscalQuarter(now).label} (year starts in month ${fiscalYearStartMonth()})`,
      detail: process.env.FISCAL_YEAR_START_MONTH ? undefined : "FISCAL_YEAR_START_MONTH is not set, so this is the default of August.",
    },
  ];
}

// Money, and whether the cap can be trusted at all.
export function budgetChecks(): SetupCheck[] {
  const spend = todaySpend();
  const cap = dailyCapCents();
  const out: SetupCheck[] = [
    {
      label: "Daily cap",
      state: cap === 0 ? "warn" : "ok",
      value: cap === 0 ? "$0.00 — model calls are off" : `$${(cap / 100).toFixed(2)}`,
      detail: cap === 0 ? "Every run will be refused until AI_DAILY_CAP_CENTS is raised." : undefined,
    },
    {
      label: "Spent today",
      state: spend.unpriced > 0 ? "warn" : "ok",
      value: `$${(spend.cents / 100).toFixed(2)} across ${spend.runs} run${spend.runs === 1 ? "" : "s"}`,
      detail:
        spend.unpriced > 0
          ? `${spend.unpriced} of those have unknown cost because usage or pricing is missing. They are not free: the start-of-run budget gate reserves for them. Check provider usage and configured rates before authorizing more spending.`
          : undefined,
    },
  ];
  // Whether the models actually configured have a price at all, which is what
  // decides whether the cap means anything tomorrow as well as today.
  for (const [role, spec] of Object.entries(ROLES)) {
    if (role !== "import" && role !== "research") continue; // one per provider is enough
    const price = priceFor(spec.provider, spec.model);
    out.push({
      label: `Price for ${spec.provider}`,
      state: price ? (price.estimated ? "warn" : "ok") : "bad",
      value: spec.model,
      detail: !price
        ? "No price is known for this model id, so its runs record no cost and the daily cap silently stops working."
        : price.estimated
          ? "Derived from Anthropic's list prices, because AWS does not publish Bedrock's rates anywhere this app can read. Set AI_PRICE_… to make the figures exact."
          : undefined,
    });
  }
  return out;
}

// Whether a form submit will work at all behind the proxy.
//
// An allowedOrigins mismatch is the most confusing failure in the whole
// deployment: every page renders perfectly and every single form submit 403s.
export function originChecks(host: string | null, forwardedHost: string | null): SetupCheck[] {
  const configured = (process.env.APP_HOSTNAME ?? "").trim();
  const arriving = forwardedHost || host || "";
  if (!configured) {
    return [
      {
        label: "Server action origins",
        state: arriving.startsWith("localhost") || arriving.startsWith("127.0.0.1") ? "ok" : "warn",
        value: arriving || "unknown",
        detail:
          "APP_HOSTNAME is not set. Behind a proxy that is how next.config.ts allows form submits, and without it every page renders while every save returns 403.",
      },
    ];
  }
  const match = arriving === configured || arriving.startsWith(`${configured}:`);
  return [
    {
      label: "Server action origins",
      state: match ? "ok" : "bad",
      value: `arriving as ${arriving || "unknown"}, configured as ${configured}`,
      detail: match ? undefined : "These must match, or every form submit returns 403 while every page still renders.",
    },
  ];
}

export function providerChecks(): SetupCheck[] {
  if (localOnly()) return [{ label: "Research and imports", state: "ok", value: "Local only — cloud AI off", detail: "Prompt MyAgent separately, then import its structured JSON or keep its documents here. Bedrock and Anthropic credentials are not required." }];
  if (fakeEnabled()) {
    return [
      {
        label: "Providers",
        state: "warn",
        value: "AI_FAKE=1",
        detail: "Every model call is canned. Nothing reaches Bedrock or the Anthropic API — unset AI_FAKE to use the real ones.",
      },
    ];
  }
  return (["bedrock", "direct"] as const).map((p) => {
    const problem = providerProblem(p);
    return {
      label: p === "bedrock" ? "Bedrock (everything with customer data)" : "Anthropic API (web research only)",
      state: problem ? "bad" : "ok",
      value: problem ? "not configured" : (p === "bedrock" ? ROLES.import.model : ROLES.research.model),
      detail: problem ?? "Configured. Press Check providers on Home to make a real call and see whether it answers.",
    };
  });
}

export type BackupCheck = SetupCheck & { newest?: { key: string; at: string; bytes: number } };

// Whether the nightly snapshot is actually reaching S3, read from S3 rather
// than from anything this app writes down — so it is true even when the backup
// container has been failing silently for a week.
// How long any one check may take before the page gives up on it.
//
// Not a nicety. Pointed at an address that drops packets — which is what a
// security group with no egress rule, or a missing S3 VPC endpoint, looks like
// from inside the container — this page hung past 130 seconds and had to be
// killed. The AWS SDK's Node handler has no request timeout by default and
// retries three times, so "unreachable" and "slow" are the same thing to it
// and neither ever ends.
//
// A diagnostics page that can be hung by the thing it is diagnosing is worse
// than no diagnostics page: on the day you open it, it is the one screen you
// cannot get an answer out of.
const CHECK_TIMEOUT_MS = 6000;

// Belt and braces, deliberately. The SDK timeouts below bound the socket; this
// bounds the whole call including retries, DNS, and anything the SDK does that
// its own options do not cover. One of the two is redundant on any given
// failure and there is no way to know in advance which.
async function within<T>(ms: number, work: () => Promise<T>, onTimeout: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = Symbol("expired");
  try {
    const result = await Promise.race([
      work(),
      new Promise<typeof expired>((resolve) => {
        timer = setTimeout(() => resolve(expired), ms);
      }),
    ]);
    return result === expired ? onTimeout() : (result as T);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function backupCheck(): Promise<BackupCheck> {
  if (localOnly()) return { label: "Local backup", state: "warn", value: "Manual backup and restore", detail: "Use deploy/local/backup.sh and verify a restore using deploy/local/README.md. This check does not verify that a backup exists. S3 is not required and is not contacted." };
  const uri = (process.env.BACKUP_S3_URI ?? "").trim();
  if (!uri) {
    return {
      label: "Offsite backup",
      state: "bad",
      value: "not configured",
      detail: "BACKUP_S3_URI is not set, so every snapshot stays on the same disk as the database it is protecting.",
    };
  }
  const m = /^s3:\/\/([^/]+)\/?(.*)$/.exec(uri);
  if (!m) {
    return { label: "Offsite backup", state: "bad", value: uri, detail: "Expected s3://bucket/prefix." };
  }
  const [, bucket, prefix] = m;
  const timedOut = (): BackupCheck => ({
    label: "Offsite backup",
    state: "bad",
    value: uri,
    detail: `S3 did not answer within ${CHECK_TIMEOUT_MS / 1000} seconds. Packets are being dropped rather than refused, which from inside a container means a security group with no egress rule, or a VPC endpoint that is not there. A refused connection would have come back immediately with a different message.`,
  });

  return within(CHECK_TIMEOUT_MS, async (): Promise<BackupCheck> => {
    try {
      const { S3Client, ListObjectsV2Command, HeadObjectCommand } = await import("@aws-sdk/client-s3");
      const s3 = new S3Client({
        region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION,
        // One attempt: this is a diagnostic, and three tries with backoff turns
        // a five-second answer into a twenty-second one for no extra truth.
        maxAttempts: 1,
        // throwOnRequestTimeout, or requestTimeout only logs a warning and
        // lets the request run on — which would leave the race below as the
        // only thing actually ending the call.
        requestHandler: { connectionTimeout: CHECK_TIMEOUT_MS, requestTimeout: CHECK_TIMEOUT_MS, throwOnRequestTimeout: true },
      });
      const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix || undefined, MaxKeys: 1000 }));
      const objects = (res.Contents ?? []).filter((o) => o.Key && o.LastModified);
      if (objects.length === 0) {
        return {
          label: "Offsite backup",
          state: "bad",
          value: uri,
          detail: "The bucket is reachable and there is nothing under this prefix. The backup has never succeeded.",
        };
      }
      const newest = objects.reduce((a, b) => (a.LastModified! > b.LastModified! ? a : b));
      const oldest = objects.reduce((a, b) => (a.LastModified! < b.LastModified! ? a : b));
      const ageHours = (Date.now() - newest.LastModified!.getTime()) / 3_600_000;
      const oldestDays = Math.floor((Date.now() - oldest.LastModified!.getTime()) / 86_400_000);
      const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: newest.Key! }));
      const encrypted = head.ServerSideEncryption ?? null;
      // Email bodies are kept 30 days in the app, so a snapshot kept much
      // longer keeps them longer: a 30-day lifecycle rule on the prefix ends it.
      const problems = [
        ageHours <= 36 ? null : "The newest snapshot is more than a day and a half old. Check the backup container's logs.",
        encrypted ? null : "The newest snapshot is not encrypted at rest. Deploy the current backup script, which asks for it.",
        oldestDays <= 35 ? null : `The oldest snapshot is ${oldestDays} days old: add a lifecycle rule that expires this prefix after 30 days.`,
      ].filter(Boolean);
      return {
        label: "Offsite backup",
        // A nightly job that has not run in two days is the thing you want to
        // find here rather than on the day you need it.
        state: ageHours > 36 || !encrypted ? "bad" : problems.length ? "warn" : "ok",
        value: `${newest.Key} · ${Math.round(ageHours)}h ago · ${Math.round((newest.Size ?? 0) / 1024)} KB · ${encrypted ? `encrypted (${encrypted})` : "not encrypted"} · ${objects.length} kept, oldest ${oldestDays}d`,
        detail: problems.length ? problems.join(" ") : undefined,
        newest: { key: newest.Key!, at: newest.LastModified!.toISOString(), bytes: newest.Size ?? 0 },
      };
    } catch (e) {
      const { explainProviderError } = await import("./ai/client");
      return { label: "Offsite backup", state: "bad", value: uri, detail: explainProviderError(e) };
    }
  }, timedOut);
}

// Running on its own (DECISIONS #99): the scheduler's secret, when it last
// knocked, which assistants it will start, and the key that seals Slack and
// Teams addresses.
export function schedulerChecks(now = Date.now()): SetupCheck[] {
  const secret = schedulerSecret();
  const last = lastTick();
  const autos = ASSISTANTS.filter((a) => a.availability === "modes" && assistantMode(a.id) === "auto").map((a) => a.name);
  const raw = (process.env.SCHEDULER_SECRET ?? "").trim();
  return [
    {
      label: "Scheduler secret",
      state: secret ? "ok" : "warn",
      value: secret ? "set" : undefined,
      detail: secret ? undefined : raw ? `SCHEDULER_SECRET is shorter than ${MIN_SECRET_LENGTH} characters, so nothing starts on its own.` : "SCHEDULER_SECRET is not set, so assistants run only when someone presses Run now.",
    },
    {
      label: "Last check-in",
      state: !secret ? "warn" : last && now - last < 15 * 60_000 ? "ok" : "bad",
      value: last ? new Date(last).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "never",
      detail: secret && !(last && now - last < 15 * 60_000) ? "The scheduler container has not knocked in the last 15 minutes. Is it running, and does it have the same secret?" : undefined,
    },
    { label: "On their own", state: "ok", value: autos.length ? autos.join(", ") : "none yet (Assistants → Turn on the recommended four)" },
    {
      label: "Connections key",
      state: sealingReady() ? "ok" : "warn",
      value: sealingReady() ? "set" : undefined,
      detail: sealingReady() ? undefined : "INTEGRATIONS_KEY is not set (openssl rand -base64 32), so nobody can connect Slack or Teams.",
    },
  ];
}

// Mail and calendars (DECISIONS #102, #103): which providers this server can
// use, whose mailboxes are being read and whether the last read worked, who
// may send, and that email bodies really go after 30 days. Read from this
// app's own tables; it never calls a provider (Read now does that).
export function mailChecks(now = Date.now()): SetupCheck[] {
  const graph = graphConfigured();
  const google = googleConfigured();
  const conn = db();
  const sources = conn.prepare(`SELECT kind, enabled, last_read_at, last_error, can_send FROM mail_sources`).all() as Array<{ kind: string; enabled: number; last_read_at: number | null; last_error: string | null; can_send: number }>;
  const on = sources.filter((s) => s.enabled);
  const failing = on.filter((s) => s.last_error);
  const unread = on.filter((s) => !s.last_read_at && !s.last_error);
  const stale = (conn.prepare(`SELECT COUNT(*) n FROM mail_messages WHERE body_text IS NOT NULL AND received_at < ?`).get(now - 31 * 86_400_000) as { n: number }).n;
  return [
    {
      label: "Microsoft 365",
      // One provider is enough: the other unset is only worth a warning when neither is.
      state: graph && google ? "warn" : "ok",
      value: graph ? "not set up" : "configured",
      detail: graph
        ? `${graph} Without it nobody can connect an Outlook mailbox or calendar.`
        : "Needs the Graph application permissions Mail.Read, Mail.Send and Calendars.ReadWrite, limited to the team's mailboxes. Read now on Settings → Connections proves the read.",
    },
    {
      label: "Google",
      state: graph && google ? "warn" : "ok",
      value: google ? "not set up" : `configured (${googleServiceEmail()})`,
      detail: google ? google : "Domain-wide delegation needs gmail.readonly, gmail.send, calendar.readonly and calendar.events for the service account's client id.",
    },
    {
      label: "Mailboxes read",
      state: failing.length ? "bad" : "ok",
      value: on.length ? `${on.length} connected${failing.length ? `, ${failing.length} failing` : ""}${unread.length ? `, ${unread.length} not read yet` : ""}` : "none yet",
      detail: failing.length ? "The person sees why on Settings → Connections; most often a permission the app registration or delegation is missing." : undefined,
    },
    { label: "Sending", state: "ok", value: `${on.filter((s) => s.can_send).length} of ${on.length} turned on` },
    {
      label: "Email kept 30 days",
      state: stale ? "bad" : "ok",
      value: stale ? `${stale} older bodies still kept` : "yes",
      detail: stale ? "Bodies are cleared on every scheduler tick. Is the scheduler running?" : undefined,
    },
  ];
}
