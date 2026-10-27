// What changed while I was away.
//
// change_log records one row per changed field, with who and when and the
// source ref that produced it — and until now it was read on exactly one
// screen, a single deal's own page. Account, contact, play, meeting,
// follow-up, install-base and document history was written and never shown,
// and the only cross-account view was Home's three-day, twelve-row block.
//
// Two people share these accounts. Coming back from a week off, there was no
// way to find out what your partner had changed: the window is applied inside
// the SQL, so an older change was not pushed off the bottom of the list, it
// was never selected.
//
// When a record carries two names on one day, they both edited it. That is a
// report, not a warning — the refusal that stops the second save destroying
// the first one's work happens in lib/proposals/apply.ts, before the write.
//
// idx_change_log_account is (account_id, created_at DESC) — the exact shape of
// this page, built for it before it existed.
import Link from "next/link";
import { requirePageUser, listUsers } from "@/lib/auth";
import { OwnerTabs } from "@/components/OwnerTabs";
import { ownerLabels, parseOwnerScope, type OwnerFilter } from "@/lib/queries/owner";
import { listAccountChoices } from "@/lib/queries/accounts";
import { entityLabels } from "@/lib/queries/labels";
import { originLabel, recentChanges } from "@/lib/queries/today";
import { fmtDay, relativeDays } from "@/lib/format";
import { dayOf } from "@/lib/clock";
import { Page } from "@/components/Nav";
import { AccountLink, ChangeSummary, Empty, Eyebrow, PageHeader, Section } from "@/components/ui";

export const dynamic = "force-dynamic";

const WINDOWS = [1, 3, 7, 30] as const;

function windowLabel(days: number): string {
  if (days === 1) return "today";
  if (days === 7) return "this week";
  if (days === 30) return "this month";
  return `last ${days} days`;
}

// Who is behind a row. Usually one person; two means they both edited the same
// record on the same day, which is worth reading rather than hiding behind
// whichever name happened to sort higher.
function actorText(actors: string[], names: Map<string, string>): string {
  if (actors.length === 0) return "the app";
  const named = actors.map((id) => names.get(id) ?? "someone");
  if (named.length === 1) return named[0]!;
  if (named.length === 2) return `${named[0]} and ${named[1]}`;
  return `${named[0]} and ${named.length - 1} others`;
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; account?: string; who?: string }>;
}) {
  const user = await requirePageUser();
  const params = await searchParams;
  const days = WINDOWS.includes(Number(params.days) as (typeof WINDOWS)[number]) ? Number(params.days) : 7;
  // Whose accounts. The account picker below narrows to one; this narrows to
  // a person's, which is the question you actually have after a week away.
  const scope = parseOwnerScope(params.who, user.id);
  const users = listUsers();
  const accounts = listAccountChoices();
  const accountId = accounts.some((a) => a.id === params.account) ? params.account! : null;
  const account = accounts.find((a) => a.id === accountId) ?? null;

  const now = new Date();
  // Generous: this is the page you open precisely because you want more than
  // the twelve rows Home shows.
  const changes = recentChanges(now.getTime() - days * 86_400_000, 200, accountId, scope);

  const names = new Map(users.map((u) => [u.id, u.display_name]));
  // Only hand edits need a label map, and only for the accounts on the list —
  // entityLabels runs eight table scans per account, and a batch row names
  // itself.
  const labelsByAccount = new Map(
    [...new Set(changes.filter((c) => c.kind === "edit").map((c) => c.accountId))].map((id) => [id, entityLabels(id)] as const),
  );

  // Grouped by the day it happened, in the app's timezone, newest first.
  const byDay = new Map<string, typeof changes>();
  for (const c of changes) {
    const day = dayOf(c.at);
    byDay.set(day, [...(byDay.get(day) ?? []), c]);
  }

  const href = (over: { days?: number; account?: string | null; who?: OwnerFilter }) => {
    const q = new URLSearchParams();
    const d = over.days ?? days;
    if (d !== 7) q.set("days", String(d));
    const a = over.account === undefined ? accountId : over.account;
    if (a) q.set("account", a);
    const w = over.who ?? scope.filter;
    if (w !== "all") q.set("who", w);
    const qs = q.toString();
    return `/activity${qs ? `?${qs}` : ""}`;
  };

  return (
    <Page user={user}>
      <PageHeader
        title="What changed"
        sub={`${changes.length === 200 ? "The most recent 200" : `${changes.length} change${changes.length === 1 ? "" : "s"}`} ${windowLabel(days)}${account ? ` on ${account.name}` : " across every account"}.`}
      />

      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-label">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-ink-muted">Since</span>
          {WINDOWS.map((d) => (
            <Link
              key={d}
              href={href({ days: d })}
              aria-current={d === days ? "page" : undefined}
              className={`rounded-md px-2 py-0.5 transition-colors ${d === days ? "bg-accent-soft font-semibold text-accent" : "text-ink-muted hover:bg-surface-sunk hover:text-ink"}`}
            >
              {windowLabel(d)}
            </Link>
          ))}
        </span>
        {accounts.length > 1 && (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-ink-muted">On</span>
            <Link
              href={href({ account: null })}
              aria-current={accountId === null ? "page" : undefined}
              className={`rounded-md px-2 py-0.5 transition-colors ${accountId === null ? "bg-accent-soft font-semibold text-accent" : "text-ink-muted hover:bg-surface-sunk hover:text-ink"}`}
            >
              everything
            </Link>
            {accounts.map((a) => (
              <Link
                key={a.id}
                href={href({ account: a.id })}
                aria-current={a.id === accountId ? "page" : undefined}
                className={`rounded-md px-2 py-0.5 transition-colors ${a.id === accountId ? "bg-accent-soft font-semibold text-accent" : "text-ink-muted hover:bg-surface-sunk hover:text-ink"}`}
              >
                {a.name}
              </Link>
            ))}
          </span>
        )}
        {users.length > 1 && (
          <OwnerTabs
            current={scope.filter}
            labels={ownerLabels(users, user.id)}
            href={(f) => href({ who: f })}
            testId="activity-owner"
          />
        )}
      </div>

      {changes.length === 0 ? (
        <Section title="Quiet">
          <Empty>
            Nothing changed {windowLabel(days)}
            {account ? ` on ${account.name}` : ""}. Try a longer window.
          </Empty>
        </Section>
      ) : (
        <Section title="By day">
          <div className="space-y-5">
            {[...byDay.entries()].map(([day, rows]) => (
              <div key={day}>
                <Eyebrow className="mb-1">
                  {fmtDay(day, now)} · {relativeDays(rows[0]!.at, now.getTime())}
                </Eyebrow>
                <ul className="divide-y divide-line">
                  {rows.map((c) => (
                    <li
                      key={c.kind === "batch" ? c.batchId : `${c.entityType}-${c.entityId}-${c.at}`}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2"
                    >
                      <span className="min-w-0">
                        {c.kind === "batch" ? (
                          <>
                            <span className="font-medium text-ink">{originLabel(c.origin)} accepted</span>
                            <span className="ml-2 text-micro text-ink-muted">
                              {c.fields} change{c.fields === 1 ? "" : "s"} across {c.records} record{c.records === 1 ? "" : "s"}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="font-medium text-ink">
                              {labelsByAccount.get(c.accountId)?.[c.entityId] ?? c.entityType.replace(/_/g, " ")}
                            </span>
                            <ChangeSummary
                              changes={c.changes}
                              max={3}
                              labels={(someId) => labelsByAccount.get(c.accountId)?.[someId]}
                            />
                          </>
                        )}
                      </span>
                      <span className="flex items-baseline gap-2 text-micro text-ink-muted">
                        {/* Who did it. The whole point of the page, when there
                            are two of you sharing the accounts — so two names
                            on one record are said plainly rather than reduced
                            to one. */}
                        <span
                          className={c.actors.length > 1 ? "font-medium text-warning" : undefined}
                          title={c.actors.length > 1 ? "Both of you changed this record on this day" : undefined}
                        >
                          {actorText(c.actors, names)}
                        </span>
                        {!accountId && <AccountLink id={c.accountId} name={c.accountName} className="text-label" />}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      )}
    </Page>
  );
}
