// Properties every source file in this repository has to have.
//
// One so far, and it earned its place twice. Phase 9 found two literal NUL
// bytes used as map-key separators in lib/queries/today.ts, which made that
// file *binary* to grep, ripgrep and the editor — `rg "recentChanges" lib/`
// returned nothing, in the file with the subtlest logic in the app and the one
// that had carried the Phase 7 bug. They were replaced with `backslash-u-0000` escapes,
// which are identical at runtime and leave the file as text.
//
// And then, writing lib/queries/movement.ts for exactly the same kind of
// compound map key, I wrote a literal NUL again. Nothing caught it: the code
// was correct, the types were fine, every test passed. It only showed up
// because `file` was run by hand.
//
// So it is a check now rather than a thing to remember.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIRS = ["app", "lib", "components", "scripts", "e2e", "tests"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(full, out);
    } else if (/\.(ts|tsx|mts|mjs|js|css|md)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const FILES = DIRS.flatMap((d) => walk(path.join(ROOT, d)));

describe("every source file", () => {
  it("was found, so this test is not passing vacuously", () => {
    expect(FILES.length).toBeGreaterThan(80);
  });

  it("is text, not binary", () => {
    // A single NUL byte is enough: grep, ripgrep and most editors switch to
    // binary handling and stop reporting matches at all. The escape sequence in the
    // source is the same character at runtime and keeps the file readable.
    const binary = FILES.filter((f) => fs.readFileSync(f).includes(0)).map((f) => path.relative(ROOT, f));
    expect(binary).toEqual([]);
  });
});
