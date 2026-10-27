// Runs the browser flows against a real build of the app.
//
// These flows are the only end-to-end coverage there is, and until now they
// lived in a scratch directory outside the repo. They caught the merge that
// went the wrong way round and two assertions of mine that proved nothing, and
// they were one `rm -rf /tmp` from gone.
//
//   npm run e2e                  everything
//   npm run e2e -- two-people    one flow
//
// It builds, starts the standalone server against a throwaway database with
// AI_FAKE=1 and two seeded users, runs each flow once, and stops the server
// whatever happens. A flow gets a fresh database, because flows that share one
// pass or fail depending on the order they ran in.
//
// The browser: `npx playwright install chromium` once, or point
// PLAYWRIGHT_CHROMIUM_PATH at one the machine already has. Playwright itself
// is a devDependency, so a clean clone needs nothing else.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(HERE, "..");
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE = `http://localhost:${PORT}`;

const FLOWS = ["import-and-review", "deal-merge", "person-merge", "record-merge", "account-merge", "two-people", "meeting-notes", "invite", "follow-ups", "review", "ownership", "spreadsheet", "handoff", "research", "research-workflow", "ux-recovery", "useful-brief", "partner-freshness", "weight", "widths", "layout-slice", "type-usability", "first-glance", "post-meeting", "dogfood-handoffs", "planning-workspace", "assistants", "calendar", "account-watch", "plan-keeper", "handoff-writer", "ask", "friday-close", "playbook", "team", "navigation", "imports", "our-work", "keyboard", "inbox", "today-briefing", "account-living", "ask-web", "mail", "outbound", "writer", "cleanup"];

// Extra server environment for one flow. The research workflow needs the fake
// answer to contain a suggestion the saved evidence does not support, so the
// withheld path is walked by a browser rather than only by a unit test. It is
// a replay fixture and it is off everywhere else, so no other flow's "AI
// succeeded" means anything different than it did before.
//
// The assistants flow knocks on the scheduler's door, so its server is given
// a secret; every other flow runs with none, which is how the door stays shut.
// The calendar flow serves its own feed on loopback, which only its server may
// read; everywhere else a link to a private address is refused.
const SCHEDULER_SECRET = "synthetic-e2e-scheduler-secret-0123456789";
const FLOW_ENV = { "research-workflow": { AI_FAKE_REPLAY: "withheld-update" }, assistants: { SCHEDULER_SECRET }, calendar: { CALENDAR_ALLOW_PRIVATE_URLS: "1" }, ask: { AI_FAKE_DRAFT_MS: "1500" }, research: { AI_FAKE_RESEARCH_MS: "1500" }, playbook: { SALESFORCE_FAKE: "1" }, mail: { MAIL_FAKE: "1" }, outbound: { MAIL_FAKE: "1" }, "today-briefing": { SCHEDULER_SECRET, INTEGRATIONS_KEY: "c3ludGhldGljLWUyZS1rZXktMDEyMzQ1Njc4OWFiY2Q=", NOTIFY_ALLOW_PRIVATE_URLS: "1" } };
const wanted = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const flows = wanted.length > 0 ? wanted : FLOWS;
for (const f of flows) {
  if (!FLOWS.includes(f)) {
    console.error(`no such flow: ${f}\nthere is: ${FLOWS.join(", ")}`);
    process.exit(2);
  }
}

const USERS = {
  E2E_USER1_EMAIL: "alex@e2e.local",
  E2E_USER1_PASSWORD: "e2e-password-one",
  E2E_USER2_EMAIL: "jamie@e2e.local",
  E2E_USER2_PASSWORD: "e2e-password-two",
};

function stop(child, graceMs = 3000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    child.once("exit", done);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      child.once("exit", done);
    }, graceMs);
    child.kill("SIGTERM");
  });
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", ...opts });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
    p.on("error", reject);
  });
}

async function waitForServer(deadlineMs = 60_000) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${BASE}/login`);
      if (r.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`the server never answered on ${BASE}`);
}

// Refuse to run against something already listening. waitForServer is happy
// with any answer on the port, so a server left over from a previous run — old
// build, old database, old passwords — silently becomes the thing under test,
// and the failure it produces looks like a bug in the app.
//
// Checked before every flow rather than once at the top: the build takes tens
// of seconds, and the collision that actually happens is a server from the
// previous flow that outlived its kill.
async function portIsFree() {
  try {
    await fetch(`${BASE}/login`);
    return false;
  } catch {
    return true;
  }
}

if (!(await portIsFree())) {
  console.error(`something is already listening on ${BASE}. Stop it, or set E2E_PORT to a free port.`);
  process.exit(2);
}

if (process.env.E2E_SKIP_BUILD !== "1") {
  console.log("building…");
  await run("npm", ["run", "build"], { cwd: ROOT, stdio: "ignore" });
  // next build --standalone leaves these out; the server needs them.
  await run("cp", ["-r", ".next/static", ".next/standalone/.next/static"], { cwd: ROOT, stdio: "ignore" });
}

let failures = 0;
for (const flow of flows) {
  if (!(await portIsFree())) {
    console.error(`  ${BASE} is still busy — the previous flow's server outlived its shutdown`);
    failures += 1;
    break;
  }
  const dataDir = mkdtempSync(join(tmpdir(), "strategy-e2e-"));
  // Held by pid, never found by name: matching a process by its command line
  // also matches the shell that is asking, which is a good way to kill
  // yourself halfway through a test run.
  const server = spawn("node", [join(ROOT, ".next/standalone/server.js")], {
    cwd: join(ROOT, ".next/standalone"),
    stdio: process.env.E2E_SERVER_LOG === "1" ? "inherit" : "ignore",
    env: {
      ...process.env,
      AI_FAKE: "1",
      PORT: String(PORT),
      DB_PATH: join(dataDir, "app.db"),
      USER1_EMAIL: USERS.E2E_USER1_EMAIL,
      USER1_PASSWORD: USERS.E2E_USER1_PASSWORD,
      USER1_NAME: "Alex",
      USER2_EMAIL: USERS.E2E_USER2_EMAIL,
      USER2_PASSWORD: USERS.E2E_USER2_PASSWORD,
      USER2_NAME: "Jamie",
      ...(FLOW_ENV[flow] ?? {}),
    },
  });

  try {
    await waitForServer();
    console.log(`\n${flow}`);
    await run("node", [join(HERE, `${flow}.mjs`)], { cwd: ROOT, env: { ...process.env, ...USERS, BASE, E2E_DB_PATH: join(dataDir, "app.db"), E2E_SCHEDULER_SECRET: SCHEDULER_SECRET } });
  } catch (e) {
    failures += 1;
    console.error(`  ${e instanceof Error ? e.message : e}`);
  } finally {
    // Wait for the process to actually be gone, not for a signal to have been
    // delivered. `server.killed` means the latter — it is true the moment
    // SIGTERM is sent — so the SIGKILL fallback here never once fired, and
    // deleting the data directory raced a server that might still be writing
    // to it. A survivor also holds the port, and the next flow would then
    // quietly test against it.
    await stop(server);
    rmSync(dataDir, { recursive: true, force: true });
  }
}

console.log(failures === 0 ? `\n${flows.length} flow${flows.length === 1 ? "" : "s"} passed` : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
