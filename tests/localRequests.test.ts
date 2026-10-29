import { expect, it } from "vitest";
import { db } from "@/lib/db";
import { requestHistory } from "@/lib/local/requests";
import { seedAccount, USER } from "./helpers";

it("keeps request history scoped to its creator and account", () => {
  const a = seedAccount();
  const b = seedAccount({ name: "Synthetic Other Lab", dealId: "SYN-OTHER" });
  const add = db().prepare("INSERT INTO local_requests VALUES(?,?,?,?,?,?)");
  add.run("mine", a.accountId, "Synthetic request", "[]", USER, 1);
  add.run("other-user", a.accountId, "Private request", "[]", "other-user", 2);
  add.run("other-account", b.accountId, "Other account request", "[]", USER, 3);
  const history = requestHistory(a.accountId, USER);
  expect(history.total).toBe(1);
  expect(history.rows.map(r => r.id)).toEqual(["mine"]);
});

it("keeps older requests reachable with stable ordering and bounded pagination", () => {
  const a = seedAccount();
  const add = db().prepare("INSERT INTO local_requests VALUES(?,?,?,?,?,?)");
  for (let i = 0; i < 25; i++) add.run(`request-${String(i).padStart(2, "0")}`, a.accountId, "Synthetic request", "[]", USER, 1);
  const first = requestHistory(a.accountId, USER);
  const second = requestHistory(a.accountId, USER, 2);
  expect(first.rows).toHaveLength(20);
  expect(second.rows).toHaveLength(5);
  expect(new Set([...first.rows, ...second.rows].map(r => r.id)).size).toBe(25);
  expect(first.rows[0]?.id).toBe("request-24");
  expect(requestHistory(a.accountId, USER, Number.NaN).page).toBe(1);
  expect(requestHistory(a.accountId, USER, 999).page).toBe(2);
  expect(requestHistory(a.accountId, USER, 1, 999).rows).toHaveLength(20);
});
