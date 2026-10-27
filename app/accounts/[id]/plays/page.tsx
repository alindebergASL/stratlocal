import { PlanTabs } from "../playbook/PlaybookNav";
import { currentPlaybook } from "@/lib/playbook/store";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { getAccount, listDeals, listPlanDraftProposals, listPlays } from "@/lib/queries/accounts";
import { providerProblem } from "@/lib/ai/client";
import { ROLES } from "@/lib/ai/models";
import { runningRunFor } from "@/lib/ai/guard";
import { planReadiness } from "@/lib/ai/readiness";
import { fmtDay, fmtMoneyShort } from "@/lib/format";
import { LIVE_PLAY_STATUSES, PLAY_TONE, playStatusLabel } from "@/lib/tone";
import { rankedPlays } from "@/lib/plays/rank";
import { PlayControls } from "./PlayControls";
import { playDealTotals } from "@/lib/accountOverview";
import { Page } from "@/components/Nav";
import { AccountHeader } from "@/components/AccountHeader";
import { ActionForm } from "@/components/ActionForm";
import { RunButton } from "@/components/RunButton";
import { ButtonLink, Callout, Chip, control, Empty, Field, Section } from "@/components/ui";
import { savePlay } from "@/app/actions";

export const dynamic = "force-dynamic";

// The Plan tab: the thesis, the plays, and the way to add or draft more.
// A drafted plan is reviewed on /review, one change at a time — it used to
// be rendered here in full, every thesis diff and linked record of it, and
// it took the page over.
export default async function AccountPlanTab({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const account = getAccount(id);
  if (!account) notFound();
  if (account.kind === "own_work") redirect("/follow-ups");
  const plays = rankedPlays(listPlays(id));
  const liveStatuses: readonly string[] = LIVE_PLAY_STATUSES;
  const groups = [
    { key: "live", title: null as string | null, rows: plays.filter((p) => liveStatuses.includes(p.status)) },
    { key: "info", title: "For information", rows: plays.filter((p) => p.status === "info_only") },
    { key: "closed", title: "Done or set aside", rows: plays.filter((p) => !liveStatuses.includes(p.status) && p.status !== "info_only") },
  ];
  const totals = playDealTotals(plays, listDeals(id));
  const drafted = listPlanDraftProposals(id).length;
  const aiProblem = providerProblem(ROLES.plan_draft.provider);
  const inFlight = runningRunFor(id) !== null;
  const notReady = planReadiness(id);

  return (
    <Page user={user}>
      <AccountHeader account={account} tab="plan" />
      <PlanTabs accountId={id} current="plays" playbook={!!currentPlaybook({ accountId: id })} />
      <Section
        id="plan"
        title="Plan"
        aside={
          <>
            <span>
              {plays.length} play{plays.length === 1 ? "" : "s"}
            </span>
            <RunButton
              url={`/api/accounts/${id}/plan-draft`}
              label="Draft plan"
              busyLabel="Drafting…"
              kind="plan_draft"
              tone="quiet"
              disabledReason={aiProblem ?? notReady ?? (inFlight ? "Another AI run is working on this account." : null)}
            />
          </>
        }
      >
        {drafted > 0 && (
          <Callout tone="warning" className="mb-4 flex flex-wrap items-center justify-between gap-3" testId="plan-draft-waiting">
            <span>
              A drafted plan is waiting: <strong className="tabular-nums">{drafted}</strong> change{drafted === 1 ? "" : "s"} to review. Nothing is applied until one of you accepts it.
            </span>
            <ButtonLink href={`/inbox?kind=changes&account=${id}`} size="sm">
              Review the draft
            </ButtonLink>
          </Callout>
        )}
        <h3 className="mb-1 text-micro font-semibold uppercase tracking-[0.06em] text-ink-muted">How this account is won</h3>
        {account.thesis ? (
          <p className="mb-5 max-w-3xl whitespace-pre-wrap text-lead text-ink">{account.thesis}</p>
        ) : (
          <Empty>No account thesis yet. Draft a plan from what is on file, or write one under Details.</Empty>
        )}
        {plays.length > 0 &&
          groups.map((g) => {
            if (!g.rows.length) return null;
            const list = (
          <ul className={`divide-y divide-line border-t border-line ${g.key === "live" ? "" : "opacity-80"}`} data-testid={g.key === "live" ? "play-scan-list" : `play-group-${g.key}`}>
            {g.rows.map((p, i) => {
              const t = totals.get(p.id);
              return (
                <li key={p.id} className="grid gap-x-4 gap-y-1 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline" data-testid="play-scan-row">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      {g.key === "live" && (
                        <span className="w-6 shrink-0 text-label font-semibold tabular-nums text-ink-muted" data-testid="play-rank">#{i + 1}</span>
                      )}
                      <Link href={`/accounts/${id}/plays/${p.id}`} className="font-semibold text-ink-strong hover:text-accent hover:underline">
                        {p.title}
                      </Link>
                      <Chip tone={PLAY_TONE[p.status] ?? "neutral"}>{playStatusLabel(p.status)}</Chip>
                    </div>
                    <p className="mt-1 text-label">
                      <span className="text-ink-muted">Next: </span>
                      <span className={p.next_step ? "text-ink" : "text-warning"}>{p.next_step || "none set"}</span>
                      {p.next_step_due && <span className="text-ink-muted"> · by {fmtDay(p.next_step_due)}</span>}
                      <span className="text-ink-muted"> · {p.owner || "no owner"}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-label sm:justify-end">
                    <span className="tabular-nums text-ink-muted">{t?.deals ? `${fmtMoneyShort(t.usd)} · ${t.deals} deal${t.deals === 1 ? "" : "s"}` : "no deals linked"}</span>
                    {(g.key === "live" || p.status === "info_only" || p.status === "not_applicable") && <PlayControls accountId={id} playId={p.id} live={g.key === "live"} />}
                  </div>
                </li>
              );
            })}
          </ul>
            );
            return g.title ? (
              <details key={g.key} className="mt-4" open={g.key === "info"} data-testid={`play-section-${g.key}`}>
                <summary className="cursor-pointer text-micro font-semibold uppercase tracking-[0.06em] text-ink-muted">
                  {g.title} · {g.rows.length}
                </summary>
                <div className="mt-2">{list}</div>
              </details>
            ) : (
              <div key={g.key}>
                {list}
              </div>
            );
          })}
        <div className="mt-4">
          <ActionForm action={savePlay.bind(null, id, null)} testId="play-new" trigger="Add play" submitLabel="Add play">
            <Field label="Title" wide>
              <input name="title" required className={control} placeholder="e.g. EHR platform defense" />
            </Field>
            <Field label="Play thesis" hint="The opportunity this play explores, separate from the account thesis." wide>
              <textarea name="thesis" rows={2} className={control} />
            </Field>
            <Field label="Owner">
              <input name="owner" className={control} />
            </Field>
            <Field label="Next step" wide>
              <input name="next_step" className={control} />
            </Field>
            <Field label="Due">
              <input name="next_step_due" type="date" className={control} />
            </Field>
          </ActionForm>
        </div>
      </Section>
    </Page>
  );
}
