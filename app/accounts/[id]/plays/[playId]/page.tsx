import { AskAboutThis } from "@/components/AskAboutThis";
import Link from "next/link";
import { CommitmentPanel } from "@/components/CommitmentPanel";
import { FollowUpReturn } from "@/components/FollowUpReturn";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { entityHistoryCount, entityHistoryFor, getAccount, getPlay, likelyDuplicatePlays, listContacts, listDeals, mergedPlayIds } from "@/lib/queries/accounts";
import { listActionItems, getMeeting } from "@/lib/queries/meetings";
import { fmtDay, fmtMoney, fmtWhen, logValueText, parseJsonArray, stageText, historyCountText } from "@/lib/format";
import { PLAY_STATUSES, PLAY_TONE, playStatusLabel } from "@/lib/tone";
import { Page } from "@/components/Nav";
import { BaseVersion, Breadcrumb, Callout, Chip, control, Empty, Field, Section, Stat, stageTone } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { ArchiveButton } from "@/components/ArchiveButton";
import { archiveRecord, mergePlaysAction, restoreRecord, savePlay } from "@/app/actions";
import { previewPlayMerge } from "@/lib/proposals/merge";
import { MergePreviewLine } from "@/components/MergePreviewLine";
import { FreshnessBaseline } from "@/components/AccountFreshness";
import { accountRevision } from "@/lib/queries/freshness";

export const dynamic = "force-dynamic";

// Enough to read, bounded because a record's history only grows. The count
// beside the section comes from a COUNT, not from this.
const HISTORY_SHOWN = 200;

// A play, on its own page.
//
// Plays were the last first-class record with nowhere to go. Deals and people
// each got a page; a play stayed a card in a grid on the busiest screen in the
// app, with its linked deals and people rendered as a joined string rather
// than links, and a history that was written on every edit and shown nowhere.
//
// It is also where the play's edit form belongs. On the account page every
// play rendered a form carrying a checkbox per deal and per contact — eight
// plays against forty deals and twenty-five people is five hundred and twenty
// checkboxes, serialised into a payload whether or not anyone opened one. Here
// there is one play, so the same form costs what it looks like it costs.
export default async function PlayPage({ params, searchParams }: { params: Promise<{ id: string; playId: string }>; searchParams?: Promise<{ returnTo?: string }> }) {
  const user = await requirePageUser();
  const { id, playId } = await params;
  const play = getPlay(playId);
  const account = getAccount(id);
  if (!play || !account || play.account_id !== id) notFound();

  // Archived rows included on both, for the reason the account page's form
  // already documented: only rendered checkboxes are submitted, so a linked
  // record that is archived has to be rendered and checked or the next save
  // quietly unlinks it.
  const allDeals = listDeals(id, { includeArchived: true });
  const allContacts = listContacts(id, { includeArchived: true });
  const linkedDealIds = parseJsonArray(play.deal_ids_json);
  const linkedContactIds = parseJsonArray(play.contact_ids_json);
  const deals = allDeals.filter((d) => linkedDealIds.includes(d.deal_id));
  const people = allContacts.filter((c) => linkedContactIds.includes(c.id));
  const followUps = listActionItems(id, { status: "open" }).filter((i) => i.play_id === playId);
  // History for this play and everything merged into it, in one query — two
  // rowid-ordered lists concatenated would interleave wrongly, which is why
  // entityHistoryFor takes the whole set.
  const historyIds = [playId, ...mergedPlayIds(playId)];
  const history = entityHistoryFor("play", historyIds, HISTORY_SHOWN);
  const historyTotal = entityHistoryCount("play", historyIds);

  // Which meetings moved this play, read off the history's source refs — the
  // same reverse scan the deal page does, and the only real link between a
  // play and a conversation.
  const meetingIds = new Set<string>();
  for (const h of history) {
    if (!h.source_ref_json) continue;
    try {
      const ref = JSON.parse(h.source_ref_json) as { kind?: string; id?: string | null };
      if (ref.kind === "meeting" && ref.id) meetingIds.add(ref.id);
    } catch {
      // A malformed ref just means no link.
    }
  }
  const meetings = [...meetingIds].map((mid) => getMeeting(mid)).filter((m): m is NonNullable<typeof m> => m !== null);

  const label = (someId: string) =>
    allDeals.find((d) => d.deal_id === someId)?.name ?? allContacts.find((c) => c.id === someId)?.name;
  const isArchived = play.archived_at != null;
  const mergedIntoPlay = play.merged_into ? getPlay(play.merged_into) : null;
  const duplicates = likelyDuplicatePlays(id, playId);
  const merge = mergePlaysAction.bind(null, id, playId);
  // What each candidate would actually do, from the same planner the merge
  // applies. One line per candidate, so no client state is needed to switch
  // between them — and one candidate, the ordinary case, reads as a sentence.
  const previews = duplicates.map((p) => ({ id: p.id, title: p.title, result: previewPlayMerge({ accountId: id, keeperId: playId, loserId: p.id }) }));
  const openPipeline = deals.filter((d) => d.status === "open" && d.archived_at === null).reduce((s, d) => s + (d.tcv_usd ?? 0), 0);

  return (
    <Page user={user}>
      <FreshnessBaseline revision={accountRevision(id)} />
      <FollowUpReturn value={(await searchParams)?.returnTo} />
      <Breadcrumb accountId={id} accountName={account.name} page={play.title} section={{ label: "Plan", href: `/accounts/${id}/plays` }} />

      {/* A merged-away play is a tombstone, not an archived record waiting to
          come back, so it says where it went instead of offering Restore. */}
      {mergedIntoPlay ? (
        <Callout tone="neutral" className="mb-4">
          This play was merged into{" "}
          <Link href={`/accounts/${id}/plays/${mergedIntoPlay.id}`} className="font-semibold text-accent hover:underline">
            {mergedIntoPlay.title}
          </Link>
          . Its deals, people and follow-ups live there now, and its history is shown there beside the rest.
        </Callout>
      ) : (
        isArchived && (
          <Callout tone="neutral" className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <span>This play is archived on {play.archived_at}. It is hidden from every list and from anything the model reads.</span>
            <ArchiveButton mode="restore" size="md" action={restoreRecord.bind(null, "play", playId)} />
          </Callout>
        )
      )}

      {/* Two rows for one play, offered where the play is being looked at. */}
      {duplicates.length > 0 && (
        <Callout tone="warning" className="mb-4">
          <p className="font-semibold">
            {duplicates.length === 1 ? "Another play on this account has the same name." : "Other plays on this account have the same name."}
          </p>
          <p className="mt-1 text-micro">
            Here is what each one would do. A merge can be undone from the account page, but only what nobody has changed since goes back.
          </p>
          <div className="mt-1.5 space-y-1">
            {previews.map((p) => (
              <MergePreviewLine key={p.id} result={p.result} label={previews.length > 1 ? p.title : undefined} />
            ))}
          </div>
          <div className="mt-2">
            <ActionForm action={merge} testId="play-merge" trigger="Merge them" submitLabel="Merge">
              <Field label={`Merge into ${play.title}`} hint="The other play is archived and cannot be restored afterwards — it lives here." wide>
                <select name="loser_id" required defaultValue={duplicates.length === 1 ? duplicates[0]!.id : ""} className={control}>
                  {duplicates.length !== 1 && (
                    <option value="" disabled>
                      pick the duplicate
                    </option>
                  )}
                  {duplicates.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} · {p.status}
                    </option>
                  ))}
                </select>
              </Field>
            </ActionForm>
          </div>
        </Callout>
      )}

      <header className="mb-6">
        <h1 className="text-display font-black tracking-tight text-ink-strong">{play.title}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <Chip tone={PLAY_TONE[play.status] ?? "neutral"}>{playStatusLabel(play.status)}</Chip>
          {!play.archived_at && <AskAboutThis accountId={id} kind="play" id={play.id} />}
          {play.owner && <span className="text-label text-ink-muted">{play.owner}</span>}
        </div>
        {play.thesis && <p className="mt-3 max-w-prose text-body text-ink">{play.thesis}</p>}
      </header>

      <div className="mb-6 flex flex-wrap gap-x-10 gap-y-4">
        <Stat label="Open pipeline it covers" value={fmtMoney(openPipeline)} />
        <Stat label="Deals" value={deals.length} />
        <Stat label="People" value={people.length} />
      </div>

      <Section id="next-step" title="Next step">
        <CommitmentPanel accountId={id} kind="play" sourceId={playId} source={play} accountArchived={account.archived_at != null} />
        {play.next_step ? (
          <p className="text-body text-ink">
            {play.next_step}
            {play.next_step_due && <span className="ml-2 text-label tabular-nums text-ink-muted">by {fmtDay(play.next_step_due)}</span>}
          </p>
        ) : (
          <Empty>Nothing set. A play with no next step is a sentence, not a plan.</Empty>
        )}
        {followUps.length > 0 && (
          <ul className="mt-3 divide-y divide-line">
            {followUps.map((i) => (
              <li key={i.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span className="text-label text-ink">{i.text}</span>
                <span className="text-micro tabular-nums text-ink-muted">{i.due ? fmtDay(i.due) : "no date"}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="deals" title="Deals it turns on" aside={<span>{deals.length}</span>}>
        {deals.length === 0 ? (
          <Empty>
            {isArchived || play.merged_into ? "No linked deals. This retained play is not editable." : allDeals.some((d) => d.archived_at == null) ? (
              <>No linked deals. <a href="#edit" className="text-accent underline">Open Edit play</a> to choose from this account’s deals.</>
            ) : (
              <>No active deals are available on this account. <Link href={`/accounts/${id}/deals`} className="text-accent underline">Add or manage account deals</Link> before linking one.</>
            )}
          </Empty>
        ) : (
          <ul className="divide-y divide-line">
            {deals.map((d) => (
              <li key={d.deal_id} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                {/* Links, not a joined string. On the account page these were
                    plain text, so a play named deals you could not reach. */}
                <Link href={`/accounts/${id}/deals/${encodeURIComponent(d.deal_id)}`} className="font-medium text-ink hover:text-accent hover:underline">
                  {d.name}
                </Link>
                <div className="flex items-center gap-3">
                  {d.archived_at && <Chip tone="neutral">archived</Chip>}
                  <Chip tone={stageTone(d.stage)}>{stageText(d.stage, d.stage_label)}</Chip>
                  <span className="whitespace-nowrap text-label font-semibold tabular-nums">{fmtMoney(d.tcv_usd)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="people" title="People it turns on" aside={<span>{people.length}</span>}>
        {people.length === 0 ? (
          <Empty>Nobody linked yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {people.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                <Link href={`/accounts/${id}/contacts/${c.id}`} className="font-medium text-ink hover:text-accent hover:underline">
                  {c.name}
                </Link>
                <span className="text-micro text-ink-muted">
                  {c.archived_at ? "archived · " : ""}
                  {c.title ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {meetings.length > 0 && (
        <Section id="meetings" title="Meetings that moved it" aside={<span>{meetings.length}</span>}>
          <ul className="divide-y divide-line">
            {meetings.map((m) => (
              <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                <Link href={`/accounts/${id}/meetings/${m.id}`} className="font-medium text-ink hover:text-accent hover:underline">
                  {m.title}
                </Link>
                <span className="text-micro tabular-nums text-ink-muted">
                  {fmtDay(m.held_at)}
                  {m.held_time ? ` at ${m.held_time}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section id="edit" title="Details">
        <ActionForm
          action={savePlay.bind(null, id, playId)}
          testId="play-edit"
          trigger="Edit play"
          className="animate-rise flex flex-wrap items-end gap-3 rounded-lg bg-surface-sunk p-3"
        >
          <BaseVersion of={play.updated_at} />
          <Field label="Title" wide><input name="title" defaultValue={play.title} required className={control} /></Field>
          <Field label="Play thesis" hint="The opportunity this play explores, separate from the account thesis." wide><textarea name="thesis" defaultValue={play.thesis ?? ""} rows={3} className={control} /></Field>
          <Field label="Status">
            <select name="status" defaultValue={play.status} className={control}>
              {PLAY_STATUSES.map((s) => (
                <option key={s} value={s}>{playStatusLabel(s)}</option>
              ))}
            </select>
          </Field>
          <Field label="Owner"><input name="owner" defaultValue={play.owner ?? ""} className={control} /></Field>
          <Field label="Next step" wide><input name="next_step" defaultValue={play.next_step ?? ""} className={control} /></Field>
          <Field label="Due"><input name="next_step_due" type="date" defaultValue={play.next_step_due ?? ""} className={control} /></Field>
          <Field label="Linked deals" wide>
            {/* Only checked boxes are submitted, so the hidden field is what
                says the control was rendered at all; without it an absent list
                would read as "everything unticked". An archived deal this play
                points at is rendered and checked for the same reason. */}
            <input type="hidden" name="deal_ids_present" value="1" />
            {!allDeals.some((d) => d.archived_at == null || linkedDealIds.includes(d.deal_id)) && <p className="text-label text-ink-muted">No active deals to select. Add or manage deals on the account first.</p>}
            <div className="flex flex-wrap gap-x-3 gap-y-1.5">
              {allDeals
                .filter((d) => d.archived_at == null || linkedDealIds.includes(d.deal_id))
                .map((d) => (
                  <label key={d.deal_id} className="flex items-center gap-1.5 text-label">
                    <input type="checkbox" name="deal_ids" value={d.deal_id} defaultChecked={linkedDealIds.includes(d.deal_id)} className="size-4 accent-accent" />
                    {d.name}
                    {d.archived_at ? " (archived)" : ""}
                  </label>
                ))}
            </div>
          </Field>
          <Field label="Linked people" wide>
            <input type="hidden" name="contact_ids_present" value="1" />
            {!allContacts.some((c) => c.archived_at == null || linkedContactIds.includes(c.id)) && <p className="text-label text-ink-muted">No active people to select. Add people on the account first.</p>}
            <div className="flex flex-wrap gap-x-3 gap-y-1.5">
              {allContacts
                .filter((c) => c.archived_at == null || linkedContactIds.includes(c.id))
                .map((c) => (
                  <label key={c.id} className="flex items-center gap-1.5 text-label">
                    <input type="checkbox" name="contact_ids" value={c.id} defaultChecked={linkedContactIds.includes(c.id)} className="size-4 accent-accent" />
                    {c.name}
                    {c.archived_at ? " (archived)" : ""}
                  </label>
                ))}
            </div>
          </Field>
        </ActionForm>
        {!isArchived && (
          <div className="mt-3">
            <ArchiveButton what={play.title} action={archiveRecord.bind(null, "play", playId)} />
          </div>
        )}
      </Section>

      <Section id="history" title="History" aside={<span>{historyCountText(history.length, historyTotal)}</span>}>
        {history.length === 0 ? (
          <Empty>Nothing has changed since this play was written down.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {history.map((h) => (
              <li key={h.id} className="grid gap-x-4 gap-y-0.5 py-2 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-baseline">
                <div className="text-label font-medium text-ink">{h.field.replace(/_/g, " ")}</div>
                <div className="min-w-0 text-label">
                  <span className="text-ink-faint line-through">{logValueText(h.old_value, label)}</span>
                  <span aria-hidden className="mx-1.5 text-ink-faint">
                    →
                  </span>
                  <span className="text-ink">{logValueText(h.new_value, label)}</span>
                </div>
                <div className="text-micro tabular-nums text-ink-muted sm:text-right">
                  {fmtWhen(h.created_at)}
                  {h.proposal_id ? " · accepted" : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Page>
  );
}
