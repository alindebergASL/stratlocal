import Link from "next/link";
import { BackLink } from "@/components/BackLink";
import { requirePageUser } from "@/lib/auth";
import { listBacklog } from "@/lib/queries/attention";
import { parseOwnerScope } from "@/lib/queries/owner";
import { homeHref } from "@/lib/glance";
import { RECENT_OVERDUE_DAYS } from "@/lib/today";
import { addDays, daysBetween, todayISO } from "@/lib/clock";
import { fmtDay } from "@/lib/format";
import { Page } from "@/components/Nav";
import { SortSession } from "./SortSession";

export const dynamic = "force-dynamic";

// The backlog, one card at a time.
//
// A hundred follow-ups past due is not a list anyone reads; it is a weight.
// Today counts them in one line and links here, where each gets one decision
// — done, a new date, or let go — and the pile visibly shrinks. Nothing is
// deleted: "let go" archives, which hides the follow-up everywhere and keeps
// its history (DECISIONS #8).
//
// `who` is Today's account scope, not /follow-ups' assignee filter: this is
// the list behind Today's count, so it has to be the same set.
export default async function SortPage({ searchParams }: { searchParams: Promise<{ who?: string | string[] }> }) {
  const user = await requirePageUser();
  const query = await searchParams;
  const scope = parseOwnerScope(typeof query.who === "string" ? query.who : undefined, user.id);
  const now = new Date();
  const today = todayISO(now);
  const backlog = listBacklog(now, scope, RECENT_OVERDUE_DAYS);
  // Dates are formatted here, by the one clock, and handed to the browser as
  // text: the card never asks the browser what day it is (DECISIONS #12).
  const items = backlog.items.map((i) => ({ ...i, dueLabel: fmtDay(i.due, now), lateDays: daysBetween(i.due, today) }));
  const picks = [
    { label: "Tomorrow", day: addDays(today, 1) },
    { label: "In a week", day: addDays(today, 7) },
    { label: "In two weeks", day: addDays(today, 14) },
  ].map((p) => ({ ...p, shown: fmtDay(p.day, now) }));
  return (
    <Page user={user} main="max-w-2xl">
      <div className="mb-4"><BackLink fallback={homeHref(scope.filter)} fallbackLabel="Back to Today" /></div>
      <SortSession items={items} total={backlog.total} today={today} picks={picks} backHref={homeHref(scope.filter)} />
    </Page>
  );
}
