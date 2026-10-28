import { localOnly } from "@/lib/localMode";
import { LocalMeeting } from "@/components/local/Workspace";
import { AskAboutThis } from "@/components/AskAboutThis";
import Link from "next/link";
import { PlanningCapture } from "@/components/PlanningCapture";
import { PreparationEditor } from "@/components/PreparationEditor";
import { latestBriefRun, readBriefEdits } from "@/lib/planning";
import { researchRefsWithReturn } from "@/lib/researchMeetingReturn";
import { FollowUpReturn } from "@/components/FollowUpReturn";
import { notFound } from "next/navigation";
import { listUsers, requirePageUser } from "@/lib/auth";
import { getAccount, listContacts, otherSideNames, playOptionsFor } from "@/lib/queries/accounts";
import { getMeeting, latestMeetingBatchId, likelyDuplicateMeetings, listActionItems, listMeetingProposals } from "@/lib/queries/meetings";
import { latestRecapRun, meetingAttendees } from "@/lib/meetings/run";
import { recapMailto, recapText } from "@/lib/meetings/recap";
import { RecapDraft } from "@/components/RecapDraft";
import { ResultButton } from "@/components/ResultButton";
import { OutboundCard } from "@/components/OutboundCard";
import { listDrafts } from "@/lib/outbound/drafts";
import { mailSource } from "@/lib/mail/sync";
import { discardDraftAction, draftInviteAction, draftRecapAction, reopenDraftAction, saveDraftAction, sendDraftAction } from "@/app/outbound/actions";
import { PromiseLedger } from "@/components/PromiseLedger";
import { MeetingBrief, readStoredBrief } from "@/lib/meetings/briefSchema";
import { providerProblem } from "@/lib/ai/client";
import { runningRunFor } from "@/lib/ai/guard";
import { briefReadiness } from "@/lib/ai/readiness";
import { ROLES } from "@/lib/ai/models";
import { fmtDay } from "@/lib/format";
import { Page } from "@/components/Nav";
import { OpenOnHash } from "@/components/OpenOnHash";
import { BaseVersion, Breadcrumb, Callout, Chip, control, Empty, Eyebrow, Field, Section } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { NotesPanel } from "@/components/NotesPanel";
import { RunButton } from "@/components/RunButton";
import { ActionItems, type ActionItemView } from "@/components/ActionItems";
import { briefSubtitle, MeetingBriefView } from "@/components/MeetingBrief";
import { briefEvidenceResolver, resolveBriefEvidence, type BriefRefMap } from "@/lib/meetings/briefEvidence";
import { briefFingerprint, briefFollowUps } from "@/lib/meetings/briefFollowUp";
import { BriefFollowUp } from "@/components/BriefFollowUp";
import { ProposalReview } from "@/components/ProposalReview";
import { ChangeDeck } from "@/components/ChangeDeck";
import { ReviewSwitch } from "@/components/ReviewSwitch";
import { toProposalViews } from "@/lib/proposals/view";
import { previewMeetingMerge } from "@/lib/proposals/merge";
import { MergePreviewLine } from "@/components/MergePreviewLine";
import { archiveRecord, createBriefFollowUp, mergeMeetingsAction, restoreRecord, saveActionItem, saveMeeting, saveNotes, setActionItemStatus, setActionItemsStatus } from "@/app/actions";
import { ArchiveButton } from "@/components/ArchiveButton";
import { MeetingFocus, MeetingPanels } from "@/components/MeetingFocus";
import { meetingFocus, scheduledUpcoming } from "@/lib/workflow";
import { todayISO } from "@/lib/clock";
import { followUpSources } from "@/lib/queries/followUpSources";
import { followUpGaps } from "@/lib/meetings/followThrough";
import { FreshnessBaseline } from "@/components/AccountFreshness";
import { accountRevision } from "@/lib/queries/freshness";
import { currentPlaybook } from "@/lib/playbook/store";
import { discoveryGuide } from "@/lib/playbook/discovery";
import { qualificationGaps, scorecard } from "@/lib/playbook/qualification";
import { DiscoveryGuideView } from "@/components/DiscoveryGuide";

export const dynamic = "force-dynamic";

export default async function MeetingPage({ params, searchParams }: { params: Promise<{ id: string; mid: string }>; searchParams?: Promise<{ returnTo?: string }> }) {
  const user = await requirePageUser();
  const { id, mid } = await params;
  const account = getAccount(id);
  const meeting = getMeeting(mid);
  if (!account || !meeting || meeting.account_id !== id) notFound();

  if (localOnly()) return <LocalMeeting account={account} meeting={meeting} user={user}/>;
  const attendees = meetingAttendees(meeting);
  // Same rule as a play's linked people: only rendered checkboxes are
  // submitted, so someone who attended and has since been archived has to be
  // rendered and checked, or the next save quietly deletes them from the
  // meeting — which is a record of who was in the room, not a live list.
  const attending = new Set(attendees.map((a) => a.contact_id).filter((v): v is string => v !== null));
  const contacts = listContacts(id, { includeArchived: true }).filter((c) => c.archived_at == null || attending.has(c.id));
  const notes = meeting.raw_notes ?? "";
  const pending = listMeetingProposals(mid);
  const batchId = latestMeetingBatchId(mid);
  const items = listActionItems(id, { meetingId: mid });
  const aiProblem = providerProblem(ROLES.meeting_extract.provider);
  // This page has two AI buttons and was the one page that did not ask
  // whether a run was already going — which is exactly what runningRunFor
  // exists to prevent. Both buttons rendered enabled and returned a 429.
  const inFlight = runningRunFor(id) !== null ? "Another AI run is working on this account." : null;
  const mergedIntoMeeting = meeting.merged_into ? getMeeting(meeting.merged_into) : null;
  const duplicates = likelyDuplicateMeetings(id, mid);
  const merge = mergeMeetingsAction.bind(null, id, mid);
  const previews = duplicates.map((m) => ({
    id: m.id,
    label: `${m.title}${m.held_time ? ` at ${m.held_time}` : ""}`,
    reason: m.reason,
    shared: m.sharedAttendees,
    result: previewMeetingMerge({ accountId: id, keeperId: mid, loserId: m.id }),
  }));
  const briefNotReady = briefReadiness(meeting);
  const initialBriefRun = latestBriefRun(id, mid);
  const briefEdits = readBriefEdits(meeting.brief_edits_json);

  const brief: MeetingBrief | null = readStoredBrief(meeting.brief_json);

  // Every id the brief cites, resolved against the records as they are now.
  // Only the refs the brief actually uses: the old map was the whole evidence
  // index, and a research ref in it pointed at the account page rather than at
  // the finding that was cited.
  const resolver = brief ? briefEvidenceResolver(id, { excludeMeetingId: mid }) : null;
  const { map, nextStepEvidence } = brief && resolver
    ? resolveBriefEvidence(brief, resolver)
    : { map: new Map() as BriefRefMap, nextStepEvidence: [] };
  const briefStale = nextStepEvidence.some((e) => e.status !== "current");
  const madeFollowUps = brief ? briefFollowUps(id, mid) : [];
  const fingerprint = briefFingerprint(meeting.brief_json ?? null);
  const makeFollowUp = createBriefFollowUp.bind(null, id, mid);

  const proposalViews = toProposalViews(id, pending);

  // The recap email: the latest draft for this meeting, if there is one.
  const recapRun = latestRecapRun(id, mid);
  const recap = recapRun?.recap ?? null;
  const recapBody = recap ? recapText(recap, user.display_name) : "";
  const recapEmails = recap
    ? recap.to
        .map((name) => contacts.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase())?.email)
        .filter((e): e is string => !!e)
    : [];
  const recapMail = recap ? recapMailto(recapEmails, recap.subject, recapBody) : null;
  const recapProblem = providerProblem(ROLES.meeting_recap.provider);
  // Sending from your own mailbox, when you turned it on (DECISIONS #103).
  const canSend = !!mailSource(user.id)?.canSend;
  const meetingDrafts = listDrafts(user.id, { accountId: id }).filter((d) => d.sourceId === mid && d.status !== "discarded");

  const itemSources = followUpSources(items);
  const itemViews: ActionItemView[] = items.map((a) => {
    let quote: string | null = null;
    try {
      quote = a.source_ref_json ? ((JSON.parse(a.source_ref_json) as { quote?: string | null }).quote ?? null) : null;
    } catch {
      quote = null;
    }
    return {
      id: a.id,
      text: a.text,
      owner: a.owner,
      ownerUserId: a.owner_user_id ?? null,
      due: a.due,
      status: a.status,
      quote,
      version: a.updated_at,
      playId: a.play_id ?? null,
      meetingTitle: null,
      sources: itemSources.get(a.id),
      workHref: account.archived_at == null ? `/follow-ups?who=${encodeURIComponent(a.owner_user_id ?? "unowned")}#action-${a.id}` : undefined,
    };
  });

  const editMeeting = saveMeeting.bind(null, id, mid);
  const editNotes = saveNotes.bind(null, id, mid);
  const toggle = setActionItemStatus.bind(null, id);
  const toggleMany = setActionItemsStatus.bind(null, id);
  async function saveItem(itemId: string | null, fd: FormData) {
    "use server";
    // The originating page supplies the association only on creation. Editing
    // owner/date/text must never move an existing follow-up to this meeting.
    if (itemId === null) fd.set("meeting_id", mid);
    else fd.delete("meeting_id");
    return saveActionItem(id, itemId, fd);
  }
  const owners = listUsers().map((u) => ({ id: u.id, name: u.display_name }));
  const customers = otherSideNames(id).get(id) ?? [];
  const ownerNames = new Map(owners.map((o) => [o.id, o.name]));
  const playChoices = playOptionsFor(id, items.map((a) => a.play_id));

  const now = new Date();
  const today = todayISO(now);
  const upcoming = scheduledUpcoming(meeting, now);
  const gaps = followUpGaps(items);
  const readOnly = meeting.archived_at != null || !!meeting.merged_into;
  const focus = meetingFocus({ archived: readOnly, pending: pending.length, upcoming, hasNotes: notes.trim().length > 0, openFollowUps: gaps.open });
  const focusReason = readOnly ? "Archived or merged record · retained evidence is available below."
    : focus === "review" ? `${pending.length} proposed change${pending.length === 1 ? " awaits" : "s await"} your decision. Source notes remain available.`
    : focus === "brief" ? "Still in the scheduled upcoming window. Opening the brief does not generate content."
    : focus === "follow-ups" ? `${gaps.open} recorded open follow-ups · ${gaps.owners} missing owner · ${gaps.dates} missing date.`
    : notes.trim() ? "Notes are saved. Review the retained record or add to it."
    : "No notes saved. Scheduled timing alone does not establish that the meeting took place.";
  const briefFirst = focus === "brief";

  const playbook = currentPlaybook({ accountId: id })?.playbook ?? null;
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const guide = playbook
    ? discoveryGuide(playbook, {
        archetypeId: account.archetype_id ?? null,
        gaps: qualificationGaps(scorecard(account)),
        attendees: attendees.map((a) => {
          const c = a.contact_id ? contactById.get(a.contact_id) : undefined;
          return { name: a.name, title: c?.title ?? a.note, role: c?.role ?? null };
        }),
      })
    : [];

  const briefSection = (
    <Section
      id="brief"
      key="brief"
      className="min-w-0"
      title="Brief"
      aside={
        <RunButton
          url={`/api/meetings/${mid}/brief`}
          key={initialBriefRun?.id ?? "new"}
          initialRun={initialBriefRun}
          body={{ baseVersion: meeting.updated_at, replaceHumanEdits: !!briefEdits }}
          confirm={briefEdits ? "Regenerating replaces your human edits with a new AI draft. Continue?" : undefined}
          label={brief ? "Regenerate" : "Prepare this meeting"}
          busyLabel="Writing…"
          tone={upcoming && !brief ? "primary" : "quiet"}
          kind="brief"
          disabledReason={readOnly || account.archived_at ? "Archived or merged meeting/account." : aiProblem ?? briefNotReady ?? (initialBriefRun?.state.status === "running" ? null : inFlight)}
        />
      }
    >
      {brief ? (
        <>
          {/* Who it is for and how long it takes, not how it came to exist. */}
          <p className="mb-3 text-micro text-ink-muted" data-testid="brief-subtitle">
            {briefSubtitle(brief)}
          </p>
          {briefEdits && <p className="mb-3 rounded-lg border border-line bg-surface-sunk p-3 text-label" data-testid="brief-human-edit">Human-edited preparation · {ownerNames.get(briefEdits.userId) ?? "a teammate"}. Purpose, questions and next-step action/concern are human wording, not newly verified claims. Suggested owners and dates remain unconfirmed. Citations remain evidence for the original draft, not proof of edited wording.</p>}
          <MeetingBriefView brief={brief} map={researchRefsWithReturn(map, id, mid)} nextStepRefs={briefEdits ? [] : nextStepEvidence.map((e) => e.requested)} />
          {!readOnly && !account.archived_at && <PreparationEditor accountId={id} meetingId={mid} version={meeting.updated_at} brief={brief} />}
          {briefEdits && <details className="my-4 border-t border-line pt-3" data-testid="brief-original"><summary className="cursor-pointer text-label font-semibold">Original AI draft &amp; evidence before human edits</summary><div className="mt-3"><MeetingBriefView brief={briefEdits.original} map={researchRefsWithReturn(map, id, mid)} nextStepRefs={nextStepEvidence.map(e => e.requested)} /></div></details>}
          <div className="mt-4 border-t border-line pt-3" data-testid="brief-follow-up-panel">
            {madeFollowUps.length > 0 && (
              <div className="mb-3" data-testid="brief-follow-up-made">
                <p className="text-label font-semibold text-ink-strong">Follow-ups from this meeting's briefs</p>
                <ul className="mt-1 space-y-1">
                  {madeFollowUps.map((f) => (
                    <li key={f.id} className="text-label text-ink" data-testid="brief-follow-up-record">
                      {f.archivedAt ? f.text : <Link href={`/follow-ups/${f.id}`} className="text-accent hover:underline">{f.text} →</Link>}
                      <span className="ml-1.5 text-micro tabular-nums text-ink-muted">
                        {f.ownerUserId ? (ownerNames.get(f.ownerUserId) ?? f.owner ?? f.ownerUserId) : (f.owner ?? "no owner yet")} · {f.due ? f.due : "no date yet"} · from a stored brief{f.archivedAt ? ` · archived ${f.archivedAt}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
              <BriefFollowUp
                key={mid}
                meetingId={mid}
                action={makeFollowUp}
                disabledReason={meeting.archived_at != null || mergedIntoMeeting
                  ? "This meeting is archived or merged, so nothing new can be recorded against it."
                  : briefStale ? "The records behind this next step are no longer current. Review the evidence before creating a follow-up." : null}
                suggestion={brief.proposed_next_step.action}
                fingerprint={fingerprint ?? ""}
                owners={owners}
                evidence={nextStepEvidence.map((e) => ({ label: e.label, status: e.status, reason: e.reason, asOf: e.asOf }))}
                needsAck={nextStepEvidence.some((e) => e.status === "current" && e.verification === "report_excerpt")}
              />
          </div>
        </>
      ) : (
        <Empty>No brief yet. Generate one before the call: it reads everything on file and comes back with what to land on.</Empty>
      )}
    </Section>
  );

  const briefPanel = guide.length ? (
    <div key="brief" className="min-w-0 space-y-5">
      {briefSection}
      <Section id="questions" className="min-w-0" title="Questions for this meeting" aside={<span>from the playbook</span>}>
        <DiscoveryGuideView guide={guide} />
      </Section>
    </div>
  ) : (
    briefSection
  );

  const notesPanel = (
    <Section id="notes" key="notes" className="min-w-0" title="Notes" aside={<span>{notes.length > 0 ? `${notes.length.toLocaleString("en-US")} characters` : "nothing yet"}</span>}>
      <NotesPanel
        save={editNotes}
        initial={notes}
        version={meeting.updated_at}
        extractUrl={`/api/meetings/${mid}/extract`}
        hasPending={pending.length > 0}
        pendingCount={pending.length}
        followUps={followUpGaps(items)}
        readOnlyReason={meeting.archived_at != null || meeting.merged_into ? "Archived or merged meeting: retained notes and follow-ups are shown for reference." : null}
        disabledReason={aiProblem ?? inFlight}
      />
    </Section>
  );

  return (
    <Page user={user}>
      <FreshnessBaseline revision={accountRevision(id)} />
      <FollowUpReturn value={(await searchParams)?.returnTo} />
      <OpenOnHash key={mid} />
      <Breadcrumb accountId={id} accountName={account.name} page={meeting.title} section={{ label: "Meetings", href: `/accounts/${id}/meetings` }} />

      {/* A merged-away meeting is a tombstone, not an archived record waiting
          to come back, so it says where it went instead of offering Restore.
          Its own notes stay readable below — nothing here is deleted. */}
      {mergedIntoMeeting ? (
        <Callout tone="neutral" className="mb-4">
          This record was merged into{" "}
          <Link href={`/accounts/${id}/meetings/${mergedIntoMeeting.id}`} className="font-semibold text-accent hover:underline">
            {mergedIntoMeeting.title}
          </Link>
          . Its follow-ups and attendees live there now, and both sets of notes are on it.
        </Callout>
      ) : (
        meeting.archived_at != null && (
          <Callout tone="neutral" className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <span>This meeting is archived on {meeting.archived_at}. It is hidden from the account and from anything the model reads.</span>
            <ArchiveButton mode="restore" size="md" action={restoreRecord.bind(null, "meeting", mid)} />
          </Callout>
        )
      )}

      {/* Two records of one call — usually both of us made a meeting for it. */}
      {duplicates.length > 0 && (
        <Callout tone="warning" className="mb-4">
          <p className="font-semibold">
            {duplicates.length === 1 ? "Another meeting is on this same day." : "Other meetings are on this same day."}
          </p>
          <p className="mt-1 text-micro">
            Two different meetings on one day is ordinary, and undoing a merge later restores only what nobody has changed since — so each of these says how much is actually known
            about it, and what merging it would do.
          </p>
          <div className="mt-1.5 space-y-1.5">
            {previews.map((p) => (
              <div key={p.id}>
                <p className="text-micro font-medium text-ink">
                  {p.label}
                  {/* Why it is being offered. An option on nothing but the date
                      must not look like one sharing four attendees. */}
                  <span className="ml-1.5 font-normal text-ink-faint">
                    {p.reason === "attendees"
                      ? `· ${p.shared} of the same ${p.shared === 1 ? "person" : "people"} in the room`
                      : p.reason === "title"
                        ? "· near enough the same title"
                        : "· nothing in common but the day"}
                  </span>
                </p>
                <MergePreviewLine result={p.result} />
              </div>
            ))}
          </div>
          <div className="mt-2">
            <ActionForm action={merge} testId="meeting-merge" trigger="Same meeting — merge them" submitLabel="Merge">
              <Field label={`Merge into ${meeting.title}`} hint="The other record is archived and cannot be restored afterwards — it lives here." wide>
                <select name="loser_id" required defaultValue={duplicates.length === 1 ? duplicates[0]!.id : ""} className={control}>
                  {duplicates.length !== 1 && (
                    <option value="" disabled>
                      pick the duplicate
                    </option>
                  )}
                  {duplicates.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title}
                      {m.held_time ? ` · ${m.held_time}` : ""}
                      {m.reason === "day" ? " · only the day in common" : ""}
                    </option>
                  ))}
                </select>
              </Field>
            </ActionForm>
          </div>
        </Callout>
      )}

      <div className="mb-5">
        <Eyebrow>{upcoming ? "Scheduled · upcoming window" : "Scheduled date"}</Eyebrow>
        <h1 className="font-display text-title font-extrabold tracking-tight text-ink-strong sm:text-display">{meeting.title}</h1>
        <p className="mt-1 text-label tabular-nums text-ink-muted">
          {fmtDay(meeting.held_at)}
          {meeting.held_time ? ` at ${meeting.held_time}` : ""}
        </p>
        {!meeting.archived_at && !meeting.merged_into && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <AskAboutThis accountId={id} kind="meeting" id={meeting.id} />
            {/* An invite from your own calendar, drafted for you to check and send (DECISIONS #103). */}
            {canSend && meeting.held_at >= todayISO() && <ResultButton run={draftInviteAction.bind(null, id, mid)} testId="meeting-invite-draft">Send an invite…</ResultButton>}
          </div>
        )}
        {attendees.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {attendees.map((a, i) => (
              <Chip key={i}>{a.name}</Chip>
            ))}
          </div>
        )}
      </div>

      {!readOnly && !account.archived_at && <PlanningCapture accountId={id} meetingId={mid} me={user.id} />}
      <MeetingFocus key={mid} suggested={focus} reason={focusReason} />

      <nav aria-label="Meeting sections" className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-label font-semibold text-accent" data-testid="meeting-nav">
        <a href="#brief" className="inline-flex min-h-11 items-center hover:underline">Brief</a>
        <a href="#notes" className="inline-flex min-h-11 items-center hover:underline">Notes</a>
        <a href="#review" className="inline-flex min-h-11 items-center hover:underline">Review ({pending.length} pending)</a>
        <a href="#follow-ups" className="inline-flex min-h-11 items-center hover:underline">Follow-ups ({followUpGaps(items).open} open)</a>
        {meeting.summary && <a href="#meeting-summary" className="inline-flex min-h-11 items-center hover:underline">Summary</a>}
      </nav>

      {/* Stable client layout retains both editor identity and entry order. */}
      <MeetingPanels key={mid} briefFirst={briefFirst} brief={briefPanel} notes={notesPanel} />

      <Section id="review" title="Review" aside={<span>{pending.length} pending</span>}>
        <a href="#notes" className="mb-3 inline-flex min-h-11 items-center text-label text-accent hover:underline">Read source notes ↑</a>
        <div className="min-w-0 max-w-5xl">
          {pending.length > 0 ? (
            <>
              <p className="mb-3 text-label text-ink-muted">{pending.length} proposed change{pending.length === 1 ? "" : "s"} from these notes.</p>
              <ReviewSwitch
                deck={<ChangeDeck key={batchId ?? "none"} proposals={proposalViews} owners={owners} customers={customers} me={user.id} accountName={account.name} />}
                list={<ProposalReview accountId={id} proposals={proposalViews} batchId={batchId} />}
              />
            </>
          ) : <p className="text-label text-ink-muted">No proposed changes from these notes are waiting for review.</p>}
        </div>
      </Section>

      <Section id="recap" title="Recap email" aside={recap ? <span>Draft · not sent</span> : undefined}>
        {notes.trim().length < 20 ? (
          <p className="text-label text-ink-muted">Write the notes first: the recap is drafted from them.</p>
        ) : (
          <div className="max-w-3xl space-y-4">
            {recap ? (
              <>
                <RecapDraft recap={recap} text={recapBody} mailto={recapMail!.href} bodyInMail={recapMail!.withBody} sender={user.display_name} />
                {canSend && <ResultButton run={draftRecapAction.bind(null, id, mid)} variant="primary" testId="recap-send-draft">Send from my mailbox…</ResultButton>}
              </>
            ) : (
              <p className="text-label text-ink">A short thank-you from your notes: what you heard and what happens next.</p>
            )}
            <RunButton
              url={`/api/meetings/${mid}/recap`}
              key={recapRun?.id ?? "new"}
              initialRun={recapRun ? { id: recapRun.id, state: recapRun.state } : null}
              label={recap ? "Draft again" : "Draft the recap email"}
              busyLabel="Drafting…"
              kind="recap"
              tone={recap ? "quiet" : "primary"}
              disabledReason={recapProblem ?? inFlight}
            />
          </div>
        )}
      </Section>

      {meetingDrafts.length > 0 && (
        <Section id="to-send" title="To send" aside={<span>{meetingDrafts.length}</span>}>
          <div className="max-w-3xl space-y-3" data-testid="meeting-drafts">
            {meetingDrafts.map((d) => (
              <OutboundCard key={d.id} draft={d} sendingOn={canSend} actions={{ send: sendDraftAction, save: saveDraftAction, discard: discardDraftAction, reopen: reopenDraftAction }} />
            ))}
          </div>
        </Section>
      )}

      {meeting.summary && (
        <details id="meeting-summary" className="mb-5 border-y border-line py-3" data-testid="meeting-summary">
          <summary className="cursor-pointer py-1 font-semibold text-ink-strong">Full meeting summary</summary>
          <p className="mt-3 max-w-2xl whitespace-pre-wrap text-body text-ink">{meeting.summary}</p>
        </details>
      )}

      <Section id="follow-ups" title="Follow-ups from this meeting" aside={<span>{itemViews.filter((i) => i.status === "open").length} open</span>}>
        <PromiseLedger items={itemViews.filter((i) => i.status === "open")} owners={owners} customers={customers} today={today} />
        <ActionItems
          items={itemViews}
          setStatus={toggle}
          setMany={toggleMany}
          save={saveItem}
          owners={owners}
          plays={playChoices}
          me={user.id}
          today={today}
          emptyText="No follow-ups yet. Write one down, or extract the notes."
        />
      </Section>

      <Section title="Meeting details">
        <ActionForm action={editMeeting} testId="meeting-edit" trigger="Edit meeting">
          <BaseVersion of={meeting.updated_at} />
          <Field label="Title" wide>
            <input name="title" defaultValue={meeting.title} required className={control} />
          </Field>
          <Field label="Date">
            <input name="held_at" type="date" defaultValue={meeting.held_at.slice(0, 10)} required className={control} />
          </Field>
          <Field label="Time" hint="Optional. It decides what is next on the day, and when to ask for notes.">
            <input name="held_time" type="time" defaultValue={meeting.held_time ?? ""} className={control} />
          </Field>
          <Field label="Attendees from this account" wide>
            <input type="hidden" name="attendees_present" value="1" />
            <div className="flex flex-wrap gap-x-3 gap-y-1.5">
              {contacts.map((c) => (
                <label key={c.id} className="flex items-center gap-1.5 text-label">
                  <input
                    type="checkbox"
                    name="attendee_contact_ids"
                    value={c.id}
                    defaultChecked={attendees.some((a) => a.contact_id === c.id)}
                    className="size-4 accent-accent"
                  />
                  {c.name}
                  {c.archived_at && <span className="text-micro text-ink-faint">(archived)</span>}
                </label>
              ))}
              {contacts.length === 0 && <span className="text-label text-ink-muted">No people on this account yet.</span>}
            </div>
          </Field>
          <Field label="Other attendees (comma separated)" wide>
            <input name="attendee_names" defaultValue={attendees.filter((a) => !a.contact_id).map((a) => a.name).join(", ")} className={control} />
          </Field>
          <Field label="Summary" wide>
            <textarea name="summary" defaultValue={meeting.summary ?? ""} rows={3} className={control} />
          </Field>
        </ActionForm>
        {meeting.archived_at == null && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <ArchiveButton size="md" label="Archive this meeting" action={archiveRecord.bind(null, "meeting", mid)} />
            <span className="text-micro text-ink-muted">Hides it everywhere. The notes and the history survive.</span>
          </div>
        )}
      </Section>
    </Page>
  );
}
