"use server";

import { refresh } from "next/cache";
import { requirePageUser } from "@/lib/auth";
import { isLowRisk } from "@/lib/changeDeck";
import { acceptProposal } from "@/lib/proposals/apply";
import { toProposalViews } from "@/lib/proposals/view";
import { listPendingProposals } from "@/lib/queries/accounts";
import { undoAccepted } from "@/lib/proposals/undo";
import { snoozeItem, wakeItem } from "@/lib/inbox/snooze";

// The quick ones on one account, in one press: only the kinds of change a
// glance can verify (a new person, a new task, a date), never money, stage
// or status, and never anything resting on unconfirmed evidence
// (lib/changeDeck.ts). Each still goes through acceptProposal, one by one.
export type QuickResult = { ok: true; message: string; ids: string[] } | { ok: false; error: string };

export async function acceptQuickAction(accountId: string): Promise<QuickResult> {
  const user = await requirePageUser();
  const quick = toProposalViews(accountId, listPendingProposals(accountId)).filter(isLowRisk);
  const ids: string[] = [];
  let refused = 0;
  for (const p of quick) {
    try {
      const r = acceptProposal(p.id, user.id);
      if (r.status === "accepted") ids.push(p.id);
      else refused += 1;
    } catch {
      refused += 1;
    }
  }
  refresh();
  if (ids.length === 0 && refused > 0) return { ok: false, error: "None could be accepted: they changed since. Open Review to see why." };
  return { ok: true, ids, message: `${ids.length} accepted${refused ? `, ${refused} left to review` : ""}` };
}

// Undo of what was just accepted: each goes back to undecided, keeping any
// field someone changed since (lib/proposals/undo.ts).
export async function undoAcceptAction(ids: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requirePageUser();
  let failed = 0;
  for (const id of ids.slice(0, 200)) {
    try {
      undoAccepted(id, user.id);
    } catch {
      failed += 1;
    }
  }
  refresh();
  return failed ? { ok: false, error: `${failed} could not be undone; they had already been changed or undone.` } : { ok: true };
}

export async function snoozeAction(key: string, untilDay: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requirePageUser();
  try {
    snoozeItem(user.id, key, untilDay);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not put that off." };
  }
  refresh();
  return { ok: true };
}

export async function wakeAction(key: string): Promise<{ ok: true }> {
  const user = await requirePageUser();
  wakeItem(user.id, key);
  refresh();
  return { ok: true };
}
