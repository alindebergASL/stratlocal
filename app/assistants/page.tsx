import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { dailyCapCents, monthSpendByBucket, peopleSpentCents, projectedCents, todaySpend } from "@/lib/ai/guard";
import { ASSISTANTS, MODE_LABEL } from "@/lib/assistants/registry";
import { allAssistantSettings, budgetSettings, reservedCents } from "@/lib/assistants/settings";
import { recentAssistantRuns, runRepeats } from "@/lib/assistants/runs";
import { lastTick, schedulerSecret } from "@/lib/assistants/scheduler";
import { todayParts } from "@/lib/clock";
import { fmtWhen } from "@/lib/format";
import { Page } from "@/components/Nav";
import { ActionForm } from "@/components/ActionForm";
import { AssistantControls } from "@/components/AssistantControls";
import { Card, Chip, control, Field, Section } from "@/components/ui";
import { Icon } from "@/components/icons";
import { recommendedOnAction, runAssistantNow, saveAssistantAction, saveBudgetAction, setWatchedAction } from "./actions";
import { ResultButton } from "@/components/ResultButton";

const RECOMMENDED = ["promise_keeper", "meeting_prep", "plan_keeper", "account_watch"];
import { watchedAccounts, watchEstimate } from "@/lib/assistants/accountWatch";
import { listAccountChoices } from "@/lib/queries/accounts";
import { relativeDays } from "@/lib/format";
import { WatchList } from "@/components/WatchList";

export const dynamic = "force-dynamic";

const $ = (c: number) => `$${(c / 100).toFixed(2)}`;
const plain = (c: number) => (c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2));

// Each assistant's colour in the budget bar. Tokens only (DECISIONS #10).
const BAR: Record<string, { solid: string; soft: string }> = {
  people: { solid: "bg-accent", soft: "bg-accent-line" },
  meeting_prep: { solid: "bg-positive", soft: "bg-positive-line" },
  promise_keeper: { solid: "bg-warning", soft: "bg-warning-line" },
};

// Five minutes is the loop's interval; three missed in a row is "not running".
const TICK_STALE_MS = 15 * 60_000;

export default async function AssistantsPage() {
  const user = await requirePageUser();
  const budget = budgetSettings();
  const settings = allAssistantSettings();
  const month = monthSpendByBucket();
  const reserved = reservedCents(settings);
  const peopleCap = budget.monthlyTotalCents - reserved;
  const peopleSpent = peopleSpentCents(month, settings);
  let totalSpent = 0;
  for (const s of month.values()) totalSpent += projectedCents(s);
  const day = todaySpend();
  const { year, month: m, day: d } = todayParts();
  const daysInMonth = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const pace = d / daysInMonth;
  const tickAt = lastTick();
  const secret = !!schedulerSecret();
  const ticking = tickAt != null && Date.now() - tickAt < TICK_STALE_MS;
  const runs = recentAssistantRuns(null, 8);
  const watched = watchedAccounts();
  const estimate = watchEstimate(watched);
  const watchSetting = settings.find((x) => x.id === "account_watch")!;
  const pct = (c: number) => (budget.monthlyTotalCents > 0 ? Math.max(0, Math.min(100, (c / budget.monthlyTotalCents) * 100)) : 0);

  const autos = settings.filter((s) => s.mode === "auto" && s.monthlyCents > 0);
  const segments = [
    { key: "people", label: "You", spent: Math.min(peopleSpent, budget.monthlyTotalCents), held: 0, cap: peopleCap },
    ...autos.map((s) => {
      const spent = projectedCents(month.get(s.id));
      return { key: s.id, label: ASSISTANTS.find((a) => a.id === s.id)!.name, spent, held: Math.max(0, s.monthlyCents - spent), cap: s.monthlyCents };
    }),
  ];

  return (
    <Page user={user} main="max-w-4xl">
      <header className="mb-8">
        <h1 className="font-display text-display font-extrabold tracking-tight text-ink-strong">Assistants</h1>
        <p className="mt-2 max-w-2xl text-lead text-ink">
          They work on their own and leave what they find for you. None changes a record.
        </p>
        <p className={`mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-label ${ticking ? "bg-positive-soft text-positive" : "bg-warning-soft text-warning"}`} data-testid="scheduler-status">
          <Icon name="clock" />
          {ticking
            ? `The scheduler last checked in at ${fmtWhen(tickAt)}.`
            : tickAt
              ? `The scheduler has not checked in since ${fmtWhen(tickAt)}. Assistants set to On its own are waiting.`
              : secret
                ? "The scheduler has not checked in yet. Assistants set to On its own are waiting."
                : "Assistants can't start on their own on this server yet, so they run only when you press Run now. Whoever runs the server switches this on by setting SCHEDULER_SECRET."}
        </p>
        {RECOMMENDED.some((id) => settings.find((x) => x.id === id)?.mode !== "auto") && (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-label" data-testid="assistants-recommended">
            <ResultButton run={recommendedOnAction} variant="primary" testId="assistants-recommended-on">Turn on the recommended four</ResultButton>
            <span className="text-ink-muted">Promise keeper, Meeting prep, Plan keeper and Account watch, each within its own limit.</span>
          </div>
        )}
      </header>

      <Section title="This month's AI budget" id="budget" aside={<span>Resets on the 1st</span>}>
        <p className="font-display text-title font-bold text-ink-strong" data-testid="budget-total">
          {$(totalSpent)} <span className="text-lead font-normal text-ink-muted">of {$(budget.monthlyTotalCents)}</span>
        </p>
        <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-surface-sunk" role="img" aria-label={`${$(totalSpent)} of ${$(budget.monthlyTotalCents)} spent this month`} data-testid="budget-bar">
          {segments.map((s) => (
            <span key={s.key} className="contents">
              {s.spent > 0 && <span className={`${BAR[s.key]?.solid ?? "bg-ink-faint"} h-full`} style={{ width: `${pct(s.spent)}%` }} />}
              {s.held > 0 && <span className={`${BAR[s.key]?.soft ?? "bg-line"} h-full`} style={{ width: `${pct(s.held)}%` }} />}
            </span>
          ))}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-micro text-ink-muted">
          {segments.map((s) => (
            <li key={s.key} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={`size-2.5 rounded-full ${BAR[s.key]?.solid ?? "bg-ink-faint"}`} />
              <span className="font-medium text-ink">{s.label}</span> {$(s.spent)} of {$(s.cap)}
              {s.cap > 0 && s.spent > s.cap * pace * 1.2 && <span className="text-warning">· ahead of pace</span>}
            </li>
          ))}
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-full bg-line" />
            Daily stop {$(day.cents)} of {$(dailyCapCents())} today
          </li>
        </ul>
        <p className="mt-3 max-w-2xl text-label text-ink-muted">
          Your presses, Run now included, share {$(peopleCap)} a month; an assistant on its own keeps its own limit.
        </p>
        <ActionForm action={saveBudgetAction} trigger="Change the budget" submitLabel="Save budget" testId="budget-edit" className="mt-4 flex flex-wrap items-end gap-3">
          <Field label="Monthly total ($)">
            <input name="total" inputMode="decimal" defaultValue={plain(budget.monthlyTotalCents)} className={`${control} w-32`} required />
          </Field>
          <Field label="Your share ($)">
            <input name="share" inputMode="decimal" defaultValue={plain(budget.peopleShareCents)} className={`${control} w-32`} required />
          </Field>
        </ActionForm>
      </Section>

      <h2 className="mb-3 mt-10 font-display text-heading font-bold text-ink-strong">Working for you</h2>
      <div className="grid gap-4 md:grid-cols-2" data-testid="assistant-list">
        {ASSISTANTS.filter((a) => a.availability === "modes").map((a) => {
          const s = settings.find((x) => x.id === a.id)!;
          const spent = projectedCents(month.get(a.id));
          const last = recentAssistantRuns(a.id, 1)[0];
          return (
            <Card key={a.id} className="flex flex-col p-5" >
              <div data-testid={`assistant-${a.id}`} className="flex flex-1 flex-col">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-display text-lead font-bold text-ink-strong">{a.name}</h3>
                  <Chip tone={s.mode === "auto" ? "positive" : s.mode === "off" ? "neutral" : "info"}>{MODE_LABEL[s.mode]}</Chip>
                </div>
                <p className="mt-1.5 text-label text-ink">{a.does}</p>
                <p className="mt-2 text-micro text-ink-muted">
                  On its own: {a.schedule}. {a.usesModel
                    ? `${$(spent)} of ${$(s.monthlyCents)} this month${s.mode === "auto" && spent > 0 && pace > 0 ? `, on pace for ${$(Math.round(spent / pace))}` : ""}.`
                    : "Reads your records only, so it uses no AI and costs nothing."}
                  {a.where ? ` ${a.where}` : ""}
                </p>
                <p className="mt-1 text-micro text-ink-muted" data-testid={`assistant-last-${a.id}`}>
                  {last ? `Last looked ${fmtWhen(last.finished_at ?? last.started_at)}${last.trigger === "manual" ? " (Run now)" : ""}: ${last.summary ?? (last.status === "running" ? "still working" : last.error ?? last.status)}` : "Has not run yet."}
                </p>
                <div className="mt-4 border-t border-line pt-4">
                  <AssistantControls
                    // Remounted when the mode changes elsewhere (Turn on the
                    // recommended four), so the buttons never show a stale one.
                    key={`${a.id}-${s.mode}-${s.monthlyCents}`}
                    id={a.id}
                    name={a.name}
                    mode={s.mode}
                    limitDollars={plain(s.monthlyCents)}
                    usesModel={a.usesModel}
                    save={saveAssistantAction.bind(null, a.id)}
                    runNow={runAssistantNow.bind(null, a.id)}
                  />
                </div>
                {a.id === "account_watch" && (
                  <div className="mt-4 border-t border-line pt-4">
                    <WatchList
                      watched={watched.map((w) => ({ id: w.id, name: w.name, lastLook: w.lastLook ? relativeDays(w.lastLook) : null, draftWaiting: w.draftWaiting, running: w.running }))}
                      accounts={listAccountChoices().map((x) => ({ id: x.id, name: x.name }))}
                      estimate={
                        watched.length === 0
                          ? `A look usually costs about ${$(estimate.perLookCents)}. Add the accounts worth a weekly look.`
                          : `About ${$(estimate.perLookCents)} a look, so about ${$(estimate.monthlyCents)} a month for ${watched.length}, against its ${$(watchSetting.monthlyCents)} limit${estimate.monthlyCents > watchSetting.monthlyCents ? ". That is over: it will stop at the limit and say so." : "."}`
                      }
                      setWatched={setWatchedAction}
                    />
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <h2 className="mb-3 mt-10 font-display text-heading font-bold text-ink-strong">Works when you press</h2>
      <ul className="space-y-2 text-label" data-testid="assistant-pressed">
        {ASSISTANTS.filter((a) => a.availability === "pressed").map((a) => (
          <li key={a.id} className="rounded-xl border border-line bg-surface px-4 py-3">
            <span className="font-semibold text-ink-strong">{a.name}</span> <span className="text-ink">· {a.does}</span>
            <span className="mt-0.5 block text-micro text-ink-muted">{a.where} Charged to your share.</span>
          </li>
        ))}
      </ul>

      {ASSISTANTS.some((a) => a.availability === "later") && (
      <>
      <h2 className="mb-3 mt-10 font-display text-heading font-bold text-ink-strong">Coming next</h2>
      <ul className="grid gap-2 text-label sm:grid-cols-3" data-testid="assistant-later">
        {ASSISTANTS.filter((a) => a.availability === "later").map((a) => (
          <li key={a.id} className="rounded-xl bg-surface-sunk px-4 py-3">
            <span className="font-semibold text-ink-strong">{a.name}</span>
            <span className="mt-0.5 block text-micro text-ink-muted">{a.does}</span>
            <span className="mt-1 block text-micro text-ink-muted">{a.where}</span>
          </li>
        ))}
      </ul>
      </>
      )}

      <Section title="What they did" id="runs" className="mt-10" empty={runs.length === 0}>
        {runs.length === 0 ? (
          <p className="text-label text-ink-muted">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-line text-label" data-testid="assistant-runs">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
                <span className="w-36 shrink-0 text-micro text-ink-muted">{fmtWhen(r.started_at)}</span>
                <span className="font-medium text-ink-strong">{ASSISTANTS.find((a) => a.id === r.assistant)?.name ?? r.assistant}</span>
                <span className="min-w-0 flex-1 text-ink">{r.summary ?? r.error ?? r.status}</span>
                <span className="text-micro text-ink-muted">{r.trigger === "schedule" ? "on its own" : "Run now"}{r.status === "failed" ? " · failed" : ""}{runRepeats(r) > 1 ? ` · ${runRepeats(r)} times, last ${fmtWhen(r.finished_at ?? r.started_at)}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-micro text-ink-muted">
          Model runs and their costs are on <Link href="/activity" className="text-accent hover:underline">Activity</Link>.
        </p>
      </Section>
    </Page>
  );
}
