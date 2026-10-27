// Repository boundary only: never scan production storage or print matched data.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, lstatSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export const digest = (s) => createHash("sha256").update(s).digest("hex");
export const words = (s) => s.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
let cachedPolicy;
function fingerprints() {
  if (!cachedPolicy) {
    const parsed = JSON.parse(readFileSync(new URL("./privacy-policy.json", import.meta.url), "utf8"));
    if (parsed.version !== 1 || !Array.isArray(parsed.fingerprints) || !parsed.fingerprints.length || parsed.fingerprints.some((r) => !Number.isInteger(r.width) || r.width < 1 || r.width > 12 || !/^[a-f0-9]{64}$/.test(r.hash) || (r.substringLength !== undefined && (!Number.isInteger(r.substringLength) || r.substringLength < 1 || r.substringLength > 128)))) throw new Error("Invalid policy");
    cachedPolicy = parsed.fingerprints;
  }
  return cachedPolicy;
}

// Fingerprints allow detection without committing the protected names themselves.
// This is a denylist, not proof that unknown customer data is anonymous.
export function scanText(text, rules = fingerprints()) {
  const tokens = words(text);
  const reasons = new Set();
  const byWidth = new Map();
  for (const { width, hash } of rules) {
    if (!byWidth.has(width)) byWidth.set(width, new Set());
    byWidth.get(width).add(hash);
  }
  for (const [width, hashes] of byWidth) {
    for (let i = 0; i + width <= tokens.length; i++) {
      if (hashes.has(digest(tokens.slice(i, i + width).join(" ")))) {
        reasons.add("protected identifier");
        break;
      }
    }
  }
  for (const rule of rules.filter((r) => r.substringLength)) {
    for (const token of tokens) {
      for (let i = 0; i + rule.substringLength <= token.length; i++) {
        if (digest(token.slice(i, i + rule.substringLength)) === rule.hash) reasons.add("protected identifier");
      }
    }
  }
  for (const match of text.matchAll(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi)) {
    const domain = match[1].toLowerCase();
    if (match[0].toLowerCase() === "noreply@anthropic.com") continue; // Public automation attribution, not customer data.
    if (!/(^|\.)(example\.(com|org|net)|example|test|invalid|localhost)$/.test(domain)
        && !["test.local", "e2e.local"].includes(domain)) reasons.add("non-synthetic email address");
  }
  if (/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(text)) reasons.add("private key material");
  return [...reasons];
}

function git(args, binary = false) {
  const r = spawnSync("git", args, { encoding: binary ? undefined : "utf8", maxBuffer: 128 * 1024 * 1024 });
  if (r.status !== 0) throw new Error("Git read failed; privacy check cannot certify this input");
  return r.stdout;
}
const split = (s) => s.split("\0").filter(Boolean);
const blockedPath = /(^|\/)(data|operator-receipts|screenshots|playwright-report|test-results|coverage)(\/|$)|\.(db|sqlite\d?|pem|key|p12|pfx|zip|tar|gz|pdf|docx?|xlsx?|png|jpe?g|webp|mp4)$/i;
const envPath = /(^|\/)\.env(?:\.|$)/;

export function inspectFile(file, bytes, rules = fingerprints()) {
  const reasons = new Set(scanText(file, rules));
  if (blockedPath.test(file) || (envPath.test(file) && !file.endsWith(".example"))) reasons.add("private/runtime artifact path");
  if (bytes.length > 5 * 1024 * 1024) reasons.add("oversized file requires private review");
  else {
    try {
      if (bytes.includes(0)) throw new Error("binary");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      for (const reason of scanText(text, rules)) reasons.add(reason);
    } catch { reasons.add("binary or invalid text requires private review"); }
  }
  return [...reasons];
}

export function main(args = process.argv.slice(2)) {
  fingerprints(); // Validate inside the sanitized CLI error boundary.
  const findings = [];
  let checked = 0;
  const add = (location, reasons) => {
    // Locations can themselves contain customer names. Emit only stable fingerprints.
    for (const reason of reasons) findings.push({ locationHash: digest(location).slice(0, 16), reason });
  };
  const inspect = (location, file, bytes) => { checked++; add(location, inspectFile(file, bytes)); };
  const scanTree = (rev) => {
    for (const row of split(git(["ls-tree", "-r", "-z", rev]))) {
      const separator = row.indexOf("\t");
      if (separator < 0) throw new Error("invalid Git entry");
      const header = row.slice(0, separator), file = row.slice(separator + 1);
      const [mode, type, oid] = header.split(" ");
      if (type !== "blob" || mode === "120000") { add(`${rev}:${file}`, ["symlink or submodule requires private review"]); continue; }
      inspect(`${rev}:${file}`, file, git(["cat-file", "blob", oid], true));
    }
  };
  if (args[0] === "--event") {
    const event = JSON.parse(readFileSync(args[1] || process.env.GITHUB_EVENT_PATH, "utf8"));
    const texts = [event.pull_request?.title, event.pull_request?.body,
      event.ref, event.pull_request?.head?.ref, event.pull_request?.base?.ref, event.head_commit?.message,
      ...(event.commits || []).map((commit) => commit.message)].filter(Boolean);
    for (const text of texts) { add("event-metadata", scanText(text)); checked++; }
  } else if (args[0] === "--message-file") {
    if (!args[1]) throw new Error("Missing message file");
    add("commit-message", scanText(readFileSync(args[1], "utf8"))); checked++;
  } else if (args[0] === "--staged") {
    for (const row of split(git(["ls-files", "--stage", "-z"]))) {
      const separator = row.indexOf("\t");
      if (separator < 0) throw new Error("invalid Git entry");
      const header = row.slice(0, separator), file = row.slice(separator + 1);
      const [mode, oid, stage] = header.split(" ");
      if (stage !== "0" || mode === "120000" || mode === "160000") { add(file, ["unmerged or linked index entry"]); continue; }
      inspect(file, file, git(["cat-file", "blob", oid], true));
    }
  } else if (args[0] === "--pre-push") {
    for (const row of readFileSync(0, "utf8").trim().split("\n").filter(Boolean)) {
      const [ref, sha, destination] = row.split(" ");
      if (/^0+$/.test(sha)) continue;
      add("push-ref", scanText(`${ref} ${destination || ""}`));
      if (git(["cat-file", "-t", sha]).trim() !== "commit") { add("push-object", ["non-commit push requires private review"]); continue; }
      scanTree(sha);
      const commits = git(["rev-list", sha, "--not", "--remotes"]).trim().split("\n").filter(Boolean);
      for (const rev of commits) {
        add(rev, scanText(git(["show", "-s", "--format=%B%n%an%n%ae%n%cn%n%ce", rev])));
        scanTree(rev);
      }
    }
  } else if (args[0] === "--history") {
    // Explicit audit, not silently skipped just because old history is dirty.
    const revs = git(["rev-list", "--all"]).trim().split("\n").filter(Boolean);
    const seen = new Set();
    for (const rev of revs) {
      add(rev, scanText(git(["show", "-s", "--format=%B%n%an%n%ae%n%cn%n%ce", rev])));
      for (const row of split(git(["ls-tree", "-r", "-z", rev]))) {
        const separator = row.indexOf("\t");
      if (separator < 0) throw new Error("invalid Git entry");
      const header = row.slice(0, separator), file = row.slice(separator + 1);
        const [mode, type, oid] = header.split(" ");
        const key = `${oid}:${file}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (type !== "blob" || mode === "120000") { add(key, ["linked historical entry"]); continue; }
        inspect(key, file, git(["cat-file", "blob", oid], true));
      }
    }
    add("refs", scanText(git(["for-each-ref", "--format=%(refname)"])));
  } else if (args.length) {
    throw new Error("Unknown privacy-check option");
  } else {
    const files = new Set(split(git(["ls-files", "-z"])).concat(split(git(["ls-files", "--others", "--exclude-standard", "-z"]))));
    const deleted = new Set(split(git(["ls-files", "--deleted", "-z"])));
    for (const file of files) {
      if (deleted.has(file)) continue; // Staged mode separately checks the index.
      if (lstatSync(file).isSymbolicLink()) { add(file, ["symlink requires private review"]); continue; }
      inspect(file, file, readFileSync(file));
    }
    add("branch", scanText(git(["branch", "--show-current"])));
    add("head-message", scanText(git(["show", "-s", "--format=%B", "HEAD"])));
  }
  if (findings.length) {
    console.error(`privacy: FAIL (${findings.length} findings; source content and paths withheld)`);
    for (const item of findings) console.error(`  ${item.locationHash}: ${item.reason}`);
    return 1;
  }
  console.log(`privacy: PASS (${checked} inputs; known-identifier/artifact checks only; manual review still required)`);
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = main(); }
  catch { console.error("privacy: FAIL (input could not be inspected; details withheld)"); process.exitCode = 1; }
}
