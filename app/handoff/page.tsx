import Link from "next/link";
import { BackLink } from "@/components/BackLink";
import { listUsers, requirePageUser } from "@/lib/auth";
import { addDays, isRealDay, todayISO } from "@/lib/clock";
import { fmtDay } from "@/lib/format";
import { buildCover, coverOptions, coverSize, nextTimeOff, type CoverWindow } from "@/lib/handoff/cover";
import { latestCoverDraft } from "@/lib/handoff/writer";
import { providerProblem } from "@/lib/ai/client";
import { ROLES } from "@/lib/ai/models";
import { Page } from "@/components/Nav";
import { Chip, control, Section } from "@/components/ui";
import { RunButton } from "@/components/RunButton";
import { DraftView } from "@/components/DraftView";
import { HandOver } from "./HandOver";
import { handOverAction } from "./actions";

export const dynamic = "force-dynamic";

const span = (w: CoverWindow, now: Date) => (w.from === w.to ? fmtDay(w.from, now) : `${fmtDay(w.from, now)} – ${fmtDay(w.to, now)}`);

// Cover while someone is away. The window comes from their own calendar's
// time off (phase 4), or from dates typed here. What is listed is code; the
// note is Handoff writer's draft; handing follow-ups over is a press.
export default async function HandoffCoverPage({ searchParams }: { searchParams: Promise<{ for?: string; from?: string; to?: string; by?: string }> }) {
  const user = await requirePageUser();
  const q = await searchParams;
  const now = new Date();
  const today = todayISO(now);
  const users = listUsers();
  const who = users.find((u) => u.id === q.for) ?? users.find((u) => u.id === user.id)!;
  const mine = who.id === user.id;
  const typed = q.from && q.to && isRealDay(q.from) && isRealDay(q.to) && q.to >= q.from ? { from: q.from, to: q.to } : null;
  const window = typed ?? nextTimeOff(who.id, today, 30);
  const cover = window ? buildCover(who.id, window, today, q.by ?? null) : null;
  const options = coverOptions(who.id);
  const byHref = (id: string) => {
    const sp = new URLSearchParams(Object.entries({ for: q.for, from: q.from, to: q.to, by: id }).filter((e): e is [string, string] => !!e[1]));
    return `/handoff?${sp.toString()}`;
  };
  const draftRun = window ? latestCoverDraft(who.id, window) : null;
  const draft = draftRun?.draft ?? null;
  const labels = new Map<string, { label: string; href: string }>();
  if (cover) {
    for (const f of cover.followUps) labels.set(f.id, { label: f.text.slice(0, 60), href: `/follow-ups/${f.id}` });
    for (const m of cover.meetings) labels.set(m.id, { label: m.title, href: `/accounts/${m.accountId}/meetings/${m.id}` });
    for (const p of cover.promises) labels.set(p.id, { label: p.text.slice(0, 60), href: `/follow-ups/${p.id}` });
    for (const p of cover.plays) labels.set(p.id, { label: p.title, href: `/accounts/${p.accountId}/plays/${p.id}` });
  }

  return (
    <Page user={user} main="max-w-3xl">
      <div className="mb-4"><BackLink fallback="/" fallbackLabel="Back to Today" /></div>
      <h1 className="font-display text-display font-extrabold tracking-tight text-ink-strong">{mine ? "Cover while you are away" : `Cover while ${who.display_name} is away`}</h1>

      <form className="mt-4 flex flex-wrap items-end gap-2 text-label" method="get" data-testid="cover-dates">
        {!mine && <input type="hidden" name="for" value={who.id} />}
        <label className="text-micro text-ink-muted">First day away<input type="date" name="from" defaultValue={window?.from ?? today} className={`${control} mt-1 block max-w-44`} /></label>
        <label className="text-micro text-ink-muted">Last day away<input type="date" name="to" defaultValue={window?.to ?? addDays(today, 4)} className={`${control} mt-1 block max-w-44`} /></label>
        <button type="submit" className="min-h-10 rounded-md border border-control-line bg-surface px-3 font-semibold text-ink hover:border-accent">Show</button>
        {users.length > 1 && (
          <Link href={mine ? `/handoff?for=${users.find((u) => u.id !== user.id)!.id}` : "/handoff"} className="ml-auto self-center text-micro text-accent hover:underline">
            {mine ? `${users.find((u) => u.id !== user.id)!.display_name}'s time off` : "Your own time off"}
          </Link>
        )}
      </form>

      {!window || !cover ? (
        <p className="mt-8 rounded-xl bg-surface-sunk px-4 py-3 text-label text-ink" data-testid="cover-none">
          {mine ? "Your calendar shows no time off in the next 30 days." : `${who.display_name}'s calendar shows no time off in the next 30 days.`} Pick the days above, or <Link href="/calendar" className="font-semibold text-accent hover:underline">connect a calendar</Link> so it is noticed on its own.
        </p>
      ) : (
        <>
          <p className="mt-4 text-lead text-ink" data-testid="cover-summary">
            {span(window, now)}{typed ? "" : ", from the calendar"}. {coverSize(cover) === 0 ? "Nothing falls in those days." : `${coverSize(cover)} thing${coverSize(cover) === 1 ? "" : "s"} fall${coverSize(cover) === 1 ? "s" : ""} in them${cover.partner ? `; ${cover.partner.id === user.id ? "you are" : `${cover.partner.name} is`} covering` : ""}.`}
          </p>
          {options.length > 1 && (
            <nav aria-label="Who covers" className="mt-2 flex flex-wrap items-center gap-1.5 text-label" data-testid="cover-by">
              <span className="text-ink-muted">Who covers:</span>
              {options.map((o) => (
                <Link key={o.id} href={byHref(o.id)} aria-current={cover.partner?.id === o.id ? "page" : undefined} className={`rounded-full px-2.5 py-0.5 ring-1 ${cover.partner?.id === o.id ? "bg-accent-soft font-semibold text-ink ring-accent-line" : "text-ink-muted ring-line hover:text-ink"}`}>
                  {o.id === user.id ? "You" : o.name}
                </Link>
              ))}
            </nav>
          )}

          {coverSize(cover) > 0 && (
            <Section
              title={`A note for ${cover.partner?.name ?? "whoever covers"}`}
              className="mt-8"
              aside={
                <RunButton
                  url="/api/handoff/cover"
                  body={{ userId: who.id, from: window.from, to: window.to, ...(cover.partner ? { by: cover.partner.id } : {}) }}
                  key={draftRun?.id ?? "none"}
                  initialRun={draftRun ? { id: draftRun.id, state: draftRun.state } : null}
                  label={draft ? "Draft again" : "Draft the note"}
                  busyLabel="Drafting…"
                  kind="handoff"
                  tone="quiet"
                  disabledReason={providerProblem(ROLES.handoff_draft.provider)}
                />
              }
            >
              {draft ? (
                <DraftView testId="cover-draft" opening={draft.opening} points={draft.points.map((p) => ({ text: p.text, sources: p.refs.map((r) => ({ label: labels.get(r)?.label ?? r, href: labels.get(r)?.href ?? null })) }))} />
              ) : (
                <p className="text-label text-ink-muted">Draft a short cover note from what is below, to copy into a message.</p>
              )}
            </Section>
          )}

          {/* Always rendered when someone can cover: handing over re-renders
              this page, the handed rows are no longer theirs, and a section
              that vanished would take the confirmation with it. */}
          {(cover.partner || cover.followUps.length > 0) && (
            <Section title={`${mine ? "Your" : `${who.display_name}'s`} follow-ups due by ${fmtDay(window.to, now)}`} aside={<span>{cover.followUps.length}</span>}>
              {cover.partner ? (
                <HandOver
                  rows={cover.followUps.map((f) => ({ id: f.id, accountId: f.accountId, accountName: f.accountName, text: f.text, dueLabel: fmtDay(f.due, now), late: f.late, version: f.version }))}
                  to={cover.partner}
                  hand={handOverAction}
                />
              ) : (
                <ul className="divide-y divide-line">{cover.followUps.map((f) => <li key={f.id} className="py-2">{f.text}</li>)}</ul>
              )}
            </Section>
          )}

          {cover.meetings.length > 0 && (
            <Section title="Meetings in those days" aside={<span>{cover.meetings.length}</span>}>
              <ul className="divide-y divide-line" data-testid="cover-meetings">
                {cover.meetings.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                    <Link href={`/accounts/${m.accountId}/meetings/${m.id}`} className="min-w-0 flex-1 font-medium text-ink-strong hover:underline">{m.title}</Link>
                    <span className="text-micro text-ink-muted">{m.accountName} · {fmtDay(m.day, now)}{m.time ? ` · ${m.time}` : ""}</span>
                    {m.hasBrief ? <Chip tone="positive">brief ready</Chip> : <Chip tone="warning">no brief yet</Chip>}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {cover.promises.length > 0 && (
            <Section title="What customers promised for those days" aside={<span>{cover.promises.length}</span>}>
              <ul className="divide-y divide-line">
                {cover.promises.map((p) => (
                  <li key={p.id} className="py-2.5">
                    <p className="text-ink-strong">{p.text}</p>
                    <p className="text-micro text-ink-muted">{p.accountName} · {p.owner} · by {fmtDay(p.due, now)}</p>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {cover.plays.length > 0 && (
            <Section title="Play steps due" aside={<span>{cover.plays.length}</span>}>
              <ul className="divide-y divide-line">
                {cover.plays.map((p) => (
                  <li key={p.id} className="py-2.5">
                    <Link href={`/accounts/${p.accountId}/plays/${p.id}`} className="font-medium text-ink-strong hover:underline">{p.title}</Link>
                    <p className="text-micro text-ink-muted">{p.accountName} · {p.nextStep} · by {fmtDay(p.due, now)}</p>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </Page>
  );
}
