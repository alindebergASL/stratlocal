import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { getAccount, listPlays } from "@/lib/queries/accounts";
import { todayISO } from "@/lib/clock";
import { fmtDay } from "@/lib/format";
import { MONTHS, nextFiscalStart, roadmap } from "@/lib/playbook/roadmap";
import { Page } from "@/components/Nav";
import { PlaybookNav } from "../PlaybookNav";
import { AccountHeader } from "@/components/AccountHeader";
import { ActionForm } from "@/components/ActionForm";
import { Empty, Field, Section, control } from "@/components/ui";
import { addMilestoneAction, setBudgetCalendarAction, setPhaseAction } from "./actions";

export const dynamic = "force-dynamic";

const PHASE_NAME: Record<number, string> = { 1: "Phase 1 · first", 2: "Phase 2 · next", 3: "Phase 3 · later" };

// The joint roadmap in three phases and the Mutual Action Plan: dated
// milestones on the roadmap's plays, read against when the customer's money
// is set.
export default async function RoadmapPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const account = getAccount(id);
  if (!account) notFound();
  const today = todayISO();
  const { phases, milestones } = roadmap(id);
  const onRoadmap = phases.flatMap((p) => p.plays);
  const fiscal = nextFiscalStart(account, today);
  const offRoadmap = listPlays(id).filter((p) => !p.phase);

  return (
    <Page user={user}>
      <AccountHeader account={account} tab="plan" />
      <PlaybookNav accountId={id} current="roadmap" />

      <Section title="Budget calendar" id="budget">
        <div data-testid="budget-calendar">
          <p className="text-label text-ink">
            {account.fiscal_year_start_month ? (
              <>
                Fiscal year starts in <span className="font-semibold">{MONTHS[account.fiscal_year_start_month - 1]}</span>; the next one on{" "}
                <span className="font-semibold tabular-nums" data-testid="fiscal-next">{fmtDay(fiscal)}</span>.
              </>
            ) : (
              "When the customer's fiscal year starts is not on file yet."
            )}
          </p>
          {account.budget_calendar && <p className="mt-1 whitespace-pre-line text-label text-ink">{account.budget_calendar}</p>}
          <div className="mt-2">
            <ActionForm action={setBudgetCalendarAction.bind(null, id)} trigger={account.fiscal_year_start_month || account.budget_calendar ? "Edit" : "Add it"} submitLabel="Save" testId="budget-edit">
              <Field label="Fiscal year starts">
                <select name="fiscal_year_start_month" defaultValue={account.fiscal_year_start_month ?? ""} className={control}>
                  <option value="">Not known</option>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </Field>
              <Field label="When budgets are submitted and approved" wide>
                <textarea name="budget_calendar" defaultValue={account.budget_calendar ?? ""} rows={3} maxLength={4000} className={control} />
              </Field>
            </ActionForm>
          </div>
        </div>
      </Section>

      <Section title="Roadmap" id="roadmap" aside={<Link href={`/accounts/${id}/playbook/workshop`} className="font-semibold text-accent hover:underline">Workshop →</Link>}>
        {onRoadmap.length === 0 ? (
          <Empty>Nothing on the roadmap yet. Score use cases in the workshop and add them by phase, or put an existing play in a phase below.</Empty>
        ) : (
          <div className="grid gap-3 md:grid-cols-3" data-testid="roadmap-phases">
            {phases.map((p) => (
              <div key={p.phase} className="rounded-lg border border-line p-3" data-testid="roadmap-phase" data-phase={p.phase}>
                <h3 className="text-label font-semibold text-ink-strong">{PHASE_NAME[p.phase]}</h3>
                {p.plays.length === 0 ? (
                  <p className="mt-1 text-micro text-ink-muted">Nothing here yet.</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {p.plays.map((play) => (
                      <li key={play.id} className="text-label">
                        <Link href={`/accounts/${id}/plays/${play.id}`} className="font-semibold text-ink hover:text-accent hover:underline">{play.title}</Link>
                        <span className="ml-1.5 text-micro text-ink-muted">{play.status}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
        {offRoadmap.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-label text-ink-muted">Put another play on the roadmap ({offRoadmap.length})</summary>
            <ul className="mt-2 space-y-1">
              {offRoadmap.map((play) => (
                <li key={play.id} className="flex flex-wrap items-center justify-between gap-2 text-label">
                  <span className="min-w-0 text-ink">{play.title}</span>
                  <ActionForm action={setPhaseAction.bind(null, id, play.id)} trigger="Choose a phase" submitLabel="Save">
                    <Field label="Phase">
                      <select name="phase" defaultValue="1" className={control}>
                        <option value="1">Phase 1</option>
                        <option value="2">Phase 2</option>
                        <option value="3">Phase 3</option>
                      </select>
                    </Field>
                  </ActionForm>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Section>

      <Section
        title="Mutual action plan"
        id="map"
        aside={
          milestones.some((m) => m.status === "open" && m.due) ? (
            <a href={`/accounts/${id}/playbook/roadmap/ics`} download className="font-semibold text-accent hover:underline" data-testid="map-ics">
              Add to calendar
            </a>
          ) : (
            <span>{milestones.filter((m) => m.status === "open").length} open</span>
          )
        }
      >
        <div data-testid="map">
          {milestones.length === 0 ? (
            <Empty>No dated milestones yet. Add the steps both sides agreed, each on a roadmap item, and they become follow-ups with their dates.</Empty>
          ) : (
            <ol className="divide-y divide-line">
              {milestones.map((m) => {
                const late = m.status === "open" && m.due && m.due < today;
                const afterFiscal = fiscal && m.due && m.due >= fiscal;
                return (
                  <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2" data-testid="map-milestone">
                    <span className="min-w-0">
                      <Link href={`/follow-ups/${m.id}`} className={`font-semibold hover:underline ${m.status === "done" ? "text-ink-muted line-through" : "text-ink"}`}>{m.text}</Link>
                      <span className="block text-micro text-ink-muted">{m.play.title}</span>
                    </span>
                    <span className={`shrink-0 text-micro tabular-nums ${late ? "font-semibold text-danger" : "text-ink-muted"}`}>
                      {m.due ? fmtDay(m.due) : "no date"}
                      {afterFiscal ? " · next fiscal year" : ""}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          {onRoadmap.length > 0 && (
            <div className="mt-3">
              <ActionForm action={addMilestoneAction.bind(null, id)} trigger="Add a milestone" submitLabel="Add" testId="map-add">
                <Field label="Milestone" wide>
                  <input name="text" required maxLength={500} className={control} />
                </Field>
                <Field label="Roadmap item">
                  <select name="play_id" className={control}>
                    {onRoadmap.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                  </select>
                </Field>
                <Field label="Date">
                  <input type="date" name="due" className={control} />
                </Field>
              </ActionForm>
            </div>
          )}
        </div>
      </Section>
    </Page>
  );
}
