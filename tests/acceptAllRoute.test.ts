// SYNTHETIC ONLY: invented sandbox ids.
//
// "Accept all" is pressed over a list. The route used to take every pending
// proposal on the account (or in a batch) at the moment the request landed,
// so a proposal that arrived after the list was drawn was applied by a button
// that never showed it; the client could only notice afterwards. The screen
// now sends the ids it rendered and the route honours exactly those.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { createProposalBatch } from "@/lib/proposals/apply";
import { seedAccount, type Seed } from "./helpers";
vi.mock("@/lib/auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth")>()), requireUser: () => ({ id: "user-1" }) }));
import { POST } from "@/app/api/accounts/[id]/proposals/accept-all/route";

let seed: Seed;
beforeEach(() => {
  seed = seedAccount();
});

function propose(text: string) {
  return createProposalBatch(seed.accountId, { kind: "meeting", id: seed.meetingId, aiRunId: null }, [
    { entity_type: "action_item", op: "create", payload: { text, status: "open", meeting_id: seed.meetingId }, rationale: "synthetic" },
  ]);
}
async function post(body: unknown) {
  return POST(new NextRequest(`http://localhost/api/accounts/${seed.accountId}/proposals/accept-all`, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }), { params: Promise.resolve({ id: seed.accountId }) });
}
async function acceptAll(body: Record<string, unknown>) {
  const res = await POST(new NextRequest(`http://localhost/api/accounts/${seed.accountId}/proposals/accept-all`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: seed.accountId }) });
  return (await res.json()) as { accepted: number; outcomes: Array<{ id: string; status: string }> };
}
const status = (id: string) => (db().prepare("SELECT status FROM proposals WHERE id = ?").get(id) as { status: string }).status;

describe("accept-all applies what was shown", () => {
  it("leaves a proposal that arrived after the list was drawn pending", async () => {
    const shown = propose("Synthetic follow-up the person saw");
    const late = propose("Synthetic follow-up that arrived afterwards");
    // No batch id: the two are in different batches anyway, and the point is
    // that the id list alone is enough to keep the late one out.
    const reply = await acceptAll({ ids: shown.ids });
    expect(reply.accepted).toBe(1);
    expect(reply.outcomes.map((o) => o.id)).toEqual(shown.ids);
    expect(status(shown.ids[0]!)).toBe("accepted");
    expect(status(late.ids[0]!)).toBe("pending");
  });

  it("refuses a request with no list, and changes nothing", async () => {
    const a = propose("Synthetic one");
    const res = await post({});
    expect(res.status).toBe(400);
    expect(status(a.ids[0]!)).toBe("pending");
  });

  it("refuses a body it cannot read — malformed, or too large — and changes nothing", async () => {
    // Both used to fall back to `{}`, which meant "everything pending".
    const shown = propose("Synthetic shown");
    const other = propose("Synthetic unrelated");
    expect((await post("{not json")).status).toBe(400);
    expect((await post({ ids: Array.from({ length: 10_000 }, (_, i) => `x${i}-${"y".repeat(30)}`) })).status).toBe(413);
    expect((await post(null)).status).toBe(400);
    expect(status(shown.ids[0]!)).toBe("pending");
    expect(status(other.ids[0]!)).toBe("pending");
  });

  it("accepts a large selection exactly, and nothing outside it", async () => {
    const shown = Array.from({ length: 420 }, (_, i) => propose(`Synthetic selected ${i}`).ids[0]!);
    const unrelated = propose("Synthetic unrelated").ids[0]!;
    const reply = await acceptAll({ ids: shown });
    expect(reply.accepted).toBe(420);
    expect(status(unrelated)).toBe("pending");
  });

  it("ignores ids that are not pending on this account rather than failing the batch", async () => {
    const a = propose("Synthetic one");
    const reply = await acceptAll({ ids: [...a.ids, "not-a-proposal"] });
    expect(reply.accepted).toBe(1);
    expect(reply.outcomes.map((o) => o.id)).toEqual(a.ids);
  });
});
