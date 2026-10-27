// The account, on one page, with nothing on it you can press.
//
// This is the shared-screen case: turning an account over to another team, or
// walking someone through it on a call. Every other screen in this app is
// built for working — edit forms, archive buttons, "Draft plan" — and putting
// that in front of somebody else is both distracting and slightly alarming.
// Here there is no control at all, the type is bigger, and @media print in
// globals.css turns the browser's own Save as PDF into something sendable.
//
// It is deliberately not a handoff report: nothing is generated, nothing is
// stored, and there is no share link. It is what is on file, laid out to be
// read.
import Link from "next/link";
import { ResearchReportView } from "@/components/ResearchReportView";
import { SourceLink } from "@/components/SourceLink";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { getAccount, latestInstallBase, listContacts, listDeals, listPlays } from "@/lib/queries/accounts";
import { byWhen, listActionItems, listMeetings } from "@/lib/queries/meetings";
import { keptFindings, listNotes } from "@/lib/research/notes";
import { currentFiscalQuarter } from "@/lib/fiscal";
import { todayISO, todayLabel } from "@/lib/clock";
import { crmIdText, fmtDay, fmtMoney, fmtMoneyShort, parseJsonArray, stageText } from "@/lib/format";
import { Nav } from "@/components/Nav";
import { Eyebrow } from "@/components/ui";

export const dynamic = "force-dynamic";

const ORG_LABEL: Record<string, string> = {
  customer: "Customer",
  vendor: "Our team",
  partner: "Partner",
};

function Block({ title, aside, children }: { title: string; aside?: string | null; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 border-b-2 border-ink-strong pb-1">
        <h2 className="font-display text-heading font-bold tracking-tight text-ink-strong">{title}</h2>
        {aside && <span className="text-label text-ink-muted">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

export default async function AccountDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const account = getAccount(id);
  if (!account) notFound();

  const today = todayISO();
  const deals = listDeals(id).filter((d) => d.status === "open");
  const contacts = listContacts(id);
  const plays = listPlays(id).filter((p) => p.status !== "dropped");
  const installBase = latestInstallBase(id);
  const notes = listNotes(id, "accepted");
  const openItems = listActionItems(id, { status: "open" });
  const meetings = listMeetings(id);
  const recentMeetings = meetings.filter((m) => m.held_at.slice(0, 10) <= today).slice(0, 5);
  const nextMeetings = meetings.filter((m) => m.held_at.slice(0, 10) > today).sort(byWhen);
  const fq = currentFiscalQuarter();
  const pipeline = deals.reduce((s, d) => s + (d.tcv_usd ?? 0), 0);
  const dealLabel = new Map(listDeals(id, { includeArchived: true }).map((d) => [d.deal_id, d.name]));
  const contactLabel = new Map(listContacts(id, { includeArchived: true }).map((c) => [c.id, c.name]));

  // Open deals by the quarter they are meant to close in, most imminent first.
  // Undated ones are their own group at the end rather than silently sorted
  // among the dated ones.
  const byQuarter = new Map<string, typeof deals>();
  for (const d of deals) {
    const key = d.fiscal_quarter ?? "No close date";
    byQuarter.set(key, [...(byQuarter.get(key) ?? []), d]);
  }
  const quarters = [...byQuarter.entries()].sort(([a], [b]) => (a === "No close date" ? 1 : b === "No close date" ? -1 : a.localeCompare(b)));

  return (
    <div data-print="document" className="lg:flex">
      <Nav user={user} />
      <main className="mx-auto w-full min-w-0 max-w-4xl px-4 py-6 text-body lg:py-10">
        {/* The only two controls on the page, and both disappear when it is
            printed: one says where you are, the other says how to send it. */}
        <div data-print-hide className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href={`/accounts/${id}`} className="text-label text-accent hover:underline">
            ← back to {account.name}
          </Link>
          <span className="text-micro text-ink-muted">
            Full account details and preserved research. Original reports may contain rejected claims and are not accepted evidence.
          </span>
        </div>

        {/* getAccount is unfiltered on purpose, so a direct link to an
            archived account still resolves — and this page, unlike every
            other one, rendered it as though nothing were wrong. It is the
            page meant to be printed and handed to another team, so saying so
            matters more here than anywhere. It prints, too: a hand-over of an
            archived account should carry the word. */}
        {account.archived_at && (
          <p className="mb-4 rounded-lg border border-line bg-surface-sunk px-3 py-2 text-label text-ink-muted">
            This account was archived on {account.archived_at}. It is hidden from every list in the app.
          </p>
        )}

        <header className="mb-7 border-b-2 border-ink-strong pb-3">
          <Eyebrow>Account details · {todayLabel()}</Eyebrow>
          <h1 className="mt-1 font-display text-display font-extrabold tracking-tight text-ink-strong">{account.name}</h1>
          <p className="mt-1.5 text-body text-ink-muted">
            {[account.legal_entity, account.hq, account.region, account.segment].filter(Boolean).join(" · ") || "No details on file."}
          </p>
          <p className="mt-3 text-body">
            <strong className="tabular-nums text-ink-strong">{fmtMoney(pipeline)}</strong> open across {deals.length} deal
            {deals.length === 1 ? "" : "s"}
            {nextMeetings[0] ? ` · next meeting ${fmtDay(nextMeetings[0].held_at)}` : ""}
          </p>
        </header>

        <Block title="Where we stand">
          {account.thesis ? <p className="whitespace-pre-wrap text-body leading-relaxed">{account.thesis}</p> : <p className="text-ink-muted">No thesis written yet.</p>}
        </Block>

        <Block title="Plays" aside={plays.length > 0 ? `${plays.length} live` : null}>
          {plays.length === 0 ? (
            <p className="text-ink-muted">No plays yet.</p>
          ) : (
            <ol className="space-y-3">
              {plays.map((p) => {
                const linkedDeals = parseJsonArray(p.deal_ids_json).map((d) => dealLabel.get(d) ?? d);
                const linkedPeople = parseJsonArray(p.contact_ids_json).map((c) => contactLabel.get(c) ?? c);
                return (
                  <li key={p.id} className="border-l-2 border-line pl-3">
                    <p className="font-display font-bold text-ink-strong">
                      {p.title} <span className="font-sans text-micro font-medium uppercase tracking-[0.06em] text-ink-muted">{p.status}</span>
                    </p>
                    {p.thesis && <p className="mt-0.5 text-label leading-relaxed">{p.thesis}</p>}
                    <p className="mt-1 text-micro text-ink-muted">
                      {p.next_step ? `Next: ${p.next_step}${p.next_step_due ? ` (by ${fmtDay(p.next_step_due)})` : ""}` : "No next step agreed"}
                      {p.owner ? ` · ${p.owner}` : ""}
                    </p>
                    {(linkedDeals.length > 0 || linkedPeople.length > 0) && (
                      <p className="mt-0.5 text-micro text-ink-muted">
                        {linkedDeals.length > 0 ? `Deals: ${linkedDeals.join(", ")}` : ""}
                        {linkedDeals.length > 0 && linkedPeople.length > 0 ? " · " : ""}
                        {linkedPeople.length > 0 ? `People: ${linkedPeople.join(", ")}` : ""}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </Block>

        <Block title="Open deals" aside={`this quarter is ${fq.label}`}>
          {deals.length === 0 ? (
            <p className="text-ink-muted">Nothing open.</p>
          ) : (
            <div className="space-y-4">
              {quarters.map(([quarter, rows]) => (
                <div key={quarter}>
                  <Eyebrow className="mb-1">
                    {quarter} · {fmtMoneyShort(rows.reduce((s, d) => s + (d.tcv_usd ?? 0), 0))}
                  </Eyebrow>
                  {/* Fixed columns, because each quarter is its own table and
                      they otherwise size independently: stage and close date
                      landed in a different place in every group. */}
                  <div className="max-w-full overflow-x-auto print:overflow-visible" role="region" aria-label={`Open deals — ${quarter}`} tabIndex={0} data-testid="summary-deal-scroll">
                  <table className="w-full min-w-[32rem] table-fixed text-label sm:min-w-0 print:min-w-0">
                    <colgroup>
                      <col />
                      <col className="w-36" />
                      <col className="w-24" />
                      <col className="w-28" />
                    </colgroup>
                    <tbody>
                      {rows.map((d) => (
                        <tr key={d.deal_id} className="border-b border-line align-baseline">
                          <td className="py-1.5 pr-3">
                            <span className="font-semibold text-ink-strong">{d.name}</span>
                            {/* A deal we opened before the CRM did has no id
                                worth printing, and `local-3f9c1a20` on a page
                                you hand to another team is worse than blank. */}
                            <span className="block text-micro text-ink-muted empty:hidden">
                              {[crmIdText(d.deal_id), d.competitor ? `vs ${d.competitor}` : null, d.partner ? `via ${d.partner}` : null].filter(Boolean).join(" · ")}
                            </span>
                          </td>
                          <td className="whitespace-nowrap py-1.5 pr-3 text-micro text-ink-muted">{stageText(d.stage, d.stage_label)}</td>
                          <td className="whitespace-nowrap py-1.5 pr-3 text-micro tabular-nums text-ink-muted">{fmtDay(d.close_date)}</td>
                          <td className="whitespace-nowrap py-1.5 text-right font-semibold tabular-nums text-ink-strong">{fmtMoney(d.tcv_usd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                  {rows.some((d) => d.next_step) && (
                    <ul className="mt-1 space-y-0.5 text-micro text-ink-muted">
                      {rows
                        .filter((d) => d.next_step)
                        .map((d) => (
                          <li key={d.deal_id}>
                            <span className="font-medium text-ink">{d.name}:</span> {d.next_step}
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </Block>

        <Block title="People" aside={contacts.length > 0 ? `${contacts.length}` : null}>
          {contacts.length === 0 ? (
            <p className="text-ink-muted">Nobody on file.</p>
          ) : (
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {contacts.map((c) => (
                <div key={c.id}>
                  <p className="font-semibold text-ink-strong">{c.name}</p>
                  <p className="text-micro text-ink-muted">{[ORG_LABEL[c.org], c.title, c.role?.replace(/_/g, " ")].filter(Boolean).join(" · ")}</p>
                  {c.notes && <p className="text-micro">{c.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </Block>

        {openItems.length > 0 && (
          <Block title="Open follow-ups" aside={`${openItems.length}`}>
            <ul className="space-y-1 text-label">
              {openItems.map((a) => (
                <li key={a.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span>{a.text}</span>
                  <span className={`text-micro ${a.due && a.due < today ? "font-semibold text-danger" : "text-ink-muted"}`}>
                    {[a.owner, a.due ? `due ${fmtDay(a.due)}` : null].filter(Boolean).join(" · ")}
                    {a.due && a.due < today ? " · overdue" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </Block>
        )}

        {installBase.rows.length > 0 && (
          <Block title="Install base" aside={installBase.asOf ? `as of ${installBase.asOf}` : null}>
            <table className="w-full text-label">
              <tbody>
                {installBase.rows.map((r) => (
                  <tr key={r.id} className="border-b border-line align-baseline">
                    <td className="py-1 pr-3">
                      <span className="font-medium text-ink-strong">{r.product_family}</span>
                      {r.role_note && <span className="block text-micro text-ink-muted">{r.role_note}</span>}
                    </td>
                    <td className="whitespace-nowrap py-1 pr-3 text-right tabular-nums">{fmtMoney(r.value_usd)}</td>
                    <td className="whitespace-nowrap py-1 text-right text-micro tabular-nums text-ink-muted">{r.share_pct === null ? "" : `${r.share_pct}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Block>
        )}

        {notes.length > 0 && (
          <Block title="What the public record says" aside={`${notes.length} note${notes.length === 1 ? "" : "s"}`}>
            <div className="space-y-4">
              {notes.map((n) => {
                const kept = keptFindings(n.meta);
                return (
                  <article key={n.doc.id}>
                    <p className="font-semibold text-ink-strong">
                      {n.meta.title} <span className="text-micro font-normal text-ink-muted">{n.meta.generated_at}</span>
                    </p>
                    {kept.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-label">
                        {kept.map((f, i) => (
                          <li key={`${f.url}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
                            <span>{f.text}</span>
                            {/* The one place a URL is printed: a claim about
                                someone else's organisation without its source
                                is exactly what this page must not hand over. */}
                            <SourceLink url={f.url}>source{f.date ? ` (${f.date})` : ""}</SourceLink>
                          </li>
                        ))}
                      </ul>
                    )}
                    <ResearchReportView text={n.doc.content_text ?? ""} sources={n.meta.sources} />
                  </article>
                );
              })}
            </div>
          </Block>
        )}

        {(nextMeetings.length > 0 || recentMeetings.length > 0) && (
          <Block title="Meetings">
            {nextMeetings.length > 0 && (
              <>
                <Eyebrow className="mb-1">Coming up</Eyebrow>
                <ul className="mb-3 space-y-0.5 text-label">
                  {nextMeetings.map((m) => (
                    <li key={m.id}>
                      <span className="tabular-nums text-ink-muted">
                        {fmtDay(m.held_at)}
                        {m.held_time ? ` at ${m.held_time}` : ""}
                      </span>{" "}
                      · {m.title}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {recentMeetings.length > 0 && (
              <>
                <Eyebrow className="mb-1">Recently</Eyebrow>
                <ul className="space-y-1.5 text-label">
                  {recentMeetings.map((m) => (
                    <li key={m.id}>
                      <span className="tabular-nums text-ink-muted">
                        {fmtDay(m.held_at)}
                        {m.held_time ? ` at ${m.held_time}` : ""}
                      </span>{" "}
                      · <span className="font-medium">{m.title}</span>
                      {m.summary && <span className="block text-micro leading-relaxed text-ink-muted">{m.summary}</span>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Block>
        )}

        <p className="mt-8 border-t border-line pt-2 text-micro text-ink-muted">
          {account.name} · as at {todayLabel()} · everything here is what is on file in this workspace.
        </p>
      </main>
    </div>
  );
}
