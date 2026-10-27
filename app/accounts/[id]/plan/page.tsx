import Link from "next/link";
import { rankedPlays } from "@/lib/plays/rank";
import { BackLink } from "@/components/BackLink";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { getAccount, listContacts, listDeals, listPlays } from "@/lib/queries/accounts";
import { listActionItems } from "@/lib/queries/meetings";
import { addDays, dayOf, daysBetween, todayISO, todayLabel } from "@/lib/clock";
import { fmtDay, fmtMoney, stageText } from "@/lib/format";
import { PLAY_TONE, playStatusLabel } from "@/lib/tone";
import { openPlanQuestions, playActivity, QUIET_DAYS } from "@/lib/assistants/planKeeper";
import { assistantMode } from "@/lib/assistants/settings";
import { planCards } from "@/lib/plan/cards";
import { Nav } from "@/components/Nav";
import { Chip } from "@/components/ui";
import { PlanQuestions } from "@/components/PlanQuestions";
import { dismissPlanQuestion, editThesisAction, setNextStepAction, setPlayStatusAction } from "@/app/plans/actions";

export const dynamic = "force-dynamic";


function parseIds(json: string): string[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// The account plan as a document: the thesis, then each play with what it
// rests on, then the deals no play covers. Read on screen or printed; edited
// where each record lives, or by answering Plan keeper's questions at the top.
export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const account = getAccount(id);
  if (!account) notFound();
  const now = new Date();
  const today = todayISO(now);
  const plays = rankedPlays(listPlays(id));
  const deals = listDeals(id);
  const dealsById = new Map(deals.map((d) => [d.deal_id, d]));
  const people = new Map(listContacts(id).map((c) => [c.id, c]));
  const followUps = listActionItems(id, { status: "open" });
  const activity = playActivity(id);
  const covered = new Set(plays.filter((p) => p.status !== "dropped" && p.status !== "not_applicable").flatMap((p) => parseIds(p.deal_ids_json)));
  const uncovered = deals.filter((d) => d.status === "open" && !covered.has(d.deal_id));
  const cards = assistantMode("plan_keeper") === "off" ? [] : planCards(openPlanQuestions(user.id, { everyone: true, accountId: id, today }));
  const picks = [
    { label: "This week", day: addDays(today, 4) },
    { label: "In two weeks", day: addDays(today, 14) },
    { label: "In a month", day: addDays(today, 30) },
  ].map((p) => ({ ...p, shown: fmtDay(p.day, now) }));

  return (
    <div data-print="document" className="lg:flex">
      <Nav user={user} />
      <main className="mx-auto w-full min-w-0 max-w-3xl px-4 py-6 text-body max-sm:pb-24 lg:px-10 lg:py-10">
        <div data-print-hide className="mb-6 flex flex-wrap justify-between gap-3 text-label">
          <BackLink fallback={`/accounts/${id}/plays`} fallbackLabel={`${account.name}: Plan`} />
          <span className="text-micro text-ink-muted">Print or save as PDF for a copy to hand over.</span>
        </div>

        <header className="mb-8 border-b border-line pb-5">
          <p className="text-label font-medium text-ink-muted">Account plan · {todayLabel(now)}</p>
          <h1 className="mt-1 font-display text-display font-extrabold tracking-tight text-ink-strong [overflow-wrap:anywhere]">{account.name}</h1>
          {account.archived_at && <p className="mt-1 text-warning">Archived account — {account.archived_at}</p>}
        </header>

        {cards.length > 0 && (
          <section data-print-hide className="mb-10" id="check-in" data-testid="plan-check-in">
            <h2 className="mb-3 font-display text-heading font-bold text-ink-strong">Plan keeper asks</h2>
            <PlanQuestions cards={cards} picks={picks} today={today} showAccount={false} answers={{ setNextStep: setNextStepAction, setStatus: setPlayStatusAction, editThesis: editThesisAction, dismiss: dismissPlanQuestion }} />
          </section>
        )}

        <section className="mb-10" id="thesis">
          <h2 className="mb-2 text-micro font-bold uppercase tracking-[0.08em] text-ink-muted">How this account is won</h2>
          {account.thesis ? (
            <p className="whitespace-pre-wrap font-display text-lead leading-relaxed text-ink-strong" data-testid="plan-thesis-text">{account.thesis}</p>
          ) : (
            <p className="text-ink-muted">No thesis yet. <Link href={`/accounts/${id}/plays`} className="text-accent hover:underline">Draft one from what is on file</Link>, or write it in the account details.</p>
          )}
        </section>

        <section className="mb-10" id="plays">
          <h2 className="mb-4 text-micro font-bold uppercase tracking-[0.08em] text-ink-muted">Plays · {plays.length}</h2>
          {plays.length === 0 && <p className="text-ink-muted">No plays yet.</p>}
          <ol className="space-y-8">
            {plays.map((p, i) => {
              const linkedDeals = parseIds(p.deal_ids_json).map((d) => dealsById.get(d)).filter((d): d is NonNullable<typeof d> => !!d);
              const linkedPeople = parseIds(p.contact_ids_json).map((c) => people.get(c)).filter((c): c is NonNullable<typeof c> => !!c);
              const work = followUps.filter((f) => f.play_id === p.id);
              const last = activity.get(p.id);
              const quietDays = last ? daysBetween(dayOf(last), today) : null;
              const late = p.next_step_due && p.next_step_due < today;
              const open = linkedDeals.filter((d) => d.status === "open");
              return (
                <li key={p.id} className="break-inside-avoid" data-testid="plan-play">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-display text-heading font-bold text-ink-muted">{i + 1}.</span>
                    <Link href={`/accounts/${id}/plays/${p.id}`} className="font-display text-heading font-bold text-ink-strong hover:underline [overflow-wrap:anywhere]">{p.title}</Link>
                    <Chip tone={PLAY_TONE[p.status] ?? "neutral"}>{playStatusLabel(p.status)}</Chip>
                    {quietDays != null && quietDays >= QUIET_DAYS && ["active", "proposed"].includes(p.status) && <Chip tone="warning">quiet {quietDays} days</Chip>}
                  </div>
                  {p.thesis && <p className="mt-2 text-body text-ink">{p.thesis}</p>}
                  <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-label sm:grid-cols-[8rem_minmax(0,1fr)]">
                    <dt className="text-ink-muted">Next step</dt>
                    <dd className={p.next_step ? "text-ink-strong" : "text-warning"}>
                      {p.next_step || "none set"}
                      {p.next_step_due && <span className={late ? " text-warning" : " text-ink-muted"}> · {late ? "was due" : "by"} {fmtDay(p.next_step_due, now)}</span>}
                    </dd>
                    <dt className="text-ink-muted">Owner</dt>
                    <dd className="text-ink">{p.owner || "unassigned"}</dd>
                    {linkedDeals.length > 0 && (
                      <>
                        <dt className="text-ink-muted">Deals</dt>
                        <dd className="text-ink">
                          <ul className="space-y-0.5">
                            {linkedDeals.map((d) => (
                              <li key={d.deal_id}>
                                <Link href={`/accounts/${id}/deals/${encodeURIComponent(d.deal_id)}`} className="hover:underline">{d.name}</Link>
                                <span className="text-ink-muted"> · {stageText(d.stage, d.stage_label)} · {fmtMoney(d.tcv_usd)}{d.close_date ? ` · closes ${fmtDay(d.close_date, now)}` : ""}{d.status !== "open" ? ` · ${d.status}` : ""}</span>
                              </li>
                            ))}
                          </ul>
                          {open.length > 1 && <p className="mt-0.5 text-micro text-ink-muted">{fmtMoney(open.reduce((n, d) => n + (d.tcv_usd ?? 0), 0))} open across {open.length}</p>}
                        </dd>
                      </>
                    )}
                    {linkedPeople.length > 0 && (
                      <>
                        <dt className="text-ink-muted">People</dt>
                        <dd className="text-ink">{linkedPeople.map((c) => `${c.name}${c.title ? ` (${c.title})` : ""}`).join(", ")}</dd>
                      </>
                    )}
                    {work.length > 0 && (
                      <>
                        <dt className="text-ink-muted">Open follow-ups</dt>
                        <dd className="text-ink">
                          <ul className="list-disc space-y-0.5 pl-4">
                            {work.slice(0, 5).map((f) => (
                              <li key={f.id}>{f.text}{f.due ? <span className="text-ink-muted"> · {fmtDay(f.due, now)}</span> : null}</li>
                            ))}
                          </ul>
                          {work.length > 5 && <p className="text-micro text-ink-muted">and {work.length - 5} more on the account</p>}
                        </dd>
                      </>
                    )}
                    <dt className="text-ink-muted">Last moved</dt>
                    <dd className="text-ink-muted">{last ? `${fmtDay(dayOf(last), now)}${quietDays ? ` · ${quietDays} day${quietDays === 1 ? "" : "s"} ago` : " · today"}` : "—"}</dd>
                  </dl>
                </li>
              );
            })}
          </ol>
        </section>

        {uncovered.length > 0 && (
          <section className="mb-10 break-inside-avoid" id="uncovered" data-testid="plan-uncovered">
            <h2 className="mb-2 text-micro font-bold uppercase tracking-[0.08em] text-ink-muted">Open deals no play covers · {uncovered.length}</h2>
            <ul className="space-y-1 text-label">
              {uncovered.slice(0, 20).map((d) => (
                <li key={d.deal_id}>
                  <Link href={`/accounts/${id}/deals/${encodeURIComponent(d.deal_id)}`} className="text-ink-strong hover:underline">{d.name}</Link>
                  <span className="text-ink-muted"> · {stageText(d.stage, d.stage_label)} · {fmtMoney(d.tcv_usd)}{d.close_date ? ` · closes ${fmtDay(d.close_date, now)}` : ""}</span>
                </li>
              ))}
            </ul>
            {uncovered.length > 20 && <p className="mt-1 text-micro text-ink-muted">and {uncovered.length - 20} more on the account&apos;s Deals.</p>}
          </section>
        )}
      </main>
    </div>
  );
}
