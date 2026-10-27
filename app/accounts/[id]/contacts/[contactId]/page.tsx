import { AskAboutThis } from "@/components/AskAboutThis";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { entityHistory, entityHistoryCount, getAccount, getContact, getDeal, likelyDuplicateContacts, listContacts, listPlays } from "@/lib/queries/accounts";
import { listActionItems, meetingsAttendedBy } from "@/lib/queries/meetings";
import { fmtDay, fmtMoney, fmtWhen, logValueText, parseJsonArray, sameName, stageText, historyCountText } from "@/lib/format";
import { CONTACT_ROLES, PLAY_TONE, playStatusLabel, ROLE_LABELS } from "@/lib/tone";
import { Page } from "@/components/Nav";
import { BaseVersion, Breadcrumb, Callout, Chip, control, Empty, Field, Section, Stat, stageTone } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { ArchiveButton } from "@/components/ArchiveButton";
import { archiveRecord, linkPerson, mergePeople, restoreRecord, saveContact, unlinkPersonAction } from "@/app/actions";
import { likelySamePerson, otherAccountsFor } from "@/lib/people";
import { FreshnessBaseline } from "@/components/AccountFreshness";
import { accountRevision } from "@/lib/queries/freshness";

export const dynamic = "force-dynamic";

// Enough to read, bounded because a record's history only grows. The count
// beside the section comes from a COUNT, not from this.
const HISTORY_SHOWN = 200;

const ORG_LABEL: Record<string, string> = { customer: "Customer", vendor: "Our team", partner: "Partner" };

// The screen you open before a call with someone you have met before.
//
// People had no route at all: every link to a person in the app was an anchor
// onto the account page, where they were one card among thirty and nothing
// said what you had actually talked about. The reverse scans here — which
// meetings they were in, which plays they are on — already existed for deals
// and were simply never pointed at people.
export default async function ContactPage({ params }: { params: Promise<{ id: string; contactId: string }> }) {
  const user = await requirePageUser();
  const { id, contactId } = await params;
  const contact = getContact(contactId);
  const account = getAccount(id);
  if (!contact || !account || contact.account_id !== id) notFound();

  const meetings = meetingsAttendedBy(contactId);
  // Archived plays included: a play they are on that someone archived is still
  // part of why you know them, and hiding it here would make the count on the
  // account page and the count here disagree.
  const plays = listPlays(id, { includeArchived: true }).filter((p) => parseJsonArray(p.contact_ids_json).includes(contactId));
  const dealIds = [...new Set(plays.flatMap((p) => parseJsonArray(p.deal_ids_json)))];
  const deals = dealIds.map((d) => getDeal(d)).filter((d): d is NonNullable<typeof d> => d !== null && d.archived_at === null);
  // Follow-ups match on the free-text owner, not on owner_user_id: that field
  // is for the two of us, and a commitment made *by* a customer is written
  // down under their name as the notes said it. Name equality only — a guess
  // here would put someone else's promise on this person's page.
  const followUps = listActionItems(id, { status: "open" }).filter((i) => i.owner && sameName(i.owner, contact.name));
  const history = entityHistory("contact", contactId, HISTORY_SHOWN);
  const historyTotal = entityHistoryCount("contact", [contactId]);
  const others = listContacts(id).filter((c) => c.id !== contactId);

  // What was written beside their name at the time, per meeting.
  const noteFor = (attendeesJson: string | null) => {
    try {
      const rows = JSON.parse(attendeesJson ?? "[]") as Array<{ contact_id?: string | null; note?: string | null }>;
      return rows.find((a) => a.contact_id === contactId)?.note ?? null;
    } catch {
      return null;
    }
  };

  const labelFor = (someId: string) => others.find((c) => c.id === someId)?.name ?? getDeal(someId)?.name;
  const isArchived = contact.archived_at != null;
  const duplicates = likelyDuplicateContacts(id, contactId);
  const merge = mergePeople.bind(null, id, contactId);
  // The same human at another account. Their row there keeps its own role,
  // title and notes — this only says the rows are one person, and it is a
  // screen affordance only: a context pack and a handoff are both scoped to
  // one account, and naming this person's other customers in either would be
  // one customer's information leaking into another's.
  const alsoAt = otherAccountsFor(contact);
  const elsewhere = likelySamePerson(contact);

  return (
    <Page user={user}>
      <FreshnessBaseline revision={accountRevision(id)} />
      <Breadcrumb accountId={id} accountName={account.name} page={contact.name} section={{ label: "People", href: `/accounts/${id}/people` }} />

      {isArchived && (
        <Callout tone="neutral" className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <span>{contact.name} is archived on {contact.archived_at}. They are hidden from every list and from anything the model reads.</span>
          <ArchiveButton mode="restore" size="md" action={restoreRecord.bind(null, "contact", contactId)} />
        </Callout>
      )}

      <header className="mb-6">
        <h1 className="text-display font-black tracking-tight text-ink-strong">{contact.name}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <Chip tone={contact.org === "vendor" ? "accent" : "neutral"}>{ORG_LABEL[contact.org] ?? contact.org}</Chip>
          {!contact.archived_at && <AskAboutThis accountId={id} kind="contact" id={contact.id} />}
          {contact.role && <Chip tone="neutral">{ROLE_LABELS[contact.role] ?? contact.role.replace(/_/g, " ")}</Chip>}
          {contact.title && <span className="text-label text-ink-muted">{contact.title}</span>}
          {contact.email && (
            <a href={`mailto:${contact.email}`} className="text-label text-accent hover:underline">
              {contact.email}
            </a>
          )}
        </div>
        {contact.notes && <p className="mt-3 max-w-prose text-body text-ink">{contact.notes}</p>}
      </header>

      <div className="mb-6 flex flex-wrap gap-x-10 gap-y-4">
        <Stat label="Meetings" value={meetings.length} sub={meetings[0] ? `last ${fmtDay(meetings[0].held_at)}` : "none yet"} />
        <Stat label="Plays" value={plays.length} />
        <Stat label="Open follow-ups" value={followUps.length} />
      </div>

      <Section id="meetings" title="Meetings" aside={<span>{meetings.length}</span>}>
        {meetings.length === 0 ? (
          <Empty>No meeting on file lists {contact.name}. Add them to a meeting's attendees and it will show here.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {meetings.map((m) => {
              const note = noteFor(m.attendees_json);
              return (
                <li key={m.id} className="py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link href={`/accounts/${id}/meetings/${m.id}`} className="font-medium text-ink hover:text-accent hover:underline">
                      {m.title}
                    </Link>
                    <span className="text-micro tabular-nums text-ink-muted">{fmtDay(m.held_at)}</span>
                  </div>
                  {note && <p className="mt-0.5 text-label text-ink-muted">{note}</p>}
                  {m.summary && <p className="mt-1 max-w-prose text-label text-ink">{m.summary}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section id="plays" title="Plays" aside={<span>{plays.length}</span>}>
        {plays.length === 0 ? (
          <Empty>Not linked to a play yet. Tick them on a play to say they are part of it.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {plays.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                <Link href={`/accounts/${id}/plays/${p.id}`} className="font-medium text-ink hover:text-accent hover:underline">
                  {p.title}
                </Link>
                <div className="flex items-center gap-2">
                  {p.archived_at && <Chip tone="neutral">archived</Chip>}
                  <Chip tone={PLAY_TONE[p.status] ?? "neutral"}>{playStatusLabel(p.status)}</Chip>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {deals.length > 0 && (
        <Section id="deals" title="Deals those plays touch" aside={<span>{deals.length}</span>}>
          <ul className="divide-y divide-line">
            {deals.map((d) => (
              <li key={d.deal_id} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                <Link
                  href={`/accounts/${id}/deals/${encodeURIComponent(d.deal_id)}`}
                  className="font-medium text-ink hover:text-accent hover:underline"
                >
                  {d.name}
                </Link>
                <div className="flex items-center gap-3">
                  <Chip tone={stageTone(d.stage)}>{stageText(d.stage, d.stage_label)}</Chip>
                  <span className="whitespace-nowrap text-label font-semibold tabular-nums">{fmtMoney(d.tcv_usd)}</span>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {followUps.length > 0 && (
        <Section id="follow-ups" title="Follow-ups in their name" aside={<span>{followUps.length} open</span>}>
          <ul className="divide-y divide-line">
            {followUps.map((i) => (
              <li key={i.id} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                <span className="text-label text-ink">{i.text}</span>
                <span className="text-micro tabular-nums text-ink-muted">{i.due ? fmtDay(i.due) : "no date"}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section id="edit" title="Details">
        <ActionForm
          action={saveContact.bind(null, id, contactId)}
          testId="contact-edit"
          trigger="Edit"
          className="animate-rise flex flex-wrap items-end gap-2 rounded-lg bg-surface-sunk p-2.5"
        >
          <BaseVersion of={contact.updated_at} />
          <Field label="Name"><input name="name" defaultValue={contact.name} required className={control} /></Field>
          <Field label="Title"><input name="title" defaultValue={contact.title ?? ""} className={control} /></Field>
          <Field label="Org">
            <select name="org" defaultValue={contact.org} className={control}>
              <option value="customer">Customer</option>
              <option value="vendor">Our team</option>
              <option value="partner">Partner</option>
            </select>
          </Field>
          <Field label="Role" hint="What they are to us. Their job title goes above.">
            <select name="role" defaultValue={contact.role ?? ""} className={control}>
              <option value="">not set</option>
              {CONTACT_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>
              ))}
            </select>
          </Field>
          <Field label="Email"><input name="email" defaultValue={contact.email ?? ""} className={control} /></Field>
          <Field label="Notes" wide><textarea name="notes" defaultValue={contact.notes ?? ""} rows={2} className={control} /></Field>
        </ActionForm>
        {!isArchived && (
          <div className="mt-3">
            <ArchiveButton what={contact.name} action={archiveRecord.bind(null, "contact", contactId)} />
          </div>
        )}
      </Section>

      {!isArchived && (
      <Section
        id="also-at"
        title="The same person elsewhere"
        aside={alsoAt.length > 0 ? <span>{alsoAt.length} other account{alsoAt.length === 1 ? "" : "s"}</span> : undefined}
      >
        {alsoAt.length === 0 ? (
          <Empty>Not linked to anyone at another account.</Empty>
        ) : (
          <ul className="divide-y divide-line" data-testid="also-at">
            {alsoAt.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-3 py-2">
                <Link href={`/accounts/${c.account_id}/contacts/${c.id}`} className="font-semibold text-accent hover:underline">
                  {c.account_name}
                </Link>
                <span className="text-label text-ink-muted">
                  {c.name}
                  {c.title ? ` · ${c.title}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <ActionForm action={linkPerson.bind(null, id, contactId)} testId="person-link" trigger="Link to another account" submitLabel="Link">
            <Field
              label="The same person, at"
              hint="Both rows stay. Their role and what you have written about them belong to each account, and neither is overwritten — this only says the two are the same human. It is not shown to anyone outside this app and never reaches a brief or a handoff."
              wide
            >
              <select name="other_id" required defaultValue={elsewhere.length === 1 ? elsewhere[0]!.id : ""} className={control}>
                <option value="" disabled>
                  pick the person
                </option>
                {elsewhere.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.account_name} · {c.name}
                    {c.email ? ` · ${c.email}` : ""}
                  </option>
                ))}
              </select>
            </Field>
          </ActionForm>
          {alsoAt.length > 0 && (
            <ActionForm
              action={unlinkPersonAction.bind(null, id, contactId)}
              testId="person-unlink"
              trigger="Not the same person"
              submitLabel="Unlink"
            >
              <p className="text-label text-ink-muted">Takes this row out. The others stay linked to each other, and nothing else changes.</p>
            </ActionForm>
          )}
        </div>
      </Section>
      )}

      {/* Two rows for one person.
          Extraction proposes a new person whenever it cannot match one, which
          is right and which is exactly how duplicates arrive. This control
          lived on the account page as one of twenty-five identical widgets and
          was deleted when editing moved here; the move brought the edit form
          and left this behind, so for one phase merging two people was
          impossible from anywhere in the app. It belongs here, where the
          person is the subject rather than a row.

          Always rendered, not only when a duplicate is detected: the pair the
          app cannot see — "Dana Whitfield" and "D. Whitfield" — is the pair a
          person can. */}
      {!isArchived && others.length > 0 && (
        <Section id="merge" title="Merge someone into this person">
          {duplicates.length > 0 && (
            <Callout tone="warning" className="mb-3">
              {duplicates.length === 1
                ? `${duplicates[0]!.name} looks like the same person: `
                : "These look like the same person: "}
              {duplicates.map((c) => c.name).join(", ")}.
            </Callout>
          )}
          <ActionForm action={merge} testId="contact-merge" trigger="Merge someone in" submitLabel="Merge">
            <Field
              label={`Merge into ${contact.name}`}
              hint="They are archived. Their meetings, plays, history and anything proposed for them come here, and this person's own fields are never overwritten — only their blank ones are filled."
              wide
            >
              <select name="loser_id" required defaultValue={duplicates.length === 1 ? duplicates[0]!.id : ""} className={control}>
                {duplicates.length !== 1 && (
                  <option value="" disabled>
                    pick the duplicate
                  </option>
                )}
                {others.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.title ? ` · ${c.title}` : ""}
                    {c.email ? ` · ${c.email}` : ""}
                  </option>
                ))}
              </select>
            </Field>
          </ActionForm>
        </Section>
      )}

      <Section id="history" title="History" aside={<span>{historyCountText(history.length, historyTotal)}</span>}>
        {history.length === 0 ? (
          <Empty>Nothing has changed since {contact.name} was added.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {history.map((h) => (
              <li key={h.id} className="grid gap-x-4 gap-y-0.5 py-2 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-baseline">
                <div className="text-label font-medium text-ink">{h.field.replace(/_/g, " ")}</div>
                <div className="min-w-0 text-label">
                  <span className="text-ink-faint line-through">{logValueText(h.old_value, labelFor)}</span>
                  <span aria-hidden className="mx-1.5 text-ink-faint">
                    →
                  </span>
                  <span className="text-ink">{logValueText(h.new_value, labelFor)}</span>
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
