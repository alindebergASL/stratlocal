// The neutral starter and synthetic notes only. AI_FAKE replay only.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { seedAccount, USER } from "./helpers";
import { db } from "@/lib/db";
import { getRun } from "@/lib/ai/guard";
import { acceptProposal, applyEntityChange } from "@/lib/proposals/apply";
import { getAccount, listPendingProposals } from "@/lib/queries/accounts";
import { getMeeting } from "@/lib/queries/meetings";
import { startExtractRun } from "@/lib/meetings/run";
import { diffMeetingExtraction } from "@/lib/meetings/diffMeeting";
import { savePlaybook } from "@/lib/playbook/store";
import { STARTER_PLAYBOOK } from "@/lib/playbook/starter";
import { qualificationGaps, scorecard, scorecardForCrm } from "@/lib/playbook/qualification";

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, name: "Synthetic User", email: "synthetic@example.test" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

beforeEach(() => {
  vi.stubEnv("AI_FAKE", "1");
  vi.stubEnv("AI_DAILY_CAP_CENTS", "10000");
});
afterEach(() => vi.unstubAllEnvs());

const NOTES = "Synthetic notes from the call.\nThe director said the budget for this is set each spring by the finance board.\nWe agreed to send the readout on Friday.";

async function extract(accountId: string, meetingId: string) {
  applyEntityChange({ accountId, entityType: "meeting", op: "update", entityId: meetingId, payload: { raw_notes: NOTES }, actorUserId: USER });
  const runId = startExtractRun(getMeeting(meetingId)!, USER);
  await vi.waitFor(() => expect(getRun(runId)?.status).toBe("done"));
}

it("asks for no qualification when the team has no playbook", async () => {
  const { accountId, meetingId } = seedAccount();
  await extract(accountId, meetingId);
  expect(listPendingProposals(accountId).some((p) => p.payload_json.includes("meddpicc_"))).toBe(false);
});

it("proposes qualification from notes, quoted, and sets it only when accepted", async () => {
  savePlaybook({ playbook: STARTER_PLAYBOOK, userId: USER, basisId: null });
  const { accountId, meetingId } = seedAccount();
  expect(qualificationGaps(scorecard(getAccount(accountId)!))).toEqual([]);
  await extract(accountId, meetingId);
  const q = listPendingProposals(accountId).find((p) => p.payload_json.includes("meddpicc_e"))!;
  expect(JSON.parse(q.payload_json)).toEqual({ meddpicc_e: { status: "partial", evidence: expect.stringContaining("finance board") } });
  expect(JSON.parse(q.source_ref_json!).quote).toContain("budget for this is set");
  expect(scorecard(getAccount(accountId)!).find((r) => r.element === "E")?.status).toBe("unknown");

  const { default: Page } = await import("@/app/accounts/[id]/playbook/page");
  const render = async () => parseHTML(renderToStaticMarkup(await Page({ params: Promise.resolve({ id: accountId }) }))).document;
  expect((await render()).querySelector('[data-testid="qualification-waiting"]')?.textContent).toContain("1 change");

  acceptProposal(q.id, USER);
  const card = scorecard(getAccount(accountId)!);
  expect(card.find((r) => r.element === "E")).toMatchObject({ status: "partial", evidence: expect.stringContaining("finance board") });
  expect(qualificationGaps(card)).toEqual(["M", "E", "DC", "DP", "P", "I", "CH", "CO"]);
  const history = db().prepare("SELECT field FROM change_log WHERE entity_id = ? AND field LIKE 'meddpicc_%'").all(accountId) as Array<{ field: string }>;
  expect(history.map((h) => h.field)).toEqual(["meddpicc_e"]);

  const doc = await render();
  expect(doc.querySelector('[data-testid="qualification-row"][data-element="E"]')?.getAttribute("data-status")).toBe("partial");
  const crm = scorecardForCrm("Synthetic Orchard Lab", card, "2026-10-23");
  expect(crm.split("\n")[0]).toBe("MEDDPICC: Synthetic Orchard Lab (2026-10-23) · 0 of 8 confirmed");
  expect(crm).toContain("Economic buyer: [Partial] ");
  expect(crm).toContain("Metrics: [Unknown] —");
});

it("never takes a confirmed element back to partial, and edits by hand", async () => {
  savePlaybook({ playbook: STARTER_PLAYBOOK, userId: USER, basisId: null });
  const { accountId } = seedAccount();
  const { setQualificationAction } = await import("@/app/accounts/[id]/playbook/actions");
  const fd = new FormData();
  fd.set("status", "confirmed");
  fd.set("evidence", "Synthetic finance director signs off.");
  expect(await setQualificationAction(accountId, "meddpicc_e", fd)).toEqual({ ok: true });
  expect(await setQualificationAction(accountId, "not_a_field", fd)).toMatchObject({ ok: false });
  const rows = scorecard(getAccount(accountId)!);
  const pack = { deals: [], plays: [], contacts: [] } as never;
  const extraction = { summary: "", action_items: [], deal_updates: [], play_updates: [], contact_updates: [] };
  const drafts = diffMeetingExtraction(
    { ...extraction, qualification: [
      { element: "E", status: "partial", evidence: "Someone mentioned money.", quote: "money" },
      { element: "CH", status: "partial", evidence: "A synthetic sponsor wants this.", quote: "sponsor" },
    ] },
    pack,
    { meetingId: "m", currentSummary: null, qualification: { accountId, rows } },
  );
  expect(drafts.map((d) => Object.keys(d.payload))).toEqual([["meddpicc_ch"]]);

  const clear = new FormData();
  clear.set("status", "unknown");
  await setQualificationAction(accountId, "meddpicc_e", clear);
  expect(scorecard(getAccount(accountId)!).find((r) => r.element === "E")?.status).toBe("unknown");
});
