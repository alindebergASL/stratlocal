// The scheduler loop's one call: ask the app what is due. Runs in its own
// container (deploy/compose.yml) and talks to `web` on the inside network,
// never through the proxy. A failed tick is logged and the loop carries on;
// the next tick is a few minutes away and nothing is lost by missing one.
const url = process.env.SCHEDULER_URL ?? "http://web:3000/api/internal/tick";
const secret = process.env.SCHEDULER_SECRET ?? "";
if (secret.trim().length < 32) {
  console.error("[tick] SCHEDULER_SECRET is missing or shorter than 32 characters; assistants will not run on their own");
  process.exit(1);
}
try {
  const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${secret.trim()}` }, signal: AbortSignal.timeout(30_000) });
  const body = await res.text();
  if (!res.ok) {
    console.error(`[tick] ${res.status} ${body.slice(0, 300)}`);
    process.exit(1);
  }
  const report = JSON.parse(body);
  const ran = report.ran.map((r) => `${r.assistant}: ${r.summary}`).join("; ");
  const errors = report.errors.map((e) => `${e.assistant}: ${e.error}`).join("; ");
  if (ran || errors) console.log(`[tick] ${ran}${errors ? ` errors: ${errors}` : ""}`);
} catch (e) {
  console.error(`[tick] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
