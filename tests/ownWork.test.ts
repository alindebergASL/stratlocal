// Own work: the one account that is not a customer.
//
// Every follow-up needs an account, so work that is not about a customer —
// build the forecast, prep the deck, chase the partner agreement — had
// nowhere to live. This is the bucket it lives in.
//
// The design is a flagged account rather than a nullable account_id, and the
// reason is what this file is mostly testing. Nullable would have meant
// rebuilding change_log (its account_id is NOT NULL too, so the audit spine
// would be rewritten) and turning every follow-up query's `JOIN accounts`
// into a LEFT JOIN — where a missed one hides a todo with no error anywhere.
// A flagged account keeps every one of those joins working untouched, so a
// todo on it reaches Home, search and the follow-up list for free, and the
// only thing that needs sweeping is the handful of lists that are *about*
// customers. A miss there shows a row that should not be on screen: wrong in
// a way a person sees, not one that silently loses their work.
//
// So the two halves are asserted together in one object, because they are one
// property: invisible where accounts are listed, present everywhere a todo is.
import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDbForTests, OWN_WORK_ACCOUNT_ID } from "@/lib/db";
import { applyEntityChange, archiveEntity } from "@/lib/proposals/apply";
import { getAccount, listAccountChoices, listAccountSummaries, listArchivedAccounts } from "@/lib/queries/accounts";
import { listAttention } from "@/lib/queries/attention";
import { search } from "@/lib/queries/search";
import { entityLabels } from "@/lib/queries/labels";
import { databaseChecks } from "@/lib/setup";
import { seedAccount, USER, type Seed } from "./helpers";

const NOW = new Date("2026-09-17T15:00:00Z");
let seed: Seed;

beforeEach(() => {
  resetDbForTests();
  seed = seedAccount();
});

/** The bucket, as every surface sees it, asked all at once. */
function visibility() {
  const own = getAccount(OWN_WORK_ACCOUNT_ID);
  return {
    // It exists, and it is the only one of its kind.
    exists: own !== null,
    kind: own?.kind ?? null,
    // Where customers are listed, it must not appear.
    inSummaries: listAccountSummaries().some((a) => a.id === OWN_WORK_ACCOUNT_ID),
    inChoices: listAccountChoices().some((a) => a.id === OWN_WORK_ACCOUNT_ID),
    inArchivedList: listArchivedAccounts().some((a) => a.id === OWN_WORK_ACCOUNT_ID),
    inSearch: search("Own").some((g) => g.kind === "account" && g.hits.some((h) => h.accountId === OWN_WORK_ACCOUNT_ID)),
    // But a direct link still resolves, and history still renders its name —
    // the same two exceptions archived rows already have.
    resolvesByUrl: getAccount(OWN_WORK_ACCOUNT_ID) !== null,
    hasLabel: Boolean(entityLabels(OWN_WORK_ACCOUNT_ID)[OWN_WORK_ACCOUNT_ID]),
  };
}

function addTodo(accountId: string, text: string, due: string) {
  return applyEntityChange({
    accountId,
    entityType: "action_item",
    op: "create",
    payload: { text, due, status: "open" },
    actorUserId: USER,
  }).entityId;
}

// AttentionItem carries no id, so a row is recognised by the text a person
// would read — which is the right thing to match on anyway.
const overdueTexts = (at: Date) => listAttention(at).filter((a) => a.kind === "overdue").map((a) => a.text);

describe("the bucket itself", () => {
  it("exists from the first boot, without anyone creating it", () => {
    // Seeded beside the users rather than made on first use, so no screen has
    // to cope with it being absent.
    expect(visibility()).toMatchObject({ exists: true, kind: "own_work" });
  });

  it("is invisible everywhere accounts are listed, and reachable everywhere else", () => {
    expect(visibility()).toEqual({
      exists: true,
      kind: "own_work",
      inSummaries: false,
      inChoices: false,
      inArchivedList: false,
      inSearch: false,
      resolvesByUrl: true,
      hasLabel: true,
    });
  });

  it("does not count as a customer on the diagnostics page", () => {
    // /setup reports how many accounts there are, and answering one more than
    // the person can see is the small kind of lie that wastes an afternoon.
    //
    // Asked through databaseChecks() rather than by re-running its SQL here:
    // the first draft of this compared my own query against my own query and
    // passed while setup.ts counted the bucket.
    const what = databaseChecks().find((c) => c.label === "What is in it");
    expect(what, "the diagnostics page should report what is in the database").toBeTruthy();
    expect(what!.value).toContain(`${listAccountSummaries().length} accounts`);
  });

  it("cannot be archived, because there would be no way back to it", () => {
    expect(() => archiveEntity({ accountId: OWN_WORK_ACCOUNT_ID, entityType: "account", entityId: OWN_WORK_ACCOUNT_ID, actorUserId: USER })).toThrow(
      /cannot be archived/i,
    );
    expect(getAccount(OWN_WORK_ACCOUNT_ID)!.archived_at).toBeNull();
  });

  it("stays out of the archived list even if something archives it behind the guard", () => {
    // archiveEntity refuses, so through the app this is unreachable — which is
    // exactly why the list filter needs its own test: a mutation removing it
    // failed nothing until this existed. A migration or a manual fix can set
    // the column directly, and the restore list is the one screen where the
    // bucket turning up would invite somebody to "restore" it into a customer.
    db().prepare(`UPDATE accounts SET archived_at = '2026-09-17' WHERE id = ?`).run(OWN_WORK_ACCOUNT_ID);
    expect(listArchivedAccounts().some((a) => a.id === OWN_WORK_ACCOUNT_ID)).toBe(false);
  });

  it("archiving a real account still works, so the guard is not a blanket refusal", () => {
    archiveEntity({ accountId: seed.accountId, entityType: "account", entityId: seed.accountId, actorUserId: USER });
    expect(getAccount(seed.accountId)!.archived_at).not.toBeNull();
  });
});

describe("a todo that is not about a customer", () => {
  it("can be written down, and reaches the places a todo is read", () => {
    // The whole point of the flagged-account design: none of these queries
    // changed, and the todo arrives in all of them anyway.
    addTodo(OWN_WORK_ACCOUNT_ID, "Build the Q2 forecast", "2026-09-10");
    const overdue = listAttention(NOW).filter((a) => a.kind === "overdue");
    expect(overdue.map((a) => a.text)).toContain("Build the Q2 forecast");
    // And it says where it belongs, which is the bucket rather than a customer.
    const row = overdue.find((a) => a.text === "Build the Q2 forecast")!;
    expect(row.accountName).toBe("Own work");
    // Clicking it goes to the todo list, not to an account page whose Deals,
    // Plays and Meetings sections would all be empty. The browser flow found
    // this: the row linked to /accounts/own-work.
    expect(row.href).toBe(`/follow-ups?who=unowned#action-${row.href.split("#action-")[1]}`);
    expect(row.href.startsWith("/accounts/")).toBe(false);
    expect(search("forecast").some((g) => g.hits.some((h) => h.label.includes("Build the Q2 forecast") || h.detail?.includes("Build the Q2 forecast")))).toBe(
      true,
    );
  });

  it("sits beside the ones that are about a customer rather than replacing them", () => {
    addTodo(OWN_WORK_ACCOUNT_ID, "Prep the QBR deck", "2026-09-10");
    addTodo(seed.accountId, "Send the storage quote", "2026-09-10");
    const overdue = overdueTexts(NOW);
    expect(overdue).toContain("Prep the QBR deck");
    expect(overdue).toContain("Send the storage quote");
  });

  it("writes history like any other change, which the nullable design could not", () => {
    // change_log.account_id is NOT NULL. A todo with no account at all would
    // have had nowhere to record itself; on the bucket it records normally.
    const id = addTodo(OWN_WORK_ACCOUNT_ID, "Chase the partner agreement", "2026-09-20");
    const rows = db()
      .prepare(`SELECT field FROM change_log WHERE entity_type = 'action_item' AND entity_id = ?`)
      .all(id) as Array<{ field: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.field)).toContain("text");
  });
});
