import Link from "next/link";
import { notFound } from "next/navigation";
import { listTeam, listUsers, requirePageUser } from "@/lib/auth";
import { getAccount, listDeals, listPendingProposals } from "@/lib/queries/accounts";
import { scorecard, scorecardForCrm } from "@/lib/playbook/qualification";
import { QUALIFICATION_FIELDS } from "@/lib/playbook/qualificationFields";
import { CopyBlock } from "./CopyBlock";
import { currentPlaybook, listPlaybooks } from "@/lib/playbook/store";
import { archetypeHistory, archetypeOf, pendingArchetype } from "@/lib/playbook/archetype";
import { latestRunOfKind } from "@/lib/playbook/runs";
import { runState } from "@/lib/ai/runState";
import { fmtWhen } from "@/lib/format";
import { Page } from "@/components/Nav";
import { AccountHeader } from "@/components/AccountHeader";
import { ActionForm } from "@/components/ActionForm";
import { Empty, Field, Section, control } from "@/components/ui";
import { ResultButton } from "@/components/ResultButton";
import { RunButton } from "@/components/RunButton";
import { lifecycle, stepDue } from "@/lib/playbook/lifecycle";
import { todayISO } from "@/lib/clock";
import { setAccountPlaybookAction, checkAction, decideArchetypeAction, moveStepAction, readSalesforceAction, sendQualificationAction, setArchetypeAction, setQualificationAction, stepFollowUpAction } from "./actions";
import { CheckItem } from "./CheckItem";
import { dossier } from "@/lib/playbook/dossier";
import { isSalesforceId, salesforceProblem, salesforceSettings } from "@/lib/salesforce/config";
import { qualificationPayload, salesforceLog } from "@/lib/salesforce/sync";

import { fmtMoneyShort } from "@/lib/format";
import { PlaybookNav } from "./PlaybookNav";
import { playbookTemplates } from "@/lib/ask/templates";

export const dynamic = "force-dynamic";

// The account through the team's playbook: which archetype it is and what the
// team believes about it, and (from the next steps) where it is in the
// lifecycle, its qualification and its plan.
export default async function AccountPlaybookPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const account = getAccount(id);
  if (!account) notFound();
  const playbook = currentPlaybook({ accountId: id })?.playbook ?? null;
  const names = new Map(listUsers({ includeInactive: true }).map((u) => [u.id, u.display_name]));
  if (!playbook) {
    return (
      <Page user={user}>
        <AccountHeader account={account} tab="plan" />
        <Empty>
          No playbook yet. <Link href="/settings/playbook" className="font-semibold text-accent hover:underline">Set one up</Link>, from the neutral starter or the team&rsquo;s own document, and every account gets this page.
        </Empty>
      </Page>
    );
  }
  const current = archetypeOf(playbook, account.archetype_id);
  const pending = pendingArchetype(id);
  const suggested = pending ? archetypeOf(playbook, pending.archetypeId) : null;
  const history = archetypeHistory(id);
  const name = (aid: string | null) => archetypeOf(playbook, aid)?.name ?? (aid ? "an archetype no longer in the playbook" : "none");
  const lastRun = latestRunOfKind(id, "playbook_archetype");
  const life = lifecycle(id, playbook);
  const team = listTeam().filter((m) => m.active);
  // "Account executive (Alex)": the playbook's role, and who on the team holds it.
  const roleName = (rid: string | null) => {
    const name = playbook.roles.find((r) => r.id === rid)?.name;
    if (!name) return null;
    const who = team.filter((m) => m.role === rid).map((m) => m.display_name);
    return who.length ? `${name} (${who.join(", ")})` : name;
  };
  const onFile = dossier(account, todayISO());
  const sf = salesforceSettings();
  const sfProblem = sf.enabled ? salesforceProblem(sf) : null;
  const sfOpportunities = sf.enabled ? listDeals(id).filter((d) => isSalesforceId(d.deal_id)).sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1)) : [];
  const sfLast = sf.enabled ? salesforceLog(1, id)[0] : undefined;
  const card = scorecard(account);
  const confirmed = card.filter((r) => r.status === "confirmed").length;
  const waiting = listPendingProposals(id).filter((p) => p.entity_type === "account" && Object.keys(JSON.parse(p.payload_json) as object).some((k) => (QUALIFICATION_FIELDS as readonly string[]).includes(k))).length;
  const due = life.current && life.since !== null ? stepDue(life.current.step, todayISO(new Date(life.since))) : null;

  return (
    <Page user={user}>
      <AccountHeader account={account} tab="plan" />
      <PlaybookNav accountId={id} current="status" />
      {(() => {
        const books = listPlaybooks();
        if (books.length < 2) return null;
        const using = books.find((b) => b.slug === account.playbook_slug) ?? books.find((b) => b.isDefault)!;
        return (
          <div className="mb-4 flex flex-wrap items-center gap-2 text-label" data-testid="account-playbook-uses">
            <span className="text-ink-muted">Uses</span>
            <span className="font-semibold text-ink" data-testid="account-playbook-name">{using.name}</span>
            {using.isDefault && <span className="text-micro text-ink-muted">the team&rsquo;s default</span>}
            <ActionForm action={setAccountPlaybookAction.bind(null, id)} trigger="Change" submitLabel="Use it" testId="account-playbook-set">
              <Field label="Playbook">
                <select name="playbook_slug" defaultValue={using.slug} className={control}>
                  {books.map((b) => <option key={b.slug} value={b.slug}>{b.name}{b.isDefault ? " (default)" : ""}</option>)}
                </select>
              </Field>
            </ActionForm>
          </div>
        );
      })()}
      <Section title="Archetype" aside={<span>{playbook.name}</span>}>
        <div data-testid="playbook-archetype">
          {current ? (
            <div className="rounded-lg bg-accent-soft p-3 text-label">
              <p className="font-display text-heading font-bold text-ink-strong" data-testid="archetype-current">{current.name}</p>
              {account.archetype_hypothesis && <p className="mt-1 text-body text-ink" data-testid="archetype-hypothesis">{account.archetype_hypothesis}</p>}
              <dl className="mt-2 grid gap-x-4 gap-y-1 text-micro sm:grid-cols-3">
                {current.posture && <div><dt className="font-semibold text-ink-muted">Posture</dt><dd className="text-ink">{current.posture}</dd></div>}
                {current.pain && <div><dt className="font-semibold text-ink-muted">Pain</dt><dd className="text-ink">{current.pain}</dd></div>}
                {current.entry_point && <div><dt className="font-semibold text-ink-muted">Where to start</dt><dd className="text-ink">{current.entry_point}</dd></div>}
              </dl>
            </div>
          ) : (
            <p className="text-label text-ink-muted">Not placed yet. Ask for a suggestion from what is on file and kept research, or choose one.</p>
          )}

          {pending && suggested && (
            <div className="mt-3 rounded-lg border border-warning-line bg-warning-soft p-3 text-label" data-testid="archetype-suggestion">
              <p>
                <span className="font-semibold text-ink-strong">Suggested: {suggested.name}.</span> {pending.hypothesis}
              </p>
              {pending.why && <p className="mt-1 text-micro text-ink-muted">Why: {pending.why}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                <ResultButton run={decideArchetypeAction.bind(null, id, pending.id, true)} variant="primary" testId="archetype-accept">Use this</ResultButton>
                <ResultButton run={decideArchetypeAction.bind(null, id, pending.id, false)} testId="archetype-reject">Not this</ResultButton>
              </div>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-start gap-3">
            {!pending && (
              <RunButton
                url={`/api/accounts/${id}/archetype`}
                label={current ? "Suggest again" : "Suggest an archetype"}
                busyLabel="Reading the account…"
                tone="quiet"
                initialRun={lastRun && lastRun.status === "running" ? { id: lastRun.id, state: runState(lastRun) } : null}
                disabledReason={account.archived_at ? "That account is archived." : null}
              />
            )}
            <ActionForm action={setArchetypeAction.bind(null, id)} trigger={current ? "Change it by hand" : "Choose by hand"} submitLabel="Save" testId="archetype-set">
              <Field label="Archetype">
                <select name="archetype_id" defaultValue={account.archetype_id ?? ""} className={control}>
                  <option value="">None</option>
                  {playbook.archetypes.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Hypothesis" hint="Two sentences: what you believe is true here, and want to test." wide>
                <textarea name="archetype_hypothesis" rows={3} maxLength={2000} defaultValue={account.archetype_hypothesis ?? ""} className={control} />
              </Field>
            </ActionForm>
          </div>

          {history.length > 0 && (
            <details className="mt-3 text-label">
              <summary className="cursor-pointer text-ink-muted">How it has moved ({history.length})</summary>
              <ul className="mt-1 space-y-0.5 text-micro text-ink" data-testid="archetype-history">
                {history.map((h, i) => (
                  <li key={i}>
                    {fmtWhen(h.at)}: {name(h.from)} → <span className="font-semibold">{name(h.to)}</span>
                    {h.by ? ` · ${names.get(h.by) ?? "someone"}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </Section>

      <Section title="Lifecycle" id="lifecycle" aside={life.current ? <span>Step {life.current.index + 1} of {life.steps.length}</span> : undefined}>
        <div data-testid="playbook-lifecycle">
          {!life.started ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-sunk px-4 py-3">
              <p className="text-label text-ink">Not started. Put the account on a step and the next thing to do shows on its Overview.</p>
              <ResultButton run={moveStepAction.bind(null, id, playbook.steps[0]!.id)} variant="primary" testId="playbook-start">Start at {playbook.steps[0]!.name}</ResultButton>
            </div>
          ) : (
            life.next && (
              <p className="mb-3 rounded-lg border border-accent-line bg-accent-soft px-4 py-2.5 text-label text-ink" data-testid="playbook-next">
                <span className="font-semibold text-ink-strong">Next in the playbook:</span> {life.next.text}
              </p>
            )
          )}
          <ol className="mt-3 space-y-2">
            {life.steps.map((s) => {
              const isCurrent = life.current?.step.id === s.step.id;
              const past = life.current ? s.index < life.current.index : false;
              const owner = roleName(s.step.owner_role);
              return (
                <li key={s.step.id} className={`rounded-lg border px-4 py-3 ${isCurrent ? "border-accent-line bg-surface" : "border-line"}`} data-testid="playbook-step" data-current={isCurrent ? "true" : undefined}>
                  <details open={isCurrent}>
                    <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span className="min-w-0">
                        <span className={`mr-2 inline-flex size-6 items-center justify-center rounded-full text-micro font-bold ${isCurrent ? "bg-ink text-ink-invert" : past ? "bg-surface-sunk text-ink" : "bg-surface-sunk text-ink-muted"}`}>{s.index + 1}</span>
                        <span className={`font-semibold ${isCurrent ? "text-ink-strong" : "text-ink"}`}>{s.step.name}</span>
                      </span>
                      <span className="text-micro text-ink-muted tabular-nums">
                        {s.checks.length ? `${s.done} of ${s.checks.length}` : ""}
                        {isCurrent && life.since !== null ? `${s.checks.length ? " · " : ""}here since ${fmtWhen(life.since)}` : ""}
                      </span>
                    </summary>
                    <div className="mt-2 space-y-2 pl-8">
                      <p className="text-micro text-ink-muted">
                        {[s.step.timebox && `Timebox: ${s.step.timebox}`, s.step.output && `Output: ${s.step.output}`, owner && `Led by ${owner}`].filter(Boolean).join(" · ")}
                      </p>
                      {s.step.detail && <p className="text-label text-ink">{s.step.detail}</p>}
                      {s.index === 0 && (
                        <div className="grid gap-2 rounded-lg bg-surface-sunk p-3 text-label sm:grid-cols-3" data-testid="playbook-dossier">
                          <div className="min-w-0">
                            <p className="text-micro font-medium uppercase tracking-[0.06em] text-ink-muted">Installed base</p>
                            {onFile.installBase.asOf ? (
                              <>
                                <p className="font-semibold text-ink tabular-nums" data-testid="dossier-install-base">
                                  {fmtMoneyShort(onFile.installBase.totalUsd)} · {onFile.installBase.lines} line{onFile.installBase.lines === 1 ? "" : "s"}
                                </p>
                                <ul className="text-micro text-ink-muted">
                                  {onFile.installBase.top.slice(0, 3).map((r) => (
                                    <li key={r.family} className="truncate">
                                      {r.family}
                                      {r.valueUsd != null ? ` ${fmtMoneyShort(r.valueUsd)}` : ""}
                                      {r.gone ? ` · not in the latest report${r.wasUsd != null ? ` (was ${fmtMoneyShort(r.wasUsd)})` : ""}` : r.changeUsd ? ` · ${r.changeUsd > 0 ? "+" : "−"}${fmtMoneyShort(Math.abs(r.changeUsd))}` : ""}
                                    </li>
                                  ))}
                                </ul>
                                <Link href={`/accounts/${id}/install-base`} className="text-micro font-semibold text-accent hover:underline">As of {onFile.installBase.asOf} →</Link>
                              </>
                            ) : (
                              <Link href={`/accounts/${id}/import`} className="text-micro font-semibold text-accent hover:underline">Import a report →</Link>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-micro font-medium uppercase tracking-[0.06em] text-ink-muted">Research</p>
                            <p className="font-semibold text-ink">{onFile.research.kept ? `${onFile.research.kept} note${onFile.research.kept === 1 ? "" : "s"} kept` : "None kept yet"}</p>
                            <Link href={`/accounts/${id}/research`} className="text-micro font-semibold text-accent hover:underline">
                              {onFile.research.lastKept ? `Last ${fmtWhen(onFile.research.lastKept)} →` : "Research it →"}
                            </Link>
                          </div>
                          <div className="min-w-0">
                            <p className="text-micro font-medium uppercase tracking-[0.06em] text-ink-muted">Budget</p>
                            <p className="font-semibold text-ink">{onFile.budget.fiscalStart ? `Next fiscal year ${onFile.budget.fiscalStart}` : "Not on file"}</p>
                            <Link href={`/accounts/${id}/playbook/roadmap#budget`} className="text-micro font-semibold text-accent hover:underline">
                              {onFile.budget.fiscalStart || onFile.budget.calendar ? "Budget calendar →" : "Add it →"}
                            </Link>
                          </div>
                        </div>
                      )}
                      {s.checks.length > 0 && (
                        <ul>
                          {s.checks.map((c) => (
                            <CheckItem
                              key={c.item}
                              label={c.item}
                              done={c.doneAt !== null}
                              detail={c.doneAt !== null ? `${fmtWhen(c.doneAt)}${c.doneBy ? ` · ${names.get(c.doneBy) ?? "someone"}` : ""}` : null}
                              toggle={checkAction.bind(null, id, s.step.id, c.item)}
                            />
                          ))}
                        </ul>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {!isCurrent && <ResultButton run={moveStepAction.bind(null, id, s.step.id)} testId="playbook-move">Move here</ResultButton>}
                        {isCurrent && due && (
                          <ResultButton run={stepFollowUpAction.bind(null, id, s.step.id)} testId="playbook-step-follow-up">
                            Add a follow-up due {due}
                          </ResultButton>
                        )}
                      </div>
                    </div>
                  </details>
                </li>
              );
            })}
          </ol>
        </div>
      </Section>

      <Section title="Write it with Ask" id="write">
        <div className="flex flex-wrap gap-2" data-testid="playbook-artifacts">
          {playbookTemplates(playbook).map((t) => (
            <Link key={t.id} href={`/accounts/${id}/ask?template=${t.id}`} className="inline-flex min-h-9 items-center rounded-full border border-line px-3 text-label font-medium text-ink hover:border-accent hover:text-accent">
              {t.name}
            </Link>
          ))}
        </div>
      </Section>

      <Section title="Qualification" id="qualification" aside={<span>{confirmed} of {card.length} confirmed</span>}>
        <div data-testid="playbook-qualification">
          {waiting > 0 && (
            <p className="mb-3 rounded-lg border border-warning-line bg-warning-soft px-4 py-2.5 text-label text-ink" data-testid="qualification-waiting">
              {waiting} change{waiting === 1 ? "" : "s"} from meeting notes waiting.{" "}
              <Link href={`/inbox?kind=changes&account=${id}`} className="font-semibold text-accent hover:underline">Review</Link>
            </p>
          )}
          <ul className="divide-y divide-line">
            {card.map((r) => (
              <li key={r.element} className="py-2.5" data-testid="qualification-row" data-element={r.element} data-status={r.status}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="min-w-0">
                    <span className="mr-2 inline-block w-7 font-semibold text-ink-muted tabular-nums">{r.element}</span>
                    <span className="font-semibold text-ink">{r.label}</span>
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-micro font-semibold ring-1 ${r.status === "confirmed" ? "bg-positive-soft text-positive ring-positive-line" : r.status === "partial" ? "bg-warning-soft text-warning ring-warning-line" : "text-ink-muted ring-line"}`}
                    data-testid="qualification-status"
                  >
                    {r.status === "confirmed" ? "Confirmed" : r.status === "partial" ? "Partial" : "Unknown"}
                  </span>
                </div>
                {r.evidence && <p className="mt-1 pl-9 text-label text-ink">{r.evidence}</p>}
                <div className="mt-1 pl-9">
                  <ActionForm action={setQualificationAction.bind(null, id, r.field)} trigger="Edit" submitLabel="Save" testId={`qualification-edit-${r.element}`}>
                    <Field label="Status">
                      <select name="status" defaultValue={r.status} className={control}>
                        <option value="unknown">Unknown</option>
                        <option value="partial">Partial</option>
                        <option value="confirmed">Confirmed</option>
                      </select>
                    </Field>
                    <Field label="Evidence">
                      <textarea name="evidence" defaultValue={r.evidence} rows={2} maxLength={1000} className={control} />
                    </Field>
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t border-line pt-3">
            <CopyBlock text={scorecardForCrm(account.name, card, todayISO())} label="Copy for Salesforce" testId="qualification-copy" />
          </div>
          {sf.enabled && (
            <div className="mt-3 space-y-2 border-t border-line pt-3 text-label" data-testid="qualification-salesforce">
              <p className="font-semibold text-ink-strong">Salesforce</p>
              {sfProblem ? (
                <p className="text-ink-muted">{sfProblem}</p>
              ) : !isSalesforceId(account.crm_id) ? (
                <p className="text-ink-muted">
                  Put the account&rsquo;s Salesforce id in its <Link href={`/accounts/${id}/details`} className="font-semibold text-accent hover:underline">CRM ID</Link> to read it and write to it.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <ResultButton run={readSalesforceAction.bind(null, id)} testId="sf-read">Read from Salesforce</ResultButton>
                    {sfLast && <span className="text-micro text-ink-muted">{sfLast.direction === "write" ? "Last sent" : "Last read"} {fmtWhen(sfLast.at)}{sfLast.status === "failed" ? " (failed)" : ""}</span>}
                  </div>
                  {(() => {
                    const payload = qualificationPayload(card, sf, todayISO());
                    if (!payload) return <p className="text-micro text-ink-muted">Name the scorecard&rsquo;s Salesforce fields under <Link href="/settings/salesforce" className="font-semibold text-accent hover:underline">Settings, Salesforce</Link> to send it.</p>;
                    if (!sfOpportunities.length) return <p className="text-micro text-ink-muted">No Salesforce opportunity on this account yet. Read from Salesforce first.</p>;
                    return (
                      <ActionForm action={sendQualificationAction.bind(null, id)} trigger="Send the scorecard to Salesforce" submitLabel="Send" testId="sf-send">
                        <Field label="Opportunity" wide>
                          <select name="opportunity_id" className={control}>
                            {sfOpportunities.map((d) => <option key={d.deal_id} value={d.deal_id}>{d.name}{d.status !== "open" ? ` (${d.status})` : ""}</option>)}
                          </select>
                        </Field>
                        <div className="basis-full">
                          <p className="mb-1 text-micro text-ink-muted">Exactly what will be written:</p>
                          <pre className="max-h-48 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-sunk p-2 text-micro text-ink" data-testid="sf-preview">
                            {Object.entries(payload).map(([k, v]) => `${k}: ${v}`).join("\n")}
                          </pre>
                        </div>
                      </ActionForm>
                    );
                  })()}
                </>
              )}
            </div>
          )}
        </div>
      </Section>
    </Page>
  );
}
