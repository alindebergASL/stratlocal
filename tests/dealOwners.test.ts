// SYNTHETIC ONLY.
//
// A deal's owner is free text the CRM report writes, so one person arrives as
// "Jamie", "Jamie L." and "Jamie Lee" — three owners to the pipeline's
// filter. A person now says which spellings are one name; the deals keep the
// text the report wrote, and everything that shows or filters an owner reads
// the name.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { db, resetDbForTests, type DealRow } from "@/lib/db";
import { applyEntityChange } from "@/lib/proposals/apply";
import { confirmOwner, ownerChoices, ownerNames, ownerSuggestions, separateOwner } from "@/lib/dealOwners";
import { listDealOwners, listOpenDeals } from "@/lib/queries/accounts";
import { seedAccount, USER, type Seed } from "./helpers";
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, name: "Synthetic User", email: "synthetic@example.test" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/pipeline", useSearchParams: () => new URLSearchParams() }));

let seed: Seed;
let n = 0;
function deal(owner: string | null) {
  n += 1;
  return applyEntityChange({
    accountId: seed.accountId,
    entityType: "deal",
    op: "create",
    payload: { deal_id: `SYN-OWN-${n}`, name: `Synthetic deal ${n}`, stage: 2, close_date: "2026-12-01", owner },
    actorUserId: USER,
  }).entityId;
}
const raw = (id: string) => (db().prepare("SELECT owner FROM deals WHERE deal_id = ?").get(id) as Pick<DealRow, "owner">).owner;

beforeEach(() => {
  resetDbForTests();
  n = 0;
  seed = seedAccount();
});

describe("which spellings are one owner", () => {
  it("offers each spelling as its own owner until someone says otherwise", () => {
    deal("Jamie");
    deal("Jamie L.");
    deal("Jamie Lee");
    expect(ownerChoices()).toEqual(["Jamie", "Jamie L.", "Jamie Lee"]);
  });

  it("suggests the unambiguous pairs, and applies none of them", () => {
    deal("Jamie");
    deal("Jamie L.");
    deal("Jamie Lee");
    deal("Morgan Kim");
    expect(ownerSuggestions()).toEqual([
      { spelling: "Jamie", name: "Jamie Lee" },
      { spelling: "Jamie L.", name: "Jamie Lee" },
    ]);
    expect(ownerChoices()).toHaveLength(4);
  });

  it("does not suggest a short name that fits two people", () => {
    deal("Jamie");
    deal("Jamie Lee");
    deal("Jamie Kim");
    expect(ownerSuggestions()).toEqual([]);
  });

  it("does not take an initial that does not match", () => {
    deal("Jamie K.");
    deal("Jamie Lee");
    expect(ownerSuggestions()).toEqual([]);
  });

  it("once confirmed, shows and filters as one name, and the deals keep what the report wrote", () => {
    const a = deal("Jamie");
    const b = deal(" jamie  l. ");
    const c = deal("Jamie Lee");
    deal("Morgan Kim");
    confirmOwner({ spelling: "Jamie", name: "Jamie Lee", userId: USER });
    confirmOwner({ spelling: " jamie  l. ", name: "Jamie Lee", userId: USER });
    expect(listDealOwners()).toEqual(["Jamie Lee", "Morgan Kim"]);
    expect(listOpenDeals({ owner: "Jamie Lee" }).map((d) => d.deal_id).sort()).toEqual([a, b, c].sort());
    expect(ownerNames().nameOf("JAMIE")).toBe("Jamie Lee");
    expect(raw(a)).toBe("Jamie");
    // Stored as the write path keeps it (edges trimmed); the inner spacing
    // and the case are the report's, untouched.
    expect(raw(b)).toBe("jamie  l.");
  });

  it("filters by an exact person, no longer by any name containing the text", () => {
    deal("Al");
    const al = deal("Alex Morgan");
    expect(listOpenDeals({ owner: "Alex Morgan" }).map((d) => d.deal_id)).toEqual([al]);
    expect(listOpenDeals({ owner: "Al" }).map((d) => d.deal_id)).toHaveLength(1);
    expect(listOpenDeals({ owner: "Nobody" })).toEqual([]);
  });

  it("moves everything that pointed at a spelling when that spelling is itself folded in", () => {
    deal("Jamie");
    deal("Jamie L.");
    deal("Jamie Lee");
    confirmOwner({ spelling: "Jamie", name: "Jamie L.", userId: USER });
    confirmOwner({ spelling: "Jamie L.", name: "Jamie Lee", userId: USER });
    expect(ownerNames().nameOf("Jamie")).toBe("Jamie Lee");
    expect(listDealOwners()).toEqual(["Jamie Lee"]);
  });

  it("can be taken back", () => {
    deal("Jamie");
    deal("Jamie Lee");
    confirmOwner({ spelling: "Jamie", name: "Jamie Lee", userId: USER });
    separateOwner("Jamie");
    expect(listDealOwners()).toEqual(["Jamie", "Jamie Lee"]);
  });

  it("refuses a spelling that is on no deal, and a name that is not an owner", () => {
    deal("Jamie");
    expect(() => confirmOwner({ spelling: "Nobody", name: "Jamie", userId: USER })).toThrow(/not on any deal/);
    expect(() => confirmOwner({ spelling: "Jamie", name: "Somebody New", userId: USER })).toThrow(/already on a deal/);
  });
});

describe("what the review of deal owners found", () => {
  it("does not keep offering a pair that is already one owner", () => {
    deal("Jamie L.");
    deal("Jamie Lee");
    confirmOwner({ spelling: "Jamie Lee", name: "Jamie L.", userId: USER });
    expect(ownerSuggestions()).toEqual([]);
  });

  it("follows a chain through names outside ASCII", () => {
    deal("Élodie M.");
    deal("Élodie Martin");
    deal("E. Martin");
    confirmOwner({ spelling: "Élodie M.", name: "Élodie Martin", userId: USER });
    confirmOwner({ spelling: "Élodie Martin", name: "E. Martin", userId: USER });
    expect(listDealOwners()).toEqual(["E. Martin"]);
    expect(listOpenDeals({ owner: "E. Martin" })).toHaveLength(3);
  });
});

describe("an owner filter from an older link", () => {
  it("is shown as what it is rather than as 'all' over an empty list", async () => {
    const { default: Pipeline } = await import("@/app/pipeline/page");
    const { document } = parseHTML(renderToStaticMarkup(await Pipeline({ searchParams: Promise.resolve({ owner: "Nobody Synthetic" }) })));
    const options = [...document.querySelectorAll("option")];
    const stale = options.find((o) => o.textContent === "Nobody Synthetic · no owner by this name");
    expect(stale).toBeDefined();
    expect(stale?.getAttribute("value")).toBe("Nobody Synthetic");
  });
});
