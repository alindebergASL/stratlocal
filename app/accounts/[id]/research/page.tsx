import Link from "next/link";
import { teamPhrase } from "@/lib/team/members";
import { listUsers } from "@/lib/auth";
import { Fragment } from "react";
import { todayISO } from "@/lib/clock";
import { briefItemsOf, buildBrief, lastLooked } from "@/lib/research/brief";
import { unreadKept } from "@/lib/research/reads";
import { focusForResearch } from "@/lib/teamDirection";
import { ResearchBrief } from "@/components/ResearchBrief";
import { ResearchOpen, openQuestions } from "@/components/ResearchOpen";
import { ResearchStillTrue } from "@/components/ResearchStillTrue";
import { stillTrue, STILL_TRUE_SHOWN } from "@/lib/research/current";
import { stillTrueAction } from "./currentActions";
import { ResearchByTopic, TopicAcrossRuns, type KeptFinding } from "@/components/ResearchByTopic";
import { meetingReturn, researchMeetingHref } from "@/lib/researchMeetingReturn";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { providerProblem } from "@/lib/ai/client";
import { ROLES } from "@/lib/ai/models";
import { getAccount, listPendingProposals } from "@/lib/queries/accounts";
import { getRun, runningRunFor, spendToday } from "@/lib/ai/guard";
import { spendLine } from "@/lib/format";
import { keptFindings, listArchivedNotes, listNotes } from "@/lib/research/notes";
import { Page } from "@/components/Nav";
import { Empty, Section } from "@/components/ui";
import { AccountHeader } from "@/components/AccountHeader";
import { ArchiveButton } from "@/components/ArchiveButton";
import { archiveDocumentRecord, restoreDocumentRecord } from "@/app/actions";
import { ResearchCoverageView } from "@/components/ResearchCoverageView";
import { researchCoverage } from "@/lib/research/coverage";
import { BUDGETS } from "@/lib/ai/runWebResearch";
import { searchCostCents } from "@/lib/ai/cost";
import { ResearchForm } from "./ResearchForm";
import { NoteReview, type NoteView } from "./NoteReview";
import { isWatched, isWatchRun, playVocab, touches } from "@/lib/assistants/accountWatch";
import { ResultButton } from "@/components/ResultButton";
import { toggleWatch } from "./watchActions";
import { ResearchDossier } from "@/components/ResearchDossier";
import { FindingRow } from "@/components/FindingList";
import { TOPIC_LABELS, type ResearchFinding, type Topic } from "@/lib/research/schema";
import { ResearchReportView } from "@/components/ResearchReportView";
import { OriginalSummary } from "@/components/OriginalSummary";
import { confirmedEntity, latestResearchRun, type ResearchRunResult } from "@/lib/research/run";
import { runState } from "@/lib/ai/runState";
import { db, type AiRunRow } from "@/lib/db";
import { researchSelection } from "@/lib/research/notes";
import { ResearchUpdates } from "./ResearchUpdates";
import { CustomerDocuments } from "@/components/CustomerDocuments";
import { listCustomerDocs } from "@/lib/documents/customer";
import { keptPeers } from "@/lib/research/peers";
import { ResearchPeers } from "@/components/ResearchPeers";
import { ResolveResearch } from "./ResolveResearch";
import { findingAnchor } from "@/lib/research/anchor";

export const dynamic = "force-dynamic";

// A dossier can hold fifty findings and this is the page that holds every note
// of them, so the cap is generous — enough to read a topic through — and the
// way to the rest is a parameter, the way /pipeline does it, rather than a
// disclosure that ships the rows anyway (DECISIONS #20).
const FINDINGS_SHOWN = 24;

const VIEWS = ["known", "peers", "documents", "open", "report"] as const;
type View = (typeof VIEWS)[number];
// A note carries its findings and its whole original report, so "every
// accepted note, always" is a page that grows without limit as the account
// gets researched — which is what it did. One selected note is the reading
// surface; all=1 remains the full file.

// A finding's address on this page: the note and the finding's stored index.
// Defined in lib/research/anchor.ts and re-exported here, because the meeting
// brief now links to the same exact-finding route.
export { findingAnchor };

// One topic of one note, read whole and read-only.
//
// The card's "View all 9" used to go to `?all=1`, which opens every note in
// full — the whole file, when what was asked for was nine findings of one
// topic. This is the topic, at its own address, with the note's other topics a
// link away and nothing else expanded.
function FocusedTopic({
  accountId,
  noteId,
  topic,
  findings,
  indexOf,
  fromMeeting,
}: {
  accountId: string;
  noteId: string;
  topic: string;
  findings: ResearchFinding[];
  indexOf: Map<ResearchFinding, number>;
  fromMeeting?: string;
}) {
  const navHref = (href: string) => researchMeetingHref(href, accountId, fromMeeting);
  const rows = findings.filter((f) => f.topic === topic);
  const label = TOPIC_LABELS[topic as Topic] ?? topic;
  return (
    <div className="mt-4 max-w-3xl" data-testid="research-topic">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-display font-bold tracking-tight text-ink-strong">{label}</h3>
        <span className="text-micro tabular-nums text-ink-muted">
          {rows.length} retained finding{rows.length === 1 ? "" : "s"} in this note
        </span>
      </div>
      {rows.length === 0 ? (
        // Honest rather than helpful: a topic with nothing retained in it says
        // so, instead of quietly showing the note's other findings.
        <p className="mt-2 text-label text-ink-muted">
          This note keeps no findings under {label}. It may never have had any, or review may have declined them — its other topics are one link away.
        </p>
      ) : (
        <ul className="mt-3 space-y-4">
          {rows.map((f) => (
            <li key={indexOf.get(f)}>
              <FindingRow reading finding={f} anchorId={indexOf.has(f) ? findingAnchor(noteId, indexOf.get(f)!) : undefined} findingHref={navHref(`/accounts/${accountId}/research?note=${noteId}&finding=${indexOf.get(f)}#${findingAnchor(noteId, indexOf.get(f)!)}`)} />
            </li>
          ))}
        </ul>
      )}
      <Link href={navHref(`/accounts/${accountId}/research?read=${noteId}#research-${noteId}`)} className="mt-3 inline-block text-label font-semibold text-accent hover:underline">
        ← All topics in this note
      </Link>
    </div>
  );
}

// One exact finding, at its stored index.
//
// The index is the identity, so a link made before a re-review still means the
// same sentence. If that sentence is no longer kept — unticked, or superseded
// by a resolution — this says so. It never falls through to whatever finding
// now occupies the position, which would be the worst possible answer: a
// different claim under the link that promised this one.
function FocusedFinding({
  accountId,
  noteId,
  index,
  finding,
  kept,
  fromMeeting,
}: {
  accountId: string;
  noteId: string;
  index: number;
  finding: ResearchFinding | undefined;
  kept: boolean;
  fromMeeting?: string;
}) {
  const navHref = (href: string) => researchMeetingHref(href, accountId, fromMeeting);
  const available = finding !== undefined && kept;
  return (
    <div className="mt-4" data-testid="research-finding">
      <p className="text-micro font-medium uppercase tracking-[0.06em] text-ink-muted">Cited finding {index + 1}</p>
      {available ? (
        <div className="mt-2" id={findingAnchor(noteId, index)}>
          <FindingRow reading finding={finding} showTopic />
        </div>
      ) : (
        <p className="mt-2 text-label text-ink-muted" data-testid="research-finding-unavailable">
          That finding is not available: this note no longer keeps a finding at position {index + 1}. It may have been unticked in a re-review or superseded by a later one. Nothing
          else is shown in its place: open the note&rsquo;s topics to read what it does keep.
        </p>
      )}
      <Link href={navHref(`/accounts/${accountId}/research?read=${noteId}#research-${noteId}`)} className="mt-3 inline-block text-label font-semibold text-accent hover:underline">
        ← All topics in this note
      </Link>
    </div>
  );
}

export default async function ResearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ all?: string; note?: string; read?: string; topic?: string; finding?: string; view?: string; run?: string; again?: string; fromMeeting?: string | string[] }>;
}) {
  const user = await requirePageUser();
  const { id } = await params;
  const query = await searchParams;
  const showAll = query.all === "1";
  const openNote = query.note ?? query.read ?? null;
  // Reading one topic, or one exact finding, inside one note. Both are
  // addresses: reload and Back land back on the same content, and neither
  // expands any other note — `?all=1` is still the only thing that opens the
  // whole file. `?note=` on its own keeps its old meaning, which is adjusting.
  const openTopic = query.topic ?? null;
  const openFindingIndex = query.finding !== undefined && /^\d+$/.test(query.finding) ? Number(query.finding) : null;
  const reading = openTopic !== null || query.finding !== undefined || (query.note === undefined && query.read !== undefined);
  const account = getAccount(id);
  if (!account) notFound();
  // The organisation as research confirmed it; its domain also tells the
  // account's own pages apart from everyone else's.
  const entity = confirmedEntity(id);
  const identity = entity?.domain ? [account.name, entity.domain] : account.name;
  const returnMeeting = meetingReturn(id, query.fromMeeting);
  const navHref = (href: string) => researchMeetingHref(href, id, returnMeeting?.id);

  const problem = providerProblem(ROLES.research.provider);
  const inFlight = runningRunFor(id);
  const latest = latestResearchRun(id);
  const spend = spendToday();
  const drafts = listNotes(id, "draft");
  const accepted = listNotes(id, "accepted");
  const discarded = listArchivedNotes(id);
  const selectedNote = openNote ?? accepted[0]?.doc.id ?? null;
  const unavailableNote = openNote !== null && !accepted.some((n) => n.doc.id === openNote);
  const draft = drafts[0];
  // A note Account watch wrote is reviewed the same way, with what touches a
  // play ticked first (matched by shared words, in code: DECISIONS #4).
  const fromWatch = !!draft?.doc.ai_run_id && isWatchRun(getRun(draft.doc.ai_run_id));
  const watched = isWatched(id);
  const vocab = fromWatch ? playVocab(id) : [];
  const selection = researchSelection(id, "people technology strategy");
  // Proposals still waiting, counted from the batch rows rather than from the
  // last run's result: a run that made twelve of them a week ago says nothing
  // about whether any are left to review.
  const pendingUpdates = listPendingProposals(id).filter((p) => p.origin_id === "research_updates").length;
  const updateRun = db().prepare("SELECT * FROM ai_runs WHERE account_id=? AND kind='research_updates' ORDER BY started_at DESC LIMIT 1").get(id) as AiRunRow | undefined;
  const choices = accepted.flatMap((n) =>
    n.meta.findings.flatMap((f, index) =>
      keptFindings(n.meta).includes(f)
        ? [
            {
              id: `${n.doc.id}#${index}`,
              text: f.text,
              asOf: n.meta.generated_at,
            },
          ]
        : [],
    ),
  );

  const draftView: NoteView | null = draft
    ? {
        id: draft.doc.id,
        title: draft.meta.title,
        summary: draft.meta.summary,
        prose: draft.doc.content_text ?? "",
        sources: draft.meta.sources.length ? draft.meta.sources : draft.meta.findings.map((f) => f.url),
        findings: draft.meta.findings,
        openQuestions: draft.meta.open_questions,
        generatedAt: draft.meta.generated_at,
        accountName: identity,
        reads: draft.meta.reads,
        today: todayISO(),
        focus: draft.meta.focus,
        depth: draft.meta.depth,
        dropped: draft.meta.dropped,
        ...(fromWatch ? { fromWatch: true, touches: Object.fromEntries(draft.meta.findings.map((f, i) => [i, touches(f, vocab)])) } : {}),
      }
    : null;

  // What a person came here to do, in the order they are likely to want it on
  // an account that has already been researched: read it, deal with what is
  // waiting, then spend money. An empty account has only the last one, so the
  // form leads there instead.
  const populated = accepted.length > 0;
  // The top of a researched account: what is waiting on you, the three
  // findings worth reading first (one per topic, newest note first), and what
  // the research covers — so the page answers "what do we know" before it
  // asks you to read notes or spend money.
  const keptAll: KeptFinding[] = accepted.flatMap((n) => {
    const kept = keptFindings(n.meta);
    return n.meta.findings.flatMap((f, index) => (kept.includes(f) ? [{ noteId: n.doc.id, noteTitle: n.meta.title, index, finding: f, asOf: n.meta.generated_at }] : []));
  });
  const today = todayISO();
  const focusAreas = focusForResearch();
  const briefItems = briefItemsOf(accepted);
  // Kept research that may have gone out of date, with when it was last said
  // to be true.
  const checked = new Map(accepted.map((n) => [n.doc.id, n.meta.checked_at ?? {}]));
  const stale = stillTrue(briefItems.map((k) => ({ ...k, checkedAt: checked.get(k.noteId)?.[String(k.index)] ?? null })), today);
  // The page's default view: what we know by topic, across every run.
  // Reading one note (`?read=`), adjusting one (`?note=`), one topic across
  // runs (`?topic=`) or the whole file (`?all=1`) each show that instead.
  const topicAcross = openTopic !== null && query.note === undefined && query.read === undefined;
  const defaultView = populated && openNote === null && !showAll && !topicAcross;
  const findingHref = (k: { noteId: string; index: number }) => navHref(`/accounts/${id}/research?note=${k.noteId}&finding=${k.index}#${findingAnchor(k.noteId, k.index)}`);
  const topicLinks = {
    topicHref: (topic: string) => navHref(`/accounts/${id}/research?topic=${encodeURIComponent(topic)}`),
    findingHref,
    noteHref: (noteId: string) => navHref(`/accounts/${id}/research?read=${noteId}#research-${noteId}`),
  };
  // What is waiting on you comes first: a draft to review, or account
  // updates research suggested. Reading comes after it.
  const brief = defaultView ? buildBrief(briefItems, focusAreas, lastLooked(user.id, id), today) : null;
  const unread = defaultView ? unreadKept(id).length : 0;
  const briefing = defaultView && (drafts.length > 0 || pendingUpdates > 0) ? (
    <section className="mb-4" data-testid="research-briefing" key="briefing">
      <ul className="space-y-2" data-testid="research-waiting">
        {drafts.length > 0 && (
          <li>
            <Link href="#research-review" className="flex min-h-11 items-center justify-between gap-3 rounded-lg bg-warning-soft px-3 py-2 text-label text-ink ring-1 ring-warning-line hover:underline">
              <span>
                <strong className="tabular-nums">{drafts.length}</strong> draft note{drafts.length === 1 ? "" : "s"} to review
              </span>
              <span className="font-semibold text-accent">Review →</span>
            </Link>
          </li>
        )}
        {pendingUpdates > 0 && (
          <li>
            <Link href={`/inbox?kind=changes&account=${id}`} className="flex min-h-11 items-center justify-between gap-3 rounded-lg bg-warning-soft px-3 py-2 text-label text-ink ring-1 ring-warning-line hover:underline">
              <span>
                <strong className="tabular-nums">{pendingUpdates}</strong> suggested account update{pendingUpdates === 1 ? "" : "s"}
              </span>
              <span className="font-semibold text-accent">Review →</span>
            </Link>
          </li>
        )}
      </ul>
    </section>
  ) : null;

  const runSection = (
    <Section
      id="research-run"
      key="run"
      title={populated ? "Run more research" : "Research this account"}
      aside={<span className="tabular-nums">{spendLine(spend)}</span>}
    >
        {!populated && !draftView && (
          // The first time, what a run gives you, before what it costs.
          <ul className="mb-4 space-y-1.5 text-label text-ink" data-testid="research-first-time">
            <li><strong className="text-ink-strong">A brief:</strong> why this account now, and where what {teamPhrase(listUsers().length).all} sell{listUsers().length === 2 ? "" : "s"} fits.</li>
            <li><strong className="text-ink-strong">What we know, by topic:</strong> each fact with the page it came from, who published it and how old it is.</li>
            <li><strong className="text-ink-strong">What is still open:</strong> questions to take into discovery.</li>
            <li className="text-ink-muted">Nothing counts until you have kept it; briefs, plans and Ask read only what you keep.</li>
          </ul>
        )}
        <ResearchForm
          key={`${id}:${latest?.id ?? "none"}`}
          accountId={id}
          depths={{
            standard: { ...BUDGETS.standard, cents: searchCostCents(BUDGETS.standard.searches) },
            deep: { ...BUDGETS.deep, cents: searchCostCents(BUDGETS.deep.searches) },
          }}
          initialRun={latest ? { id: latest.id, state: runState<ResearchRunResult>(latest) } : null}
          replacesDraft={drafts.length > 0}
          focusAreas={focusAreas}
          minutes={typicalResearchMinutes()}
          again={populated}
          entity={entity ? { name: entity.name, domain: entity.domain ?? null } : null}
          disabledReason={
            account.archived_at
              ? "That account is archived."
              : (problem ?? (inFlight && inFlight.id !== latest?.id ? "Another AI run is working on this account. It will be free in a moment." : null))
          }
        />
        {!account.archived_at && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3 text-label" data-testid="watch-toggle">
            <span className="text-ink">{watched ? "Account watch looks here once a week, and leaves what is new for you to keep or drop." : "Want a weekly look for news, without pressing anything?"}</span>
            <ResultButton run={toggleWatch.bind(null, id, !watched)} testId="watch-toggle-button">{watched ? "Stop watching" : "Watch weekly"}</ResultButton>
          </div>
        )}
      </Section>
  );

  const reviewSection = draftView ? (
    <Section id="research-review" key="review" title="Review findings" aside={<span>{drafts.length} draft</span>}>
      {/* Compact beside the checklist: the checklist is grouped by topic
          and its headings carry the counts, so the grid was printing the
          same numbers twice on one screen. What it alone knows is which
          topics came back empty. */}

      {fromWatch && (
        <p className="mb-3 rounded-lg bg-accent-soft px-3 py-2 text-label text-ink" data-testid="watch-intro">
          {watchIntro(draftView.findings.length, Object.values(draftView.touches ?? {}).filter((t) => t.length > 0).length)}
        </p>
      )}
      <NoteReview key={draftView.id} note={draftView} coverage={<ResearchCoverageView compact coverage={researchCoverage(draftView.findings, draft?.meta.capture, draft?.meta.dropped.length ?? 0)} />} />
    </Section>
  ) : null;

  // Only when there is something to suggest from, or something waiting: on
  // an empty account it was a disabled button over "0 of 0".
  const updatesSection = selection.total === 0 && pendingUpdates === 0 ? null : (
    <Section id="research-updates" key="updates" title="Suggested account updates">
      <ResearchUpdates
        key={`${id}:${updateRun?.id ?? "none"}`}
        accountId={id}
        included={selection.included.length}
        total={selection.total}
        pending={pendingUpdates}
        initialRun={updateRun ? { id: updateRun.id, state: runState(updateRun) } : null}
        disabledReason={
          account.archived_at
            ? "That account is archived."
            : selection.total === 0
              ? "Accept at least one finding first."
              : (providerProblem(ROLES.plan_draft.provider) ?? (inFlight && inFlight.id !== updateRun?.id ? "Another AI run is working on this account." : null))
        }
      />
    </Section>
  );

  const meetingBack = returnMeeting && <p className="mb-4 text-label" data-testid="research-meeting-return"><a href={returnMeeting.href} className="inline-flex min-h-11 items-center font-semibold text-accent underline">← Return to meeting brief</a><span className="ml-2 text-ink-muted">{returnMeeting.title}{returnMeeting.archived ? " (archived)" : ""}</span></p>;
  // The workspace (DECISIONS #94): the brief on top, then one tab at a time,
  // each at its own address. Older addresses (?read, ?note, ?topic, ?finding,
  // ?all) still open what they did, under the same tabs.
  const peerView = keptPeers(id);
  const customerDocs = listCustomerDocs(id);
  const questions = openQuestions(accepted.map((n) => n.meta));
  const buyingGroup = [...accepted].sort((a, b) => b.meta.generated_at.localeCompare(a.meta.generated_at)).find((n) => n.meta.buying_group?.length)?.meta.buying_group ?? [];
  const asked = VIEWS.find((v) => v === query.view);
  const view: View = populated && !defaultView ? (openTopic === "peers" ? "peers" : openTopic !== null || query.finding !== undefined ? "known" : "report") : (asked ?? "known");
  const tabHref = (v: View) => navHref(`/accounts/${id}/research${v === "known" ? "" : `?view=${v}`}`);
  const tabs: Array<{ view: View; label: string; n: number }> = [
    { view: "known", label: "What we know", n: keptAll.filter((k) => k.finding.topic !== "peers").length },
    { view: "peers", label: "Peers and competitors", n: peerView?.peers.length ?? 0 },
    { view: "documents", label: "Their documents", n: customerDocs.length },
    { view: "open", label: "Still to find out", n: questions.length + buyingGroup.length },
    { view: "report", label: "Full report", n: accepted.length },
  ];
  const tabStrip = (
    <nav aria-label="Research" className="mb-4 flex flex-wrap items-center gap-1.5 border-b border-line pb-2 text-label" data-testid="research-tabs">
      {tabs.map((t) => (
        <Link
          key={t.view}
          href={tabHref(t.view)}
          aria-current={t.view === view ? "page" : undefined}
          data-testid={`research-tab-${t.view}`}
          className={`inline-flex min-h-11 items-center sm:min-h-9 gap-1.5 rounded-md px-2.5 py-1 transition-colors ${t.view === view ? "bg-accent-soft font-semibold text-accent" : "text-ink-muted hover:bg-surface-sunk hover:text-ink"}`}
        >
          {t.label}
          <span className="tabular-nums text-micro">{t.n}</span>
        </Link>
      ))}
    </nav>
  );
  // The run the Full report tab shows: the one asked for, else the newest.
  const reportNote = view === "report" ? (query.run ? accepted.find((n) => n.doc.id === query.run) : accepted[0]) : undefined;
  const untiedPeerFindings = keptAll.filter((k) => k.finding.topic === "peers" && !peerView?.peers.some((p) => p.noteId === k.noteId && p.finding === k.index));
  const runsList = (
    <section id="research-runs" aria-labelledby="research-runs-h" className="mb-6 min-w-0" data-testid="research-runs">
      <h2 id="research-runs-h" className="text-label font-semibold text-ink-strong">Research runs</h2>
      <ul className="mt-2 divide-y divide-line">
        {accepted.map((n) => (
          <li key={n.doc.id}>
            <Link
              href={navHref(`/accounts/${id}/research?view=report&run=${n.doc.id}`)}
              aria-current={reportNote?.doc.id === n.doc.id ? "page" : undefined}
              className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-3 py-2 text-label hover:underline"
            >
              <span className={`min-w-0 [overflow-wrap:anywhere] ${reportNote?.doc.id === n.doc.id ? "font-semibold text-ink-strong" : "font-semibold text-accent"}`}>{n.meta.title}</span>
              <span className="text-micro tabular-nums text-ink-muted">{n.meta.generated_at.slice(0, 10)} · {keptFindings(n.meta).length} kept</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
  const tabContent =
    view === "peers" ? (
      <Fragment key="notes">
        {peerView ? <ResearchPeers accountId={id} /> : <Empty>No peers or competitors kept yet. Research looks for them on every run; keep the ones that matter.</Empty>}
        {untiedPeerFindings.length > 0 && (
          <ResearchByTopic items={untiedPeerFindings} runs={accepted.length} today={today} accountName={identity} {...topicLinks} />
        )}
      </Fragment>
    ) : view === "documents" ? (
      <CustomerDocuments key="notes" accountId={id} />
    ) : view === "open" ? (
      <Fragment key="notes">
        {questions.length + buyingGroup.length > 0 ? <ResearchOpen questions={questions} buyingGroup={buyingGroup} /> : <Empty>Nothing open yet. Questions research could not answer, and guesses about who decides, collect here.</Empty>}
        {updatesSection}
      </Fragment>
    ) : view === "report" ? (
      <Fragment key="notes">
        {query.run && !reportNote ? (
          <p role="status" className="mb-4 text-label text-ink-muted" data-testid="research-run-unavailable">That run is not available. It may have been discarded; choose another below.</p>
        ) : reportNote ? (
          <article id={`research-${reportNote.doc.id}`} className="mb-6 min-w-0 max-w-4xl break-words rounded-xl border border-line bg-surface p-4 sm:p-5" data-testid="research-report-tab">
            <h2 className="font-display text-heading font-bold tracking-tight text-ink-strong">{reportNote.meta.title}</h2>
            <p className="text-micro tabular-nums text-ink-muted">
              {reportNote.meta.generated_at.slice(0, 10)} · {keptFindings(reportNote.meta).length} of {reportNote.meta.findings.length} findings kept
            </p>
            <OriginalSummary summary={reportNote.meta.summary} kept={keptFindings(reportNote.meta).length} total={reportNote.meta.findings.length} />
            <ResearchReportView open text={reportNote.doc.content_text ?? ""} sources={reportNote.meta.sources.length ? reportNote.meta.sources : reportNote.meta.findings.map((f) => f.url)} />
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-label">
              <Link href={navHref(`/accounts/${id}/research?read=${reportNote.doc.id}#research-${reportNote.doc.id}`)} className="font-semibold text-accent hover:underline">
                Its kept findings by topic →
              </Link>
              <Link href={navHref(`/accounts/${id}/research?note=${reportNote.doc.id}#research-${reportNote.doc.id}`)} className="font-semibold text-accent hover:underline" data-testid="research-adjust-link">
                Adjust what it keeps →
              </Link>
            </p>
          </article>
        ) : (
          <Empty>No research kept yet.</Empty>
        )}
        {accepted.length > 0 && runsList}
      </Fragment>
    ) : populated ? (
      <Fragment key="notes">
        <ResearchByTopic items={keptAll} exclude={["peers"]} runs={accepted.length} today={today} accountName={identity} {...topicLinks} />
        <ResearchStillTrue
          rows={stale.slice(0, STILL_TRUE_SHOWN)}
          more={Math.max(0, stale.length - STILL_TRUE_SHOWN)}
          findingHref={(r) => findingHref(r.item)}
          action={(r, keep) => stillTrueAction.bind(null, id, r.item.noteId, r.item.index, keep)}
        />
      </Fragment>
    ) : (
      <Empty key="notes">Nothing kept yet. Run research above; what you keep shows here by topic.</Empty>
    );
  const notesSection = defaultView || !populated ? (
    tabContent
  ) : topicAcross ? (
    <Fragment key="notes">
      <TopicAcrossRuns topic={openTopic!} items={keptAll} today={today} accountName={identity} backHref={navHref(`/accounts/${id}/research`)} {...topicLinks} />
    </Fragment>
  ) : (
      <section id="research-notes" key="notes" aria-label="Saved research" className="mb-5 min-w-0">
        {populated && <Link href={navHref(`/accounts/${id}/research`)} className="mb-2 inline-flex min-h-11 items-center text-label font-semibold text-accent hover:underline sm:min-h-0">← What we know</Link>}
        {accepted.length === 0 && unavailableNote && <p role="status" data-testid="research-note-unavailable">That saved note is unavailable. Check Discarded below.</p>}
        {accepted.length === 0 ? (
          <Empty>Nothing accepted yet. An accepted note is what briefs and plan drafts are allowed to read.</Empty>
        ) : (
          <div className="min-w-0">
            <details key={`${selectedNote}:${showAll}:${openTopic}:${query.finding}`} className="mb-4 border-b border-line pb-2" data-testid="research-note-picker">
              <summary className="cursor-pointer py-2 text-label text-accent">Choose a saved note</summary>
            <nav aria-label="Saved research notes" className="mt-2">
              <ul className="flex flex-wrap gap-x-5 gap-y-2">
                {accepted.map((n) => <li key={n.doc.id} className="min-w-0 max-w-full">
                  <Link href={navHref(`/accounts/${id}/research?read=${n.doc.id}#research-${n.doc.id}`)} aria-current={!showAll && selectedNote === n.doc.id ? "page" : undefined} className={`block break-words py-1 text-label hover:underline ${selectedNote === n.doc.id ? "font-semibold text-ink-strong" : "text-accent"}`}>
                    {n.meta.title}<span className="block text-micro font-normal text-ink-muted">{n.meta.generated_at} · {keptFindings(n.meta).length} retained findings</span>
                  </Link>
                </li>)}
              </ul>
            </nav>
            </details>
            {unavailableNote && <p role="status" data-testid="research-note-unavailable" className="mb-4 text-label text-ink-muted">That saved note is unavailable. It may have been archived. Choose another note or check Discarded below.</p>}
            {accepted.filter((n) => showAll || n.doc.id === selectedNote).map((n) => {

              // Legacy ?note= still adjusts; ?read= never opens review controls.
              const adjusting = n.doc.id === openNote && !reading;
              const focused = n.doc.id === openNote && (openTopic !== null || openFindingIndex !== null);
              const kept = keptFindings(n.meta);
              const coverage = researchCoverage(kept, n.meta.capture, n.meta.dropped.length);
              // The stored index of a finding, which is its identity: what a
              // link to it means, and what a resolution retires. Never its
              // position in a preview.
              const indexOf = new Map(n.meta.findings.map((f, index) => [f, index] as const));
              return (
              <article key={n.doc.id} id={`research-${n.doc.id}`} data-testid="research-reading-note" className="min-w-0 max-w-4xl break-words pb-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-heading font-bold tracking-tight text-ink-strong">{n.meta.title}</h2>
                    <p className="text-micro tabular-nums text-ink-muted">
                      {n.meta.generated_at}
                    </p>
                  </div>

                </div>
                <p className="mt-2 text-label text-ink-muted">Retained after review · not independently verified.</p>
                {focused && <>
                  {coverage.missing.length > 0 && <p className="mt-2 text-label text-ink-muted">No retained findings: {coverage.missing.map((t) => TOPIC_LABELS[t]).join(", ")}.</p>}
                  {coverage.reasons.map((reason, i) => <p key={i} className="mt-2 text-label text-ink-muted">{reason}</p>)}
                </>}
                {/* The note's own summary. What stood here was every kept
                    finding's text joined with spaces and cut at 1200
                    characters — the list below it with the line breaks taken
                    out — while the model's summary, the one field written to
                    be read, was shown only while the note was still a draft
                    and never again afterwards.

                    It is the model's paragraph, not the account's: it was
                    written before anybody ticked anything, so a claim this
                    review rejected can still be in it. Kept whole and labelled
                    as what it is, rather than rewritten or dropped. */}
                {(
                  <>
                    {/* One topic, or one exact finding, read whole. Both are
                        read-only: no checklist, no cap to explain, and a note
                        that no longer keeps the finding says that rather than
                        showing whichever finding now sits at that index. */}
                    {focused && openFindingIndex !== null && (
                      <FocusedFinding
                        accountId={id}
                        noteId={n.doc.id}
                        index={openFindingIndex}
                        finding={n.meta.findings[openFindingIndex]}
                        kept={kept.includes(n.meta.findings[openFindingIndex] as ResearchFinding)}
                        fromMeeting={returnMeeting?.id}
                      />
                    )}
                    {focused && openTopic !== null && openFindingIndex === null && (
                      <FocusedTopic accountId={id} noteId={n.doc.id} topic={openTopic} findings={kept} indexOf={indexOf} fromMeeting={returnMeeting?.id} />
                    )}
                    {/* The coverage counts and the findings they count were two
                        blocks: a grid saying "Technology: 9 findings" directly
                        above a list of forty findings you then had to go and
                        find the nine in. One block now — the count is the
                        card's heading and the findings are inside it. */}
                    {!focused && (
                      <ResearchDossier
                        reading
                        accountName={identity}
                        findingHref={(f) => navHref(`/accounts/${id}/research?note=${n.doc.id}&finding=${indexOf.get(f)}#${findingAnchor(n.doc.id, indexOf.get(f)!)}`)}
                        findings={kept}
                        coverage={researchCoverage(kept, n.meta.capture, n.meta.dropped.length)}
                        max={showAll ? undefined : FINDINGS_SHOWN}
                        moreHref={navHref(`/accounts/${id}/research?all=1#research-${n.doc.id}`)}
                        topicHref={(topic) => navHref(`/accounts/${id}/research?note=${n.doc.id}&topic=${encodeURIComponent(topic)}#research-${n.doc.id}`)}
                        anchorFor={(f) => (indexOf.has(f) ? findingAnchor(n.doc.id, indexOf.get(f)!) : undefined)}
                      />
                    )}
                    {/* The model's paragraph, after what review kept and behind
                        a disclosure. It used to lead the card: unreviewed prose
                        in the app's own voice, above the findings that are the
                        account's actual answer. Kept whole and labelled, not
                        deleted (DECISIONS #8). */}
                    <details className="mt-3 text-label text-ink-muted" data-testid="research-coverage-details">
                      <summary className="cursor-pointer">About coverage and counts</summary>
                      <p className="mt-2">{kept.length} of {n.meta.findings.length} extracted findings retained. Counts are findings, not independent sources. Topic coverage is not proof the account is fully researched.</p>
                    </details>
                    <details className="mt-3 border-t border-line pt-3" data-testid="research-original-summary">
                      <summary className="cursor-pointer text-label text-ink-muted hover:text-ink">Original model summary and sources (not reviewed)</summary>
                      <OriginalSummary summary={n.meta.summary} kept={kept.length} total={n.meta.findings.length} />
                      <ResearchReportView text={n.doc.content_text ?? ""} sources={n.meta.sources.length ? n.meta.sources : n.meta.findings.map((f) => f.url)} />
                    </details>
                  </>
                )}
                {/* One way in to changing what this note says, rather than
                    three sitting open beside each other — and a parameter
                    rather than a disclosure, because the disclosure shipped
                    every finding of every note whether or not anyone opened
                    it. Re-review, resolve and the record of past resolutions
                    are all the same question: is this still what we think? */}
                {!adjusting && (
                  <details className="mt-3 border-t border-line pt-3" data-testid="research-manage"><summary className="cursor-pointer text-label text-ink-muted">Manage this note</summary>
                  <ArchiveButton what={n.meta.title} action={archiveDocumentRecord.bind(null, n.doc.id)} size="sm" />
                  <Link href={navHref(`/accounts/${id}/research?note=${n.doc.id}#research-${n.doc.id}`)} data-testid="research-adjust-link" className="mt-3 inline-block text-label font-semibold text-accent hover:underline">
                    Adjust what this note says →
                  </Link>
                  </details>
                )}
                {adjusting && (
                  <div className="my-3 rounded-lg border border-line p-3" data-testid="research-adjust">
                    <p className="font-semibold">Adjust what this note says</p>
                    <Link href={navHref(`/accounts/${id}/research?read=${n.doc.id}#research-${n.doc.id}`)} className="text-label text-accent hover:underline">Return to reading</Link>
                    <ArchiveButton what={n.meta.title} action={archiveDocumentRecord.bind(null, n.doc.id)} size="sm" />
                    <div className="mt-2 space-y-3">
                    <div data-testid="research-rereview">
                      <NoteReview
                        key={`${n.doc.id}:${n.meta.accepted_at}`}
                        note={{
                          id: n.doc.id,
                          title: n.meta.title,
                          summary: n.meta.summary,
                          prose: n.doc.content_text ?? "",
                          sources: n.meta.sources,
                          findings: n.meta.findings,
                          openQuestions: n.meta.open_questions,
                          generatedAt: n.meta.generated_at,
                          accountName: identity,
                          focus: n.meta.focus,
                          depth: n.meta.depth,
                          dropped: n.meta.dropped,
                          acceptedIndexes: n.meta.accepted_finding_indexes ?? n.meta.findings.map((_, i) => i),
                        }}
                      />
                    </div>
                    <ResolveResearch
                      noteId={n.doc.id}
                      findings={n.meta.findings.flatMap((f, index) => (keptFindings(n.meta).includes(f) ? [{ index, text: f.text }] : []))}
                      choices={choices}
                    />
                    {(n.meta.resolutions?.length ?? 0) > 0 && (
                      <details className="my-3">
                        <summary className="cursor-pointer text-label">Resolution history</summary>
                        <ul className="space-y-2">
                          {n.meta.resolutions?.map((r, i) => (
                            <li key={i} className="text-micro">
                              <p>Superseded: {n.meta.findings[r.obsolete_index]?.text}</p>
                              <p>
                                {r.reason} · {r.at} · actor {r.actor}
                              </p>
                              <p>Supporting evidence: {r.supporting_ids.join(", ")}</p>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    </div>
                  </div>
                )}
              </article>
              );
            })}
            {!showAll && accepted.length > 1 && (
              <Link href={navHref(`/accounts/${id}/research?all=1`)} className="inline-block text-label font-semibold text-accent hover:underline">
                Open all {accepted.length} notes →
              </Link>
            )}
          </div>
        )}
      </section>
  );

  return (
    <Page user={user}>
      <AccountHeader account={account} tab="research" />

      {meetingBack}
      {briefing}
      {/* A draft leads only on an account with nothing kept yet; otherwise the
          waiting strip links down to it, after what is already known. */}
      {!populated && reviewSection}

      {brief && (
        <ResearchBrief
          brief={brief}
          entity={entity}
          focusAreas={focusAreas}
          accountName={identity}
          today={today}
          findingHref={findingHref}
          readUrl={`/api/accounts/${id}/research-reads`}
          unread={unread}
          readDisabled={account.archived_at ? "That account is archived." : (providerProblem(ROLES.plan_draft.provider) ?? (inFlight ? "Another AI run is working on this account." : null))}
        />
      )}

      {/* Running research again is one action, not a section between the
          things you came to read (DECISIONS #94). Open while a run is going,
          so its progress stays in view. */}
      {populated ? (
        <details className="mb-4" open={!!inFlight || query.again === "1"} data-testid="research-run-open">
          <summary className="inline-flex min-h-11 sm:min-h-9 cursor-pointer list-none items-center gap-2 rounded-lg border border-line bg-surface px-3 text-label font-semibold text-ink hover:bg-surface-sunk">
            Research again
            <span className="text-micro font-normal tabular-nums text-ink-muted">{spendLine(spend)}</span>
          </summary>
          <div className="mt-3">{runSection}</div>
        </details>
      ) : (
        runSection
      )}

      {tabStrip}
      {notesSection}
      {populated && reviewSection}

      {view === "report" && discarded.length > 0 && (
        <details className="mb-5 rounded-xl border border-line bg-surface px-4 py-3 sm:px-5">
          <summary className="cursor-pointer text-label font-semibold text-ink-muted hover:text-ink">Discarded ({discarded.length})</summary>
          <ul className="mt-3 divide-y divide-line">
            {discarded.map((n) => (
              <li key={n.doc.id} className="flex flex-wrap items-center justify-between gap-3 py-1.5">
                <span className="min-w-0 flex-1 truncate text-ink-muted">
                  {n.meta.title} <span className="text-micro tabular-nums">({n.meta.generated_at})</span>
                </span>
                <ArchiveButton mode="restore" what={n.meta.title} action={restoreDocumentRecord.bind(null, n.doc.id)} size="sm" />
              </li>
            ))}
          </ul>
        </details>
      )}
      {/* The one disclosure, at the foot: worth reading once, not on every run. */}
      <details className="mb-5 px-1" data-testid="research-disclosure">
        <summary className="cursor-pointer text-label text-ink-muted hover:text-ink">What leaves your AWS account</summary>
        <p className="mt-2 max-w-2xl text-label text-ink-muted">
          Only the company&rsquo;s public name, location and website, your question and your team&rsquo;s focus areas. Never a deal, a person, a note or the install base.
        </p>
      </details>
    </Page>
  );
}

// How long a research run usually takes here, in whole minutes: the median
// of the last ten that finished. Null until there are any.
function typicalResearchMinutes(): number | null {
  const rows = db()
    .prepare("SELECT finished_at - started_at AS ms FROM ai_runs WHERE kind = 'research' AND status = 'done' AND finished_at IS NOT NULL ORDER BY started_at DESC LIMIT 10")
    .all() as Array<{ ms: number }>;
  if (rows.length === 0) return null;
  const sorted = rows.map((r) => r.ms).sort((a, b) => a - b);
  return Math.max(1, Math.round(sorted[Math.floor(sorted.length / 2)]! / 60000));
}

function watchIntro(found: number, touching: number): string {
  const items = `${found} new item${found === 1 ? "" : "s"}`;
  const ticked =
    touching === 0
      ? "None shares words with a play, so none is ticked; keep any that matter."
      : touching === found
        ? `${found === 1 ? "It shares" : "All share"} words with a play and ${found === 1 ? "is" : "are"} ticked.`
        : `The ${touching === 1 ? "one that shares" : `${touching} that share`} words with a play ${touching === 1 ? "is" : "are"} ticked; the rest are here to keep if they matter.`;
  return `Account watch found ${items}. ${ticked} Nothing counts until you save.`;
}
