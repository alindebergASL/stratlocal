// What a page weighs, and how long it takes, at the size this app is for.
//
// The numbers in STATUS came from a measurement done by hand whose method was
// never committed — so when the load fixture changed underneath them they went
// quietly wrong, and the first anyone knew was a budget set from a
// three-finding demo note against a page that weighs a quarter of a megabyte.
// This is that measurement, written down, so the documented numbers come from
// a command anyone can run (DECISIONS #21).
//
// It is deliberately not a pass/fail check: e2e/weight.mjs owns the budgets,
// at the volume that flow builds. This reports the real shape, at the volume
// scripts/load-fixture.mts builds, which is the one the documents quote.
//
//   DB_PATH=/tmp/fixture.sqlite npx tsx scripts/load-fixture.mts
//   npm run build
//   DB_PATH=/tmp/fixture.sqlite npm run measure
import { spawn } from "node:child_process";
import { cpSync } from "node:fs";
import Database from "better-sqlite3";

const DB = process.env.DB_PATH;
if (!DB) {
  console.error("Set DB_PATH to a fixture database. scripts/load-fixture.mts builds one.");
  process.exit(2);
}

const PORT = Number(process.env.MEASURE_PORT ?? 3199);
const BASE = `http://127.0.0.1:${PORT}`;
const EMAIL = "measure@e2e.local";
const PASSWORD = "measure-pass-123456";

// The standalone build does not copy these itself; e2e/run.mjs does the same.
try {
  cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
} catch {
  console.error("No .next/standalone — run `npm run build` first.");
  process.exit(2);
}

const server = spawn("node", [".next/standalone/server.js"], {
  env: {
    ...process.env,
    DB_PATH: DB,
    PORT: String(PORT),
    HOSTNAME: "127.0.0.1",
    // Nothing here presses an AI button, but a page that would refuse to
    // render without a provider should not decide what a page weighs.
    AI_FAKE: "1",
    USER1_EMAIL: EMAIL,
    USER1_PASSWORD: PASSWORD,
  },
  stdio: "ignore",
});
const stop = () => server.kill();
process.on("exit", stop);
process.on("SIGINT", () => { stop(); process.exit(130); });

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const r = await fetch(`${BASE}/login`);
      if (r.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("The server did not start.");
}

await waitForServer();

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
if (!login.ok || !cookie) throw new Error(`Could not sign in: ${login.status}`);

// The account with the most accepted research, because the Research section is
// the part of that page which grows with use — measuring the quietest account
// is how a page ends up documented at a size it never has.
const db = new Database(DB, { readonly: true });
const busiest = db
  .prepare(
    `SELECT a.id, COUNT(d.id) n FROM accounts a
     LEFT JOIN documents d ON d.account_id = a.id AND d.kind = 'research_note' AND d.status = 'accepted'
     WHERE a.kind = 'customer' AND a.archived_at IS NULL
     GROUP BY a.id ORDER BY n DESC, a.id LIMIT 1`,
  )
  .get();
if (!busiest) {
  db.close();
  throw new Error("That database has no customer accounts.");
}
// A play and a meeting on that account. Both grew a merge preview in Phase 19,
// rendered inside a closed ActionForm — which serialises its children whether
// or not anyone opens it, the trap this app has fallen into twice — so both
// belong in the committed measurement rather than in an argument about whether
// they could have grown.
const aPlay = db.prepare(`SELECT id FROM plays WHERE account_id = ? AND archived_at IS NULL LIMIT 1`).pluck().get(busiest.id);
const aMeeting = db.prepare(`SELECT id FROM meetings WHERE account_id = ? AND archived_at IS NULL ORDER BY held_at DESC LIMIT 1`).pluck().get(busiest.id);
// A task's own page (PR #28). Small by construction, measured anyway: the
// pages nobody measured are the ones that grew unnoticed.
const aTask = db.prepare(`SELECT id FROM action_items WHERE account_id = ? AND archived_at IS NULL LIMIT 1`).pluck().get(busiest.id);
db.close();

const routes = [
  "/",
  // The account table that used to be the bottom of "/", and the backlog
  // behind Today's one-line count (bounded at 200 cards).
  "/accounts",
  "/follow-ups/sort",
  "/assistants",
  "/promises",
  "/calendar",
  "/plans",
  "/handoff",
  "/pipeline",
  "/activity?days=30",
  "/follow-ups",
  `/accounts/${busiest.id}`,
  `/accounts/${busiest.id}/research`,
  `/accounts/${busiest.id}/install-base`,
  ...(aPlay ? [`/accounts/${busiest.id}/plays/${aPlay}`] : []),
  ...(aMeeting ? [`/accounts/${busiest.id}/meetings/${aMeeting}`] : []),
  ...(aTask ? [`/follow-ups/${aTask}`] : []),
];

const rows = [];
for (const route of routes) {
  // Warm first, so neither number is a first-render artefact.
  await fetch(BASE + route, { headers: { cookie } }).then((r) => r.text());
  const started = performance.now();
  const body = await fetch(BASE + route, { headers: { cookie } }).then((r) => r.text());
  rows.push({
    route: route.replace(busiest.id, "<id>"),
    kb: Math.round(body.length / 1024),
    ms: Math.round(performance.now() - started),
  });
}

const w = Math.max(...rows.map((r) => r.route.length));
console.log(`\n${DB}, account ${busiest.id} (${busiest.n} accepted research notes)\n`);
for (const r of rows) {
  console.log(`  ${r.route.padEnd(w)}  ${String(r.kb).padStart(5)} KB  ${String(r.ms).padStart(4)} ms`);
}
console.log(`\n  heaviest: ${Math.max(...rows.map((r) => r.kb))} KB\n`);
stop();
