import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { digest, scanText, inspectFile } from "../scripts/privacy-check.mjs";

const marker = "Private Fixture Sentinel";
const rules = [{ width: 3, hash: digest(marker.toLowerCase()) }];
function withRepo(fn) {
  const dir = mkdtempSync(join(tmpdir(), "privacy-fixture-"));
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0); return r;
  };
  const write = (file, content) => writeFileSync(join(dir, file), content);
  const run = (...args) => spawnSync(process.execPath, ["scripts/privacy-check.mjs", ...args], { cwd: dir, encoding: "utf8" });
  try {
    git("init", "-q"); git("config", "user.name", "Synthetic Author"); git("config", "user.email", "author@example.com");
    mkdirSync(join(dir, "scripts"));
    copyFileSync(resolve("scripts/privacy-check.mjs"), join(dir, "scripts/privacy-check.mjs"));
    write("scripts/privacy-policy.json", JSON.stringify({ version: 1, fingerprints: rules }));
    write("fixture.txt", "Synthetic fixture only");
    git("add", "."); git("commit", "-qm", "Synthetic baseline");
    fn({ dir, git, write, run });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe("repository privacy boundary", () => {
  it("matches case and punctuation without storing protected plaintext", () => {
    expect(scanText("PRIVATE--Fixture\nSentinel", rules)).toContain("protected identifier");
    expect(scanText("safe synthetic account", rules)).toEqual([]);
  });
  it("can block a protected token inside compound identifiers", () => {
    expect(scanText("prefixSampleTokenSuffix", [{ width: 1, substringLength: 11, hash: digest("sampletoken") }])).toContain("protected identifier");
  });
  it("allows only reserved fixture email domains", () => {
    expect(scanText("person@example.com person@test.local", rules)).toEqual([]);
    expect(scanText(["person", ["outside", "org"].join(".")].join("@"), rules)).toContain("non-synthetic email address");
  });
  it("blocks runtime artifacts even if their content looks harmless", () => {
    expect(inspectFile("data/export.txt", Buffer.from("safe"), rules)).toContain("private/runtime artifact path");
    expect(inspectFile(".env.production", Buffer.from("safe"), rules)).toContain("private/runtime artifact path");
    expect(inspectFile(".env.example", Buffer.from("safe"), rules)).toEqual([]);
  });
  it("fails closed on binary content", () => {
    expect(inspectFile("disguised.txt", Buffer.from([0, 255]), rules)).toContain("binary or invalid text requires private review");
  });
  it("scans untracked files and never emits the matched content", () => withRepo(({ write, run }) => {
    write("new.txt", marker);
    const r = run(); expect(r.status).toBe(1); expect(r.stderr).not.toContain(marker); expect(r.stderr).not.toContain("new.txt");
  }));
  it("does not exempt the scanner or lockfile", () => withRepo(({ write, run }) => {
    write("package-lock.json", JSON.stringify({ sample: marker }));
    expect(run().status).toBe(1);
    write("package-lock.json", "{}");
    write("scripts/privacy-check.mjs", `// ${marker}\n` + "process.exit(1);");
    // inspectFile independently proves the scanner path is not allowlisted.
    expect(inspectFile("scripts/privacy-check.mjs", Buffer.from(marker), rules)).toContain("protected identifier");
  }));
  it("checks staged bytes even when working copy has been cleaned", () => withRepo(({ git, write, run }) => {
    write("fixture.txt", marker); git("add", "fixture.txt"); write("fixture.txt", "safe");
    expect(run().status).toBe(0); expect(run("--staged").status).toBe(1);
  }));
  it("checks tracked ignored files", () => withRepo(({ git, write, run }) => {
    write(".gitignore", "private.txt\n"); write("private.txt", marker); git("add", "-f", "private.txt");
    expect(run().status).toBe(1);
  }));
  it("rejects symlinks without following them", () => withRepo(({ dir, run }) => {
    symlinkSync("/missing/private/source", join(dir, "link")); expect(run().status).toBe(1);
  }));
  it("validates commit messages without echoing them", () => withRepo(({ write, run }) => {
    write("message.txt", marker); const r = run("--message-file", "message.txt");
    expect(r.status).toBe(1); expect(r.stderr).not.toContain(marker);
  }));
  it("reports removed historical exposures rather than certifying history clean", () => withRepo(({ git, write, run }) => {
    write("fixture.txt", marker); git("add", "."); git("commit", "-qm", "First fixture");
    write("fixture.txt", "safe"); git("add", "."); git("commit", "-qm", "Replace fixture");
    expect(run().status).toBe(0); expect(run("--history").status).toBe(1);
  }));
  it("redacts malformed policy and rejects empty or invalid rules", () => withRepo(({ write, run }) => {
    for (const policy of [marker, JSON.stringify({ version: 1, fingerprints: [] }), JSON.stringify({ version: 1, fingerprints: [{ width: 0, hash: "bad" }] })]) {
      write("scripts/privacy-policy.json", policy);
      const r = run("--staged"); expect(r.status).toBe(1); expect(r.stderr).not.toContain(marker);
    }
  }));
  it("preserves tabs in staged filenames", () => withRepo(({ git, write, run }) => {
    write(`safe\t${marker}.txt`, "safe"); git("add", ".");
    expect(run("--staged").status).toBe(1);
  }));
  it("checks push and pull-request event refs and bodies", () => withRepo(({ write, run }) => {
    for (const event of [{ ref: `refs/heads/${marker}` }, { pull_request: { body: marker } }, { pull_request: { head: { ref: marker } } }]) {
      write("event.json", JSON.stringify(event)); const r = run("--event", "event.json");
      expect(r.status).toBe(1); expect(r.stderr).not.toContain(marker);
    }
  }));
  it("checks destination refs, outgoing author metadata and rejects annotated tags", () => withRepo(({ dir, git }) => {
    const push = (sha, destination = "refs/heads/safe") => spawnSync(process.execPath, ["scripts/privacy-check.mjs", "--pre-push"], {
      cwd: dir, encoding: "utf8", input: `refs/heads/safe ${sha} ${destination} ${"0".repeat(40)}\n`,
    });
    const sha = git("rev-parse", "HEAD").stdout.trim();
    expect(push(sha).status).toBe(0);
    expect(push(sha, `refs/heads/${marker.replaceAll(" ", "-")}`).status).toBe(1);
    git("config", "user.name", marker); git("commit", "--allow-empty", "-qm", "Synthetic change");
    expect(push(git("rev-parse", "HEAD").stdout.trim()).status).toBe(1);
    git("tag", "-a", "fixture-tag", "-m", "Synthetic annotation");
    expect(push(git("rev-parse", "fixture-tag").stdout.trim(), "refs/tags/fixture-tag").status).toBe(1);
  }));
  it("installed pre-commit and commit-message hooks reject protected input", () => withRepo(({ dir, git, write }) => {
    mkdirSync(join(dir, ".githooks"));
    for (const name of ["pre-commit", "commit-msg", "pre-push"]) copyFileSync(resolve(".githooks", name), join(dir, ".githooks", name));
    git("config", "core.hooksPath", ".githooks");
    write("fixture.txt", marker); git("add", ".");
    const commit = (message) => spawnSync("git", ["commit", "-qm", message], { cwd: dir, encoding: "utf8" });
    expect(commit("Synthetic change").status).not.toBe(0);
    write("fixture.txt", "Safe new fixture"); git("add", ".");
    const r = commit(marker); expect(r.status).not.toBe(0); expect(r.stderr).not.toContain(marker);
    expect(commit("Safe synthetic commit").status).toBe(0);
  }));
  it("fails closed on unknown options", () => withRepo(({ run }) => expect(run("--unknown").status).toBe(1)));
});
