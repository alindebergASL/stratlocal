import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { getAccount, listContacts, listDeals, listPlays } from "@/lib/queries/accounts";
import { listActionItems } from "@/lib/queries/meetings";
import { listHandoffs, shareState, SHARE_DAYS, DEFAULT_SHARE_DAYS, MIN_PASSPHRASE } from "@/lib/handoff/store";
import { createHandoff } from "@/app/actions";
import { fmtDay, fmtMoney } from "@/lib/format";
import { dayOf } from "@/lib/clock";
import { Page } from "@/components/Nav";
import { Breadcrumb, Callout, Chip, control, Empty, Field, PageHeader, Section } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { RunButton } from "@/components/RunButton";
import { DraftView } from "@/components/DraftView";
import { latestAccountDraft } from "@/lib/handoff/writer";
import { buildContextPack, evidenceIndex } from "@/lib/meetings/contextPack";
import { providerProblem } from "@/lib/ai/client";
import { ROLES } from "@/lib/ai/models";
import { runningRunFor } from "@/lib/ai/guard";

export const dynamic = "force-dynamic";

export default async function HandoffIndexPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const account = getAccount(id);
  if (!account) notFound();

  const deals = listDeals(id).filter((d) => d.status === "open");
  const pipeline = deals.reduce((s, d) => s + (d.tcv_usd ?? 0), 0);
  const plays = listPlays(id).filter((p) => p.status !== "dropped");
  const contacts = listContacts(id);
  const follow = listActionItems(id, { status: "open" });
  const existing = listHandoffs(id);
  const now = Date.now();
  const draftRun = latestAccountDraft(id);
  const draft = draftRun?.draft ?? null;
  // Each cited id, as a label and a link the person can check before using it.
  const index = draft ? evidenceIndex(buildContextPack(id)) : new Map();
  const refHref = (ref: string, kind: string | undefined) =>
    kind === "deal" ? `/accounts/${id}/deals/${encodeURIComponent(ref)}` : kind === "play" ? `/accounts/${id}/plays/${ref}` : kind === "meeting" ? `/accounts/${id}/meetings/${ref}` : kind === "contact" ? `/accounts/${id}/contacts/${ref}` : null;
  const inFlight = runningRunFor(id);

  return (
    <Page user={user}>
      <Breadcrumb accountId={id} accountName={account.name} page="Handoff" />
      <PageHeader
        title="Hand this account over"
        sub="A snapshot of where things stand, with what you are asking for, on a link the other team can open without a login."
      />

      <Section title="What will be in it">
        {/* Said before the button, not after: this is a snapshot, and the
            person needs to know they are freezing what is on file right now. */}
        <p className="text-label text-ink-muted">
          Everything below is taken as it stands today and stored. It does not change afterwards — if a deal slips next week, the copy they are reading
          still says what you sent.
        </p>
        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-label">
          <div>
            <dt className="text-micro uppercase tracking-[0.06em] text-ink-muted">Open pipeline</dt>
            <dd className="font-semibold tabular-nums text-ink-strong">
              {fmtMoney(pipeline)} <span className="text-micro font-normal text-ink-muted">/ {deals.length}</span>
            </dd>
          </div>
          <div>
            <dt className="text-micro uppercase tracking-[0.06em] text-ink-muted">Plays</dt>
            <dd className="font-semibold tabular-nums text-ink-strong">{plays.length}</dd>
          </div>
          <div>
            <dt className="text-micro uppercase tracking-[0.06em] text-ink-muted">People</dt>
            <dd className="font-semibold tabular-nums text-ink-strong">{contacts.length}</dd>
          </div>
          <div>
            <dt className="text-micro uppercase tracking-[0.06em] text-ink-muted">Open follow-ups</dt>
            <dd className="font-semibold tabular-nums text-ink-strong">{follow.length}</dd>
          </div>
        </dl>
        {!account.thesis && (
          <Callout tone="warning" className="mt-3">
            This account has no thesis written, so the handoff will open with what we are asking for and then go straight to the deals. Writing a
            paragraph on the account page first is usually worth more than everything else in the document.
          </Callout>
        )}
      </Section>

      <Section
        title="What you are asking for"
        aside={
          <RunButton
            url={`/api/accounts/${id}/handoff-draft`}
            key={draftRun?.id ?? "none"}
            initialRun={draftRun ? { id: draftRun.id, state: draftRun.state } : null}
            label={draft ? "Draft again" : "Draft it for me"}
            busyLabel="Drafting…"
            kind="handoff"
            tone="quiet"
            disabledReason={account.archived_at ? "That account is archived." : (providerProblem(ROLES.handoff_draft.provider) ?? (inFlight ? "Another AI run is working on this account." : null))}
          />
        }
      >
        {draft && (
          <div className="mb-5">
            <p className="mb-2 text-micro text-ink-muted">Handoff writer&apos;s draft, from the records. Every point names what it rests on; check them before you use it.</p>
            <DraftView
              opening={draft.opening}
              points={draft.points.map((p) => ({ text: p.text, sources: p.refs.map((r) => ({ label: index.get(r)?.label ?? r, href: refHref(r, index.get(r)?.kind) })) }))}
              fill={{ form: "handoff-new", opening: "asks", points: "note" }}
            />
          </div>
        )}
        <ActionForm action={createHandoff.bind(null, id)} testId="handoff-new" trigger="Write the handoff" submitLabel="Create the handoff" open>
          <Field label="What do you need from them?" hint="The part they act on. Everything else is the record; this is the request." wide>
            <textarea
              name="asks"
              required
              rows={4}
              className={control}
              placeholder="Keep the quarterly cadence with their infrastructure director — she is the one who decides. The storage refresh needs a technical owner by the end of the month."
            />
          </Field>
          <Field label="Anything else worth saying" hint="Optional. Context that is not on file anywhere." wide>
            <textarea name="note" rows={3} className={control} />
          </Field>
          <Field label="The link stops working after" hint="You can end it sooner.">
            <select name="share_days" defaultValue={String(DEFAULT_SHARE_DAYS)} className={control}>
              {SHARE_DAYS.map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Passphrase"
            hint="Give it to them separately — a different message from the one carrying the link. Leave blank and the link opens for anyone it reaches."
          >
            <input type="text" name="passphrase" autoComplete="off" minLength={MIN_PASSPHRASE} className={control} placeholder="At least 8 characters" />
          </Field>
        </ActionForm>
      </Section>

      <Section title="Already sent" aside={existing.length > 0 ? `${existing.length}` : null}>
        {existing.length === 0 ? (
          <Empty>Nothing handed over yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {existing.map(({ doc, report }) => {
              const state = shareState(doc, now);
              return (
                <li key={doc.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
                  <Link href={`/accounts/${id}/handoff/${doc.id}`} className="font-medium text-ink hover:text-accent hover:underline">
                    {fmtDay(report.generated_at)} · {report.generated_by}
                  </Link>
                  <span className="flex items-baseline gap-2 text-micro text-ink-muted">
                    {state === "live" ? (
                      <Chip tone="positive">link live until {fmtDay(dayOf(doc.share_expires_at ?? 0))}</Chip>
                    ) : state === "expired" ? (
                      <Chip tone="neutral">link expired</Chip>
                    ) : (
                      <Chip tone="neutral">link ended</Chip>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </Page>
  );
}
