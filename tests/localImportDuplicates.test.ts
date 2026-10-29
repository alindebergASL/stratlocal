// SYNTHETIC ONLY. Repeated MyAgent versions must not create duplicate records.
import { expect, it } from "vitest";
import JSZip from "jszip";
import { db } from "@/lib/db";
import { parsePackage, proposePackage, stagePackage } from "@/lib/local/packages";
import { acceptProposal, applyEntityChange } from "@/lib/proposals/apply";
import { seedAccount, USER } from "./helpers";

async function prepare(accountName: string, version: number, email?: string) {
  const zip = new JSZip();
  const contacts = [{ name: "Synthetic Jordan Example", org: "customer", email, title: "Research Director" }];
  zip.file("manifest.json", JSON.stringify({
    version: 1, namespace: `synthetic-version-${version}`, as_of: "2026-01-01",
    artifacts: [{ path: "sources/records.json" }],
    accounts: [{ key: "one", report: {
      account: { name: accountName }, contacts,
      plays: [{ title: "Synthetic research collaboration", thesis: "Explore a documented need", deal_ids: [] }],
    }, sources: [{ path: "sources/records.json" }] }],
  }));
  zip.file("sources/records.json", JSON.stringify({ account: { name: accountName }, contacts }));
  const p = stagePackage(`synthetic-v${version}.zip`, await zip.generateAsync({ type: "nodebuffer" }), USER);
  await parsePackage(p.id, null);
  proposePackage(p.id, USER);
  const rows = db().prepare("SELECT id,entity_type FROM proposals WHERE origin_id=?").all(p.id) as { id: string; entity_type: string }[];
  return {
    contact: rows.find(r => r.entity_type === "contact")!.id,
    play: rows.find(r => r.entity_type === "play")!.id,
  };
}

it("marks duplicate contact and play creates from overlapping packages as conflicts", async () => {
  const { accountId } = seedAccount();
  const first = await prepare("Synthetic Orchard Lab", 1);
  const second = await prepare("Synthetic Orchard Lab", 2);
  for (const type of ["contact", "play"] as const) {
    expect(acceptProposal(first[type], USER).status).toBe("accepted");
    expect(acceptProposal(second[type], USER)).toMatchObject({ status: "conflict", message: expect.stringContaining("no duplicate was created") });
    expect(db().prepare("SELECT status FROM proposals WHERE id=?").get(second[type])).toEqual({ status: "conflict" });
  }
  expect(db().prepare("SELECT count(*) n FROM contacts WHERE account_id=? AND name='Synthetic Jordan Example'").get(accountId)).toEqual({ n: 1 });
  expect(db().prepare("SELECT count(*) n FROM plays WHERE account_id=? AND title='Synthetic research collaboration'").get(accountId)).toEqual({ n: 1 });
});

it("allows distinct people with the same name and different supplied email addresses", async () => {
  const { accountId } = seedAccount();
  const first = await prepare("Synthetic Orchard Lab", 1, "jordan.one@example.test");
  const second = await prepare("Synthetic Orchard Lab", 2, "jordan.two@example.test");
  expect(acceptProposal(first.contact, USER).status).toBe("accepted");
  expect(acceptProposal(second.contact, USER).status).toBe("accepted");
  expect(db().prepare("SELECT count(*) n FROM contacts WHERE account_id=? AND name='Synthetic Jordan Example'").get(accountId)).toEqual({ n: 2 });
});

it("preserves a matching contact added manually while the import awaited review", async () => {
  const { accountId } = seedAccount();
  const pending = await prepare("Synthetic Orchard Lab", 1);
  const person = applyEntityChange({ accountId, entityType: "contact", op: "create", actorUserId: USER, payload: {
    name: "Synthetic  Jordan Example", title: "Manually confirmed title", org: "customer",
  } });
  expect(acceptProposal(pending.contact, USER).status).toBe("conflict");
  expect(db().prepare("SELECT title FROM contacts WHERE id=?").get(person.entityId)).toEqual({ title: "Manually confirmed title" });
});

it("does not recreate archived contacts or plays when a second package is accepted", async () => {
  seedAccount();
  const first = await prepare("Synthetic Orchard Lab", 1);
  const second = await prepare("Synthetic Orchard Lab", 2);
  for (const type of ["contact", "play"] as const) {
    const accepted = acceptProposal(first[type], USER);
    if (accepted.status !== "accepted") throw new Error("Expected accepted fixture");
    const table = type === "contact" ? "contacts" : "plays";
    db().prepare(`UPDATE ${table} SET archived_at='2026-01-02' WHERE id=?`).run(accepted.entityId);
    expect(acceptProposal(second[type], USER).status).toBe("conflict");
    expect(db().prepare(`SELECT archived_at FROM ${table} WHERE id=?`).get(accepted.entityId)).toEqual({ archived_at: "2026-01-02" });
  }
});

it("follows merged contacts to the surviving record before accepting a stale create", async () => {
  const { accountId, contactId } = seedAccount();
  const pending = await prepare("Synthetic Orchard Lab", 1);
  const duplicate = applyEntityChange({ accountId, entityType: "contact", op: "create", actorUserId: USER, payload: {
    name: "Synthetic Jordan Example", org: "customer",
  } });
  db().prepare("UPDATE contacts SET archived_at='2026-01-02',merged_into=? WHERE id=?").run(contactId, duplicate.entityId);
  expect(acceptProposal(pending.contact, USER)).toMatchObject({ status: "conflict", message: expect.stringContaining("Finley Example") });
});

it("keeps matching names on separate accounts independent", async () => {
  seedAccount();
  seedAccount({ name: "Synthetic Harbor Lab", dealId: "SYN-HARBOR-1" });
  const first = await prepare("Synthetic Orchard Lab", 1);
  const second = await prepare("Synthetic Harbor Lab", 2);
  for (const type of ["contact", "play"] as const) {
    expect(acceptProposal(first[type], USER).status).toBe("accepted");
    expect(acceptProposal(second[type], USER).status).toBe("accepted");
  }
});
