// Proves each provider answers with the configured model, and shows what a
// trivial call costs. Run: npm run smoke:providers
//
// In a deployment, press Check providers on Home instead: this script runs
// through tsx, which is a devDependency and is not in the image.
//
// Reads .env.local if present (Next does this for the app; this script is
// outside Next so it does it itself).
import fs from "node:fs";
import path from "node:path";

function loadEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    const key = m[1]!;
    let value = m[2]!;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvLocal();

// The check itself lives in lib/ai/smoke.ts so that the route and the button
// on Home run the same code. This file is the local-development face of it:
// the deployment image has no tsx, so `npm run smoke:providers` cannot run
// there — that is what the button is for.
const { checkProviders } = await import("../lib/ai/smoke");

// No actor, so nothing is written to ai_runs: this runs outside the app,
// often against a database that is not the one the app uses, and a run row
// with no user attached would be a lie about who spent the money.
const checks = await checkProviders();

for (const c of checks) {
  if (c.status === "skipped") {
    console.log(`SKIP  ${c.label}: ${c.message}`);
  } else if (c.status === "ok") {
    const cost = c.costCents === null ? "unknown" : `${c.costCents}c${c.estimated ? " (est.)" : ""}`;
    console.log(
      `OK    ${c.label}: model=${c.servedModel} reply=${JSON.stringify(c.reply)} ` +
        `in=${c.inputTokens} out=${c.outputTokens} cost=${cost} ${c.ms}ms`,
    );
  } else {
    console.log(`FAIL  ${c.label}: model=${c.model} ${c.message}`);
  }
}

process.exit(checks.some((c) => c.status === "failed") ? 1 : 0);
