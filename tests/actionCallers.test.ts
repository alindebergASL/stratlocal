// Every server action has a caller, and every route has a link.
//
// Phase 10 moved contact editing off the account page and onto the person's
// own page. It moved the edit form. It did not move the "Merge in" picker
// beside it, and it left a comment claiming it had — so for a phase, merging
// two people was impossible from anywhere in the app. `mergePeople` sat in
// app/actions.ts with zero callers.
//
// Nothing caught it, and nothing could have. `lib/proposals/merge.ts` is
// correct and `tests/merge.test.ts` exercises it thoroughly; a library test
// cannot see a missing button. `npm run build` cannot either — an exported
// async function with "use server" at the top of its file is a legitimate
// module export whether or not anything imports it, and `noUnusedLocals` does
// not look across files.
//
// This is the third time an affordance has gone missing this way: Phase 4
// found that a deal could not be edited by hand at all because `saveDeal` was
// only ever bound with a null id, and Phase 6 deleted `saveActionItem` after
// finding it had no callers. Both were found by reading. This finds them by
// running.
//
// It is a source-text check, not a type check, which is the only thing that
// works here: a server action reaches its caller through `.bind()` on a prop,
// so there is no call expression to look for and no type that goes unused.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const ACTIONS_FILE = path.join(ROOT, "app", "actions.ts");
const actionsSource = fs.readFileSync(ACTIONS_FILE, "utf8");

// Where a server action can legitimately be used from: a page, a client
// component, or another action. Not `lib/` — nothing there should reach for a
// server action, and if something did, the import would be the finding.
const CALLER_FILES = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "components"))].filter(
  (f) => f !== ACTIONS_FILE,
);
const callerSource = CALLER_FILES.map((f) => fs.readFileSync(f, "utf8")).join("\n");

function exportedActions(source: string): string[] {
  return [...source.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]!);
}

describe("app/actions.ts", () => {
  it("exports actions, and this test found them", () => {
    // If the regex ever stops matching — the file switches to `export const`,
    // say — every assertion below passes vacuously. This is the guard on the
    // guard.
    const names = exportedActions(actionsSource);
    expect(names.length).toBeGreaterThan(15);
    expect(names).toContain("mergePeople");
    expect(names).toContain("saveDeal");
  });

  it("has a caller for every action it exports", () => {
    const orphans = exportedActions(actionsSource).filter((name) => !new RegExp(`\\b${name}\\b`).test(callerSource));
    // Named, not counted: the failure message has to say which one, because
    // the answer is either "wire it up" or "delete it" and you cannot tell
    // which from a number.
    expect(orphans).toEqual([]);
  });
});

describe("the identity operations reach a screen", () => {
  // The three things a person decides and a model may never propose
  // (DECISIONS #14). Each needs a form that submits the field its action
  // reads, or the action is unreachable however many callers grep finds.
  it.each([
    ["mergePeople", "contact-merge"],
    ["mergeDealsAction", "deal-merge"],
    ["moveDealToAccount", "deal-move"],
  ])("%s is bound to a form rendered as %s", (action, testId) => {
    expect(callerSource).toMatch(new RegExp(`\\b${action}\\b`));
    expect(callerSource).toContain(`testId="${testId}"`);
  });

  it("the merge forms submit the field their actions read", () => {
    // Both merges read `loser_id` off the FormData. A form that renders a
    // differently named select submits nothing and the action answers "Pick
    // the duplicate to merge in" forever.
    expect(actionsSource).toContain('str(fd, "loser_id")');
    expect(callerSource).toContain('name="loser_id"');
    expect(actionsSource).toContain('str(fd, "to_account_id")');
    expect(callerSource).toContain('name="to_account_id"');
  });
});
