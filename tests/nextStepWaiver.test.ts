// Synthetic deals only.
import { expect, it, vi } from "vitest";
import { seedAccount, USER } from "./helpers";
import { db } from "@/lib/db";
import { applyEntityChange } from "@/lib/proposals/apply";
import { getDeal } from "@/lib/queries/accounts";
import { needsNextStep, waiverActive } from "@/lib/deals/nextStep";
import { accountSignals } from "@/lib/queries/accountSignals";
import { listAttention } from "@/lib/queries/attention";
import { needsYou } from "@/lib/accountOverview";
import { dayCounts } from "@/lib/queries/today";
import { needsALook } from "@/lib/queries/needsALook";
import { currentFiscalQuarter } from "@/lib/fiscal";
import { EVERYTHING } from "@/lib/queries/owner";

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, name: "Synthetic User", email: "synthetic@example.test" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const NOW = new Date("2026-10-23T12:00:00Z");
const TODAY = "2026-10-23";

it("the rule: open, no next step, nothing waived; until a day or while it stands", () => {
  const d = { status: "open", next_step: null };
  expect(needsNextStep(d, TODAY)).toBe(true);
  expect(needsNextStep({ ...d, next_step: "Call" }, TODAY)).toBe(false);
  expect(needsNextStep({ ...d, status: "won" }, TODAY)).toBe(false);
  expect(waiverActive({ ...d, next_step_waived: "until", next_step_waived_until: TODAY }, TODAY)).toBe(true);
  expect(waiverActive({ ...d, next_step_waived: "until", next_step_waived_until: "2026-10-22" }, TODAY)).toBe(false);
  expect(waiverActive({ ...d, next_step_waived: "info" }, TODAY)).toBe(true);
});

it("acknowledged deals leave every 'no next step' check, and come back when the deal moves", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  try {
    const fq = currentFiscalQuarter(NOW).label;
    const { accountId, dealId } = seedAccount({ closeDate: "2026-12-01" });
    applyEntityChange({ accountId, entityType: "deal", op: "update", entityId: dealId, payload: { next_step: null, fiscal_quarter: fq }, actorUserId: USER });
    const flagged = () => ({
      signals: accountSignals([accountId], NOW).get(accountId)!.noNextStep,
      attention: listAttention(NOW, EVERYTHING).filter((a) => a.kind === "no_next_step" && a.dealId === dealId).length,
      today: dayCounts(NOW, EVERYTHING).noNextStep,
      look: needsALook(null, NOW).items.filter((i) => i.dealId === dealId && i.reason === "no_next_step").length,
      overview: needsYou({ accountId, today: TODAY, now: NOW, followUps: [], pending: 0, planDraft: 0, meetings: [], deals: [getDeal(dealId)!] as never, plays: [], researchDrafts: 0 }).some((n) => n.key === "next-steps"),
    });
    expect(flagged()).toEqual({ signals: 1, attention: 1, today: 1, look: 1, overview: true });

    const { waiveNextStepAction, clearWaiverAction } = await import("@/app/deals/actions");
    const fd = new FormData();
    fd.set("reason", "Synthetic: waiting on their budget vote");
    fd.set("kind", "info");
    expect(await waiveNextStepAction(accountId, dealId, new FormData())).toMatchObject({ ok: false });
    expect(await waiveNextStepAction(accountId, dealId, fd)).toEqual({ ok: true });
    expect(flagged()).toEqual({ signals: 0, attention: 0, today: 0, look: 0, overview: false });

    // A change of stage ends it, and history says so.
    applyEntityChange({ accountId, entityType: "deal", op: "update", entityId: dealId, payload: { stage: 4 }, actorUserId: USER });
    expect(getDeal(dealId)?.next_step_waived ?? null).toBeNull();
    expect(flagged().signals).toBe(1);
    const log = db().prepare("SELECT field FROM change_log WHERE entity_id = ? AND field = 'next_step_waived'").all(dealId);
    expect(log.length).toBe(2);

    // Until a day: back once the day has passed.
    fd.set("kind", "until");
    fd.set("until", "2026-11-01");
    await waiveNextStepAction(accountId, dealId, fd);
    expect(flagged().signals).toBe(0);
    vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
    expect(accountSignals([accountId], new Date()).get(accountId)!.noNextStep).toBe(1);

    expect(await clearWaiverAction(accountId, dealId)).toMatchObject({ ok: true });
    expect(getDeal(dealId)?.next_step_waived ?? null).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
