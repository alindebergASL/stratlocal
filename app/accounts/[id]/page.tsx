import { localOnly } from "@/lib/localMode";
import { LocalOverview } from "@/components/local/Workspace";
import Link from "next/link";
import { weekSummary } from "@/lib/queries/ourWork";
import { workLine } from "@/components/WeekStrip";
import { theirSide } from "@/lib/theirSide";
import { keptPeers } from "@/lib/research/peers";
import { notFound, redirect } from "next/navigation";
import { listUsers, requirePageUser } from "@/lib/auth";
import { getAccount, listContacts, listDeals, listPendingProposals, listPlanDraftProposals, listPlays } from "@/lib/queries/accounts";
import { listActionItems, listMeetings } from "@/lib/queries/meetings";
import { followUpViews } from "@/lib/followUpViews";
import { keptFindings, listNotes } from "@/lib/research/notes";
import { DOSSIER_TOPICS } from "@/lib/research/coverage";
import { accountVitals, needsYou, playDealTotals, type NeedsYouItem } from "@/lib/accountOverview";
import { currentFiscalQuarter } from "@/lib/fiscal";
import { todayISO } from "@/lib/clock";
import { currentPlaybook } from "@/lib/playbook/store";
import { lifecycle } from "@/lib/playbook/lifecycle";
import { fmtDay, fmtMoney, fmtMoneyShort, stageText } from "@/lib/format";
import { LIVE_PLAY_STATUSES, PLAY_TONE, playStatusLabel, ROLE_LABELS } from "@/lib/tone";
import { rankedPlays } from "@/lib/plays/rank";
import { waiverActive } from "@/lib/deals/nextStep";
const LIVE: readonly string[] = LIVE_PLAY_STATUSES;
import { Page } from "@/components/Nav";
import { AccountHeader } from "@/components/AccountHeader";
import { ActionItems } from "@/components/ActionItems";
import { TaskAnchorRecovery } from "@/components/TaskAnchorRecovery";
import { ArchiveButton } from "@/components/ArchiveButton";
import { OpenOnHash } from "@/components/OpenOnHash";
import { PlanningCapture } from "@/components/PlanningCapture";
import { Callout, Chip, Empty, Section, stageTone } from "@/components/ui";
import { restoreRecord, setActionItemStatus } from "@/app/actions";
import { ResearchPanel, type ResearchPanelView } from "./ResearchPanel";
import { AccountSince, WhereItStands } from "@/components/AccountSince";
import { WrittenParagraph } from "@/components/WrittenParagraph";
import { WriteWhenStale } from "@/components/WriteWhenStale";
import { factsHash, writtenFor } from "@/lib/writer/core";
import { accountFacts, accountKey } from "@/lib/writer/account";
import { accountLead } from "@/lib/writer/lead";
import { writerOn } from "@/lib/assistants/writer";
import { WatchPace } from "@/components/WatchPace";
import { SeenAccount } from "@/components/SeenToday";
import { whereItStands } from "@/lib/accounts/whereItStands";
import { sinceLooked } from "@/lib/accounts/sinceLooked";
import { accountSince } from "@/lib/accounts/lastLooked";
import { entityLabels } from "@/lib/queries/labels";
import { watchPace } from "@/lib/assistants/accountWatch";
import { setWatchPaceAction } from "./research/watchActions";
import { briefItemsOf, overviewLeads } from "@/lib/research/brief";
import { confirmedEntity } from "@/lib/research/run";
import { focusForResearch } from "@/lib/teamDirection";

export const dynamic = "force-dynamic";

const TOP_DEALS = 5;
const PLAYS_SHOWN = 5;
const PEOPLE_SHOWN = 6;
// Soonest due first; the whole list is the Follow-ups tab.
const FOLLOW_UPS_SHOWN = 5;

// The account at a glance. It used to be every record on file in one scroll,
// with the same overdue follow-up shown four times and the open pipeline at
// the bottom inside a closed disclosure. Now: the numbers you open it for,
// at most four things that need one of you, the biggest deals beside the
// plan, the people on their side, research, and the follow-ups. Every full
// list is a tab away (components/AccountHeader.tsx).
export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const account = getAccount(id);
  if (!account) notFound();
  // Own work is an account only so a todo with no customer has somewhere to
  // hang; the destination sends you where the todos actually are.
  if (account.kind === "own_work") redirect("/follow-ups");

  if (localOnly()) return <LocalOverview account={account} user={user}/>;
  const now = new Date();
  const today = todayISO(now);
  const isArchived = account.archived_at != null;
  const deals = listDeals(id);
  const open = deals.filter((d) => d.status === "open");
  const plays = listPlays(id);
  const contacts = listContacts(id);
  const meetings = listMeetings(id);
  const pending = listPendingProposals(id);
  const planDraft = listPlanDraftProposals(id).length;
  const openItems = listActionItems(id, { status: "open" });
  const acceptedNotes = listNotes(id, "accepted");
  const draftNotes = listNotes(id, "draft");

  const vitals = accountVitals({ deals, meetings, today, quarter: currentFiscalQuarter(now).label, now });
  const playbook = currentPlaybook({ accountId: id })?.playbook;
  const life = playbook ? lifecycle(id, playbook) : null;
  const playbookNext = life?.next ? { text: life.next.text, step: life.current!.step.name, position: `step ${life.current!.index + 1} of ${life.steps.length}` } : null;
  const needs = isArchived ? [] : needsYou({ accountId: id, today, now, followUps: openItems, pending: pending.length, planDraft, meetings, deals, plays, researchDrafts: draftNotes.length, playbookNext });
  const topDeals = [...open].sort((a, b) => (b.tcv_usd ?? 0) - (a.tcv_usd ?? 0)).slice(0, TOP_DEALS);
  const totals = playDealTotals(plays, deals);
  // As the team ranked them; #1 is the top priority.
  const liveFirst = rankedPlays(plays);
  const theirs = contacts.filter((c) => c.org === "customer");
  const ours = contacts.filter((c) => c.org !== "customer");
  const side = theirSide(account, contacts);
  const team = weekSummary(user.id, now, id, 14).filter((p) => p.total > 0 || openItems.some((a) => a.owner_user_id === p.userId));
  const openByOwner = new Map<string, number>();
  for (const a of openItems) if (a.owner_user_id) openByOwner.set(a.owner_user_id, (openByOwner.get(a.owner_user_id) ?? 0) + 1);
  const live = meetings.filter((m) => !m.merged_into);
  const lastMeeting = live.filter((m) => m.held_at <= today).sort((a, b) => b.held_at.localeCompare(a.held_at))[0] ?? null;
  const nextMeeting = live.filter((m) => m.held_at > today).sort((a, b) => a.held_at.localeCompare(b.held_at))[0] ?? null;

  // The follow-ups due soonest, checkable here; the whole editable list is
  // the Follow-ups tab, and each one has its own page.
  const owners = listUsers().map((u) => ({ id: u.id, name: u.display_name }));
  const soonest = followUpViews(openItems.slice(0, FOLLOW_UPS_SHOWN), meetings);

  // Research: counts over every retained finding, never over the three shown.
  const researchEntity = confirmedEntity(id);
  const keptByNote = acceptedNotes.map((n) => ({
    noteId: n.doc.id,
    generatedAt: n.meta.generated_at,
    findings: n.meta.findings.flatMap((f, index) => (keptFindings(n.meta).includes(f) ? [{ finding: f, index }] : [])),
  }));
  const allKept = keptByNote.flatMap((n) => n.findings.map((f) => f.finding));
  const researchView: ResearchPanelView = {
    accountId: id,
    notes: acceptedNotes.length,
    kept: allKept.length,
    latest: keptByNote.map((n) => n.generatedAt).sort().at(-1) ?? null,
    drafts: draftNotes.length,
    pendingUpdates: pending.filter((p) => p.origin_id === "research_updates").length,
    counts: Object.fromEntries(DOSSIER_TOPICS.map((t) => [t, allKept.filter((f) => f.topic === t).length])) as ResearchPanelView["counts"],
    other: allKept.filter((f) => !DOSSIER_TOPICS.includes(f.topic as (typeof DOSSIER_TOPICS)[number])).length,
    leads: overviewLeads(briefItemsOf(acceptedNotes), focusForResearch(), today).map((l) => ({
      noteId: l.item.noteId,
      index: l.item.index,
      label: l.label,
      kind: l.kind,
      text: l.item.finding.text,
      url: l.item.finding.url,
      date: l.item.finding.date,
      pageAge: l.item.finding.page_age,
      soWhat: l.soWhat,
    })),
    entity: researchEntity ? { name: researchEntity.name, domain: researchEntity.domain ?? null } : null,
    identity: researchEntity?.domain ? [account.name, researchEntity.domain] : account.name,
    today,
    peers: (() => {
      const p = keptPeers(id);
      return p ? { names: p.peers.map((x) => x.name), summary: p.summary } : null;
    })(),
  };

  const tab = (t: string) => `/accounts/${id}/${t}`;

  // Where it stands, and what moved since you last looked (DECISIONS #100).
  const biggest = topDeals[0] ?? null;
  const lead = researchView.leads[0] ?? null;
  const stands = whereItStands({
    accountId: id,
    today,
    openDeals: vitals.openDeals,
    pipelineUsd: vitals.openPipelineUsd,
    biggest: biggest ? { id: biggest.deal_id, name: biggest.name, stage: stageText(biggest.stage, biggest.stage_label), closeDate: biggest.close_date, nextStep: biggest.next_step?.trim() || null, waived: waiverActive(biggest, today) } : null,
    withoutNextStep: vitals.openDeals - vitals.withNextStep,
    lastMeeting: lastMeeting ? { id: lastMeeting.id, title: lastMeeting.title, date: lastMeeting.held_at } : null,
    nextMeeting: nextMeeting ? { id: nextMeeting.id, title: nextMeeting.title, date: nextMeeting.held_at } : null,
    livePlays: plays.filter((p) => LIVE.includes(p.status)).length,
    topPlay: liveFirst.find((p) => LIVE.includes(p.status)) ? { id: liveFirst.find((p) => LIVE.includes(p.status))!.id, title: liveFirst.find((p) => LIVE.includes(p.status))!.title } : null,
    thesis: !!account.thesis?.trim(),
    lead: lead ? { label: lead.label, text: lead.text, href: `/accounts/${id}/research?note=${lead.noteId}&finding=${lead.index}#finding-${lead.noteId}-${lead.index}` } : null,
  });
  // The Writer's version, shown only while it matches the records it was
  // written from; otherwise the counted sentences, and the Writer is asked
  // to catch up in the background (DECISIONS #106).
  const writing = !isArchived && writerOn();
  const writtenFacts = writing ? accountFacts(id, today, accountLead(id, today)) : [];
  const written = writing && writtenFacts.length > 0 ? writtenFor(accountKey(id), factsHash(writtenFacts)) : null;
  const since = sinceLooked(id, user.id, accountSince(user.id, id), briefItemsOf(acceptedNotes));
  const sinceLabels = since.changes.some((c) => c.kind === "edit") ? entityLabels(id) : {};
  const pace = watchPace(id);
  // What Since you last looked already offers to decide is not said twice.
  const needsHere = needs.filter((n) => !(n.key === "review" && since.waiting.changes) && !(n.key === "research" && since.waiting.research.length > 0));

  return (
    <Page user={user}>
      <OpenOnHash key={id} />
      {/* An old link to a follow-up's place on this page goes to its own page. */}
      <TaskAnchorRecovery />
      {isArchived && (
        <Callout tone="neutral" className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <span>This account is archived on {account.archived_at}. It is hidden from every list and from anything the model reads.</span>
          <ArchiveButton mode="restore" size="md" action={restoreRecord.bind(null, "account", id)} />
        </Callout>
      )}
      <AccountHeader account={account} tab="overview" />

      {!isArchived && <SeenAccount accountId={id} />}
      {/* On a phone what needs you comes first, so the next action is on the
          first screen; from sm the account's story leads. */}
      {!isArchived && (
        <div className="flex flex-col">
          <div className="order-2 sm:order-1">
            {written ? (
              <section id="where-it-stands" aria-label="Where it stands" className="mb-6 max-w-3xl" data-testid="where-it-stands">
                <WrittenParagraph written={written} counts={<WhereItStands sentences={stands} bare />} testId="account-written" />
              </section>
            ) : (
              <WhereItStands sentences={stands} />
            )}
            {writing && !written && writtenFacts.length > 0 && <WriteWhenStale place="account" id={id} />}
          </div>
          <div className="order-3 sm:order-2"><AccountSince view={since} accountId={id} labels={sinceLabels} names={new Map(owners.map((o) => [o.id, o.name]))} now={now.getTime()} /></div>
          <div className="order-1 sm:order-3"><NeedsYou items={needsHere} /></div>
        </div>
      )}
      {!isArchived && <PlanningCapture accountId={id} me={user.id} />}

      {/* Our work leads: who on the team is on this account and what each
          did lately, their open follow-ups here, and our meetings. Their
          side and the research come after it (DECISIONS #92). */}
      <Section id="our-work" title="Our work" aside={<span className="text-micro">last 14 days</span>}>
        {team.length === 0 ? (
          <p className="text-label text-ink-muted">Nothing on file from the team in the last two weeks.</p>
        ) : (
          <ul className="divide-y divide-line" data-testid="our-work">
            {team.map((p) => (
              <li key={p.userId} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-label" data-testid="our-work-person">
                <Link href={`/team/${p.userId}`} className="min-w-24 font-semibold text-ink hover:text-accent hover:underline">
                  {p.userId === user.id ? "You" : p.name}
                </Link>
                <span className={p.total ? "text-ink" : "text-ink-muted"}>{workLine(p.counts)}</span>
                {(openByOwner.get(p.userId) ?? 0) > 0 && (
                  <Link href={tab("follow-ups")} className="text-micro font-semibold text-accent hover:underline">
                    {openByOwner.get(p.userId)} open follow-up{openByOwner.get(p.userId) === 1 ? "" : "s"}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-label text-ink-muted" data-testid="our-meetings">
          <span>
            Last meeting:{" "}
            {lastMeeting ? (
              <Link href={`/accounts/${id}/meetings/${lastMeeting.id}`} className="font-semibold text-ink hover:text-accent hover:underline">
                {lastMeeting.title} · {fmtDay(lastMeeting.held_at)}
              </Link>
            ) : (
              "none yet"
            )}
          </span>
          <span>
            Next:{" "}
            {nextMeeting ? (
              <Link href={`/accounts/${id}/meetings/${nextMeeting.id}`} className="font-semibold text-ink hover:text-accent hover:underline">
                {nextMeeting.title} · {fmtDay(nextMeeting.held_at)}
              </Link>
            ) : (
              <Link href={tab("meetings")} className="font-semibold text-accent hover:underline">
                none booked
              </Link>
            )}
          </span>
        </p>
      </Section>

      <div className="gap-x-6 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <Section
          id="plan-glance"
          title="Plan"
          aside={
            <Link href={tab("plays")} className="font-semibold text-accent hover:underline">
              {plays.length ? `All ${plays.length} plays →` : "Open →"}
            </Link>
          }
        >
          {planDraft > 0 && (
            <Link href={`/inbox?kind=changes&account=${id}`} className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-warning-line bg-warning-soft px-3 py-2 text-label hover:underline" data-testid="plan-draft-link">
              <span>
                Plan draft · <strong className="tabular-nums">{planDraft}</strong> change{planDraft === 1 ? "" : "s"} to review
              </span>
              <span className="font-semibold text-accent">Review →</span>
            </Link>
          )}
          {account.thesis ? <p className="mb-3 line-clamp-3 text-body text-ink">{account.thesis}</p> : <p className="mb-3 text-label text-ink-muted">No account thesis yet.</p>}
          {plays.length === 0 ? (
            <Empty>No plays yet.</Empty>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {liveFirst.slice(0, PLAYS_SHOWN).map((p, i) => {
                const t = totals.get(p.id);
                return (
                  <li key={p.id} className="flex items-baseline justify-between gap-3 py-2">
                    <span className="flex min-w-0 items-baseline gap-2">
                      {i === 0 && p.sort_order > 0 && LIVE.includes(p.status) && (
                        <span className="shrink-0 text-micro font-semibold uppercase tracking-[0.06em] text-accent" data-testid="play-top">Top priority</span>
                      )}
                      <Link href={`/accounts/${id}/plays/${p.id}`} className="min-w-0 truncate text-label font-semibold text-ink hover:text-accent hover:underline">
                        {p.title}
                      </Link>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-micro tabular-nums text-ink-muted">
                      {t?.deals ? fmtMoneyShort(t.usd) : ""}
                      <Chip tone={PLAY_TONE[p.status] ?? "neutral"}>{playStatusLabel(p.status)}</Chip>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
        <Section
          id="top-deals"
          title="Biggest open deals"
          aside={
            <Link href={tab("deals")} className="font-semibold text-accent hover:underline">
              All {open.length} →
            </Link>
          }
        >
          {topDeals.length === 0 ? (
            <Empty>
              No open deals. <Link href={tab("deals")} className="text-accent underline">Add one</Link> or import a report.
            </Empty>
          ) : (
            <ul className="divide-y divide-line" data-testid="top-deals">
              {topDeals.map((d) => (
                <li key={d.deal_id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 py-2.5">
                  <Link href={`/accounts/${id}/deals/${encodeURIComponent(d.deal_id)}`} className="min-w-0 truncate font-semibold text-ink hover:text-accent hover:underline">
                    {d.name}
                  </Link>
                  <span className="text-right font-semibold tabular-nums text-ink-strong">{fmtMoney(d.tcv_usd)}</span>
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-micro text-ink-muted">
                    <Chip tone={stageTone(d.stage)}>{stageText(d.stage, d.stage_label)}</Chip>
                    <span className="truncate">{d.next_step?.trim() ? `Next: ${d.next_step}` : waiverActive(d, today) ? <span className="text-ink-muted">No next step needed</span> : <span className="text-warning">No next step</span>}</span>
                  </span>
                  <span className="text-right text-micro tabular-nums text-ink-muted">{d.close_date ? fmtDay(d.close_date) : "no date"}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

      </div>

      <div className="gap-x-6 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <Section
          id="follow-ups"
          title="Follow-ups"
          aside={
            <Link href={tab("follow-ups")} className="font-semibold text-accent hover:underline">
              {openItems.length > FOLLOW_UPS_SHOWN ? `All ${openItems.length} →` : openItems.length ? "Edit or add →" : "Add →"}
            </Link>
          }
        >
          <ActionItems items={soonest} setStatus={setActionItemStatus.bind(null, id)} owners={owners} me={user.id} today={today} emptyText="No open follow-ups." />
          {openItems.length > FOLLOW_UPS_SHOWN && (
            <p className="mt-2 text-micro text-ink-muted">
              {openItems.length - FOLLOW_UPS_SHOWN} more on the{" "}
              <Link href={tab("follow-ups")} className="text-accent hover:underline">
                Follow-ups tab
              </Link>
              .
            </p>
          )}
        </Section>

        <div className="min-w-0">
          <Section
            id="people-glance"
            title="Their side"
            aside={
              <Link href={tab("people")} className="font-semibold text-accent hover:underline">
                {contacts.length ? `All ${contacts.length} →` : "Add →"}
              </Link>
            }
          >
            <h3 className="text-micro font-semibold uppercase tracking-wide text-ink-muted">People</h3>
            {theirs.length === 0 ? (
              <p className="mt-1 text-label text-warning">Nobody on the customer side yet — who do you know there?</p>
            ) : (
              <ul className="mt-1 space-y-1.5" data-testid="their-people">
                {theirs.slice(0, PEOPLE_SHOWN).map((c) => (
                  <li key={c.id} className="min-w-0 text-label">
                    <Link href={`/accounts/${id}/contacts/${c.id}`} className="font-semibold text-ink hover:text-accent hover:underline">
                      {c.name}
                    </Link>
                    <span className="text-ink-muted">{[c.title, c.role ? (ROLE_LABELS[c.role] ?? c.role) : null].filter(Boolean).map((s) => ` · ${s}`).join("")}</span>
                  </li>
                ))}
              </ul>
            )}
            {side.suggested > 0 && (
              <p className="mt-1.5 text-label">
                <Link href={`/inbox?kind=changes&account=${id}`} className="font-semibold text-accent hover:underline" data-testid="their-people-suggested">
                  {side.suggested} {side.suggested === 1 ? "person" : "people"} named in research — review
                </Link>
              </p>
            )}
            {(theirs.length > PEOPLE_SHOWN || ours.length > 0) && (
              <p className="mt-1.5 text-micro text-ink-muted">
                {theirs.length > PEOPLE_SHOWN ? `${theirs.length - PEOPLE_SHOWN} more on their side · ` : ""}
                {ours.length} on our team and partners
              </p>
            )}

            <h3 className="mt-4 text-micro font-semibold uppercase tracking-wide text-ink-muted">Their priorities</h3>
            {side.priorities.length === 0 ? (
              <p className="mt-1 text-label text-ink-muted">
                Nothing yet. Kept research on their strategy, or the scorecard&rsquo;s Metrics and Identify pain, shows here.
              </p>
            ) : (
              <ul className="mt-1 space-y-2" data-testid="their-priorities">
                {side.priorities.map((p, i) => (
                  <li key={i} className="min-w-0 text-label" data-from={p.from}>
                    <p className="line-clamp-3 break-words text-ink">{p.text}</p>
                    <Link href={p.href} className={`text-micro font-semibold hover:underline ${p.from === "ours" ? "text-ink-muted" : "text-accent"}`}>
                      {p.from === "ours" ? "Our hypothesis, not theirs →" : `${p.label} →`}
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {side.rolesToFind.length > 0 && (
              <>
                <h3 className="mt-4 text-micro font-semibold uppercase tracking-wide text-ink-muted">Roles to find</h3>
                <ul className="mt-1 space-y-1.5" data-testid="their-roles">
                  {side.rolesToFind.map((r) => (
                    <li key={r.role} className="min-w-0 text-label">
                      <span className="font-semibold text-ink">{r.role}</span>
                      <span className="text-ink-muted"> · likely {r.likely}</span>
                      <span className="block text-micro text-ink-muted">Ask: {r.question}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-micro text-ink-muted">Guesses from public research, to confirm in discovery.</p>
              </>
            )}
          </Section>
          <ResearchPanel view={researchView}>
            {!isArchived && account.kind === "customer" && <WatchPace pace={pace} save={setWatchPaceAction.bind(null, id)} />}
          </ResearchPanel>
        </div>
      </div>
    </Page>
  );
}


const DOT: Record<NeedsYouItem["tone"], string> = { danger: "bg-danger", warning: "bg-warning", neutral: "bg-accent" };

// At most four, most urgent first, each said once with one way in.
function NeedsYou({ items }: { items: NeedsYouItem[] }) {
  return (
    <Section id="needs-you" title="Needs you">
      {items.length === 0 ? (
        <p className="text-label text-ink-muted" data-testid="needs-you-clear">
          Nothing needs one of you on this account right now.
        </p>
      ) : (
        <ul className="divide-y divide-line" data-testid="needs-you">
          {items.map((n) => (
            <li key={n.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5" data-testid="needs-you-row" data-kind={n.key}>
              <span className="flex min-w-0 items-baseline gap-2.5">
                <span aria-hidden className={`size-2 shrink-0 translate-y-[-1px] rounded-full ${DOT[n.tone]}`} />
                <span className="min-w-0">
                  <span className="font-semibold text-ink">{n.text}</span>
                  {n.detail && <span className="block text-micro text-ink-muted sm:ml-2 sm:inline">{n.detail}</span>}
                </span>
              </span>
              <Link href={n.href} className="inline-flex min-h-9 shrink-0 items-center text-label font-semibold text-accent hover:underline">
                {n.action} →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
