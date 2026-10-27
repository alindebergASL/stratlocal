// Three synthetic people: who covers, and whose follow-ups are "the rest of the team's".
import { expect, it } from "vitest";
import { db } from "@/lib/db";
import { seedAccount, USER } from "./helpers";
import { applyEntityChange } from "@/lib/proposals/apply";
import { buildCover, coverOptions } from "@/lib/handoff/cover";
import { CitableSet, runReadTool, type ToolContext } from "@/lib/ask/tools";

const people = (n: number) => {
  const names = ["Synthetic One", "Synthetic Two", "Synthetic Three"];
  for (let i = 0; i < n; i++) db().prepare("INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, 'x', ?, ?, 0)").run(i === 0 ? USER : `user-${i + 1}`, `p${i}@example.test`, names[i], i);
};
const ctx = (): ToolContext => ({ now: new Date("2026-10-23T12:00:00Z"), userId: USER, cites: new CitableSet(), accountId: null }) as unknown as ToolContext;

it("with two people the other covers; with three nobody is assumed until chosen", () => {
  people(2);
  const w = { from: "2026-11-02", to: "2026-11-04" };
  expect(buildCover(USER, w, "2026-10-23").partner?.name).toBe("Synthetic Two");
  db().prepare("INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES ('user-3', 'p2@example.test', 'x', 'Synthetic Three', 2, 0)").run();
  expect(coverOptions(USER).map((o) => o.name)).toEqual(["Synthetic Two", "Synthetic Three"]);
  expect(buildCover(USER, w, "2026-10-23").partner).toBeNull();
  expect(buildCover(USER, w, "2026-10-23", "user-3").partner).toEqual({ id: "user-3", name: "Synthetic Three" });
  expect(buildCover(USER, w, "2026-10-23", "not-a-user").partner).toBeNull();
});

it("Ask's follow-ups for 'others' are everyone else's, each named", () => {
  people(3);
  const { accountId } = seedAccount();
  for (const [owner, text] of [[USER, "Mine"], ["user-2", "Second's"], ["user-3", "Third's"]] as const)
    applyEntityChange({ accountId, entityType: "action_item", op: "create", payload: { text, owner_user_id: owner, status: "open" }, actorUserId: USER });
  for (const who of ["others", "partner"]) {
    const out = JSON.parse(runReadTool("follow_ups", { who }, ctx()).content) as { follow_ups: Array<{ text: string; owner: string }> };
    expect(out.follow_ups.map((f) => [f.text, f.owner]).sort()).toEqual([["Second's", "Synthetic Two"], ["Third's", "Synthetic Three"]]);
  }
});
