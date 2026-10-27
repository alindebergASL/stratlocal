// A stored handoff, rendered.
//
// Everything it shows comes out of the snapshot object — no queries, no ids,
// no links into the app. That is what lets one component serve both the
// preview the sender sees and the page a stranger opens with the link: there
// is nothing here that could leak more to the second reader than the first.
//
// It carries `data-print="document"`, so the browser's own Save as PDF gives
// the recipient something sendable, the same way the one-pager does.
import { fmtDay, fmtMoney, fmtMoneyShort, stageText } from "@/lib/format";
import { Eyebrow } from "@/components/ui";
import type { HandoffReport } from "@/lib/handoff/schema";

const ORG_LABEL: Record<string, string> = { customer: "Customer", vendor: "Our team", partner: "Partner" };

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

export function HandoffView({ report }: { report: HandoffReport }) {
  const { account } = report;
  const byQuarter = new Map<string, HandoffReport["deals"]>();
  for (const d of report.deals) {
    const key = d.fiscal_quarter ?? "No close date";
    byQuarter.set(key, [...(byQuarter.get(key) ?? []), d]);
  }
  const quarters = [...byQuarter.entries()].sort(([a], [b]) =>
    a === "No close date" ? 1 : b === "No close date" ? -1 : a.localeCompare(b),
  );

  return (
    <>
      <header className="mb-7 border-b-2 border-ink-strong pb-3">
        <Eyebrow>Account handoff · prepared {fmtDay(report.generated_at)} by {report.generated_by}</Eyebrow>
        <h1 className="mt-1 font-display text-display font-extrabold tracking-tight text-ink-strong">{account.name}</h1>
        <p className="mt-1.5 text-body text-ink-muted">
          {[account.legal_entity, account.hq, account.region, account.segment, account.crm_id].filter(Boolean).join(" · ") || "No details on file."}
        </p>
        <p className="mt-3 text-body">
          <strong className="tabular-nums text-ink-strong">{fmtMoney(report.open_pipeline_usd)}</strong> open across {report.deals.length} deal
          {report.deals.length === 1 ? "" : "s"} · this quarter is {report.quarter}
        </p>
      </header>

      {/* First, because it is the only part written for the reader rather
          than copied from the record, and the one thing they are being asked
          to do something about. */}
      <Block title="What we are asking for">
        <p className="whitespace-pre-wrap text-body leading-relaxed">{report.asks}</p>
        {report.note && <p className="mt-3 whitespace-pre-wrap text-label leading-relaxed text-ink-muted">{report.note}</p>}
      </Block>

      <Block title="Where we stand">
        {account.thesis ? (
          <p className="whitespace-pre-wrap text-body leading-relaxed">{account.thesis}</p>
        ) : (
          <p className="text-ink-muted">No thesis written.</p>
        )}
      </Block>

      <Block title="Open deals" aside={report.deals.length > 0 ? fmtMoneyShort(report.open_pipeline_usd) : null}>
        {report.deals.length === 0 ? (
          <p className="text-ink-muted">Nothing open.</p>
        ) : (
          <div className="space-y-4">
            {quarters.map(([quarter, rows]) => (
              <div key={quarter}>
                <Eyebrow className="mb-1">
                  {quarter} · {fmtMoneyShort(rows.reduce((s, d) => s + (d.tcv_usd ?? 0), 0))}
                </Eyebrow>
                <div className="overflow-x-auto">
                  <table className="w-full table-fixed text-label">
                    <colgroup>
                      <col />
                      <col className="w-36" />
                      <col className="w-24" />
                      <col className="w-28" />
                    </colgroup>
                    <tbody>
                      {rows.map((d, i) => (
                        <tr key={`${d.name}-${i}`} className="border-b border-line align-baseline">
                          <td className="py-1.5 pr-3">
                            <span className="font-semibold text-ink-strong">{d.name}</span>
                            <span className="block text-micro text-ink-muted empty:hidden">
                              {[d.crm_id, d.competitor ? `vs ${d.competitor}` : null, d.partner ? `via ${d.partner}` : null].filter(Boolean).join(" · ")}
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
                      .map((d, i) => (
                        <li key={`${d.name}-next-${i}`}>
                          <span className="font-medium text-ink">{d.name}:</span> {d.next_step}
                          {d.owner ? ` (${d.owner})` : ""}
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </Block>

      <Block title="Plays" aside={report.plays.length > 0 ? `${report.plays.length}` : null}>
        {report.plays.length === 0 ? (
          <p className="text-ink-muted">No plays written.</p>
        ) : (
          <ol className="space-y-3">
            {report.plays.map((p, i) => (
              <li key={`${p.title}-${i}`} className="border-l-2 border-line pl-3">
                <p className="font-display font-bold text-ink-strong">
                  {p.title} <span className="font-sans text-micro font-medium uppercase tracking-[0.06em] text-ink-muted">{p.status}</span>
                </p>
                {p.thesis && <p className="mt-0.5 text-label leading-relaxed">{p.thesis}</p>}
                <p className="mt-1 text-micro text-ink-muted">
                  {p.next_step ? `Next: ${p.next_step}${p.next_step_due ? ` (by ${fmtDay(p.next_step_due)})` : ""}` : "No next step agreed"}
                  {p.owner ? ` · ${p.owner}` : ""}
                </p>
                {(p.deals.length > 0 || p.people.length > 0) && (
                  <p className="mt-0.5 text-micro text-ink-muted">
                    {p.deals.length > 0 ? `Deals: ${p.deals.join(", ")}` : ""}
                    {p.deals.length > 0 && p.people.length > 0 ? " · " : ""}
                    {p.people.length > 0 ? `People: ${p.people.join(", ")}` : ""}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </Block>

      <Block title="People">
        {report.contacts.length === 0 ? (
          <p className="text-ink-muted">Nobody on file.</p>
        ) : (
          <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {report.contacts.map((c, i) => (
              <li key={`${c.name}-${i}`}>
                <p className="font-semibold text-ink-strong">
                  {c.name} <span className="text-micro font-normal text-ink-muted">{ORG_LABEL[c.org] ?? c.org}</span>
                </p>
                <p className="text-micro text-ink-muted empty:hidden">{[c.title, c.email].filter(Boolean).join(" · ")}</p>
                {c.notes && <p className="mt-0.5 text-micro leading-relaxed text-ink-muted">{c.notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </Block>

      {report.install_base.rows.length > 0 && (
        <Block title="Install base" aside={report.install_base.as_of ? `as of ${fmtDay(report.install_base.as_of)}` : null}>
          <div className="overflow-x-auto">
            <table className="w-full text-label">
              <tbody>
                {report.install_base.rows.map((r, i) => (
                  <tr key={`${r.product_family}-${i}`} className="border-b border-line align-baseline">
                    <td className="py-1.5 pr-3 font-medium text-ink-strong">{r.product_family}</td>
                    <td className="py-1.5 pr-3 text-micro text-ink-muted">{r.role_note}</td>
                    <td className="whitespace-nowrap py-1.5 pr-3 text-right text-micro tabular-nums text-ink-muted">
                      {r.share_pct === null ? "" : `${r.share_pct}%`}
                    </td>
                    <td className="whitespace-nowrap py-1.5 text-right font-semibold tabular-nums text-ink-strong">{fmtMoney(r.value_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Block>
      )}

      {report.follow_ups.length > 0 && (
        <Block title="Open follow-ups" aside={`${report.follow_ups.length}`}>
          <ul className="space-y-1 text-label">
            {report.follow_ups.map((f, i) => (
              <li key={`${f.text}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
                <span>{f.text}</span>
                <span className="text-micro text-ink-muted empty:hidden">
                  {[f.owner, f.due ? `due ${fmtDay(f.due)}` : null].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {report.meetings.length > 0 && (
        <Block title="Recent meetings">
          <ul className="space-y-2 text-label">
            {report.meetings.map((m, i) => (
              <li key={`${m.title}-${i}`}>
                <p className="font-semibold text-ink-strong">
                  {m.title} <span className="text-micro font-normal tabular-nums text-ink-muted">{fmtDay(m.held_at)}</span>
                </p>
                {m.summary && <p className="mt-0.5 whitespace-pre-wrap text-micro leading-relaxed text-ink-muted">{m.summary}</p>}
              </li>
            ))}
          </ul>
        </Block>
      )}

      {report.research.length > 0 && (
        <Block title="What we know from outside">
          <div className="space-y-4">
            {report.research.map((n, i) => (
              <div key={`${n.title}-${i}`}>
                <p className="font-semibold text-ink-strong">{n.title}</p>
                <p className="mt-0.5 text-label leading-relaxed">{n.summary}</p>
                <ul className="mt-1 space-y-1 text-micro text-ink-muted">
                  {n.findings.map((f, j) => (
                    <li key={j}>
                      {f.text}
                      {f.url && (
                        // data-print-url prints the address after the text, so
                        // a source is still checkable on paper.
                        <>
                          {" "}
                          <a href={f.url} rel="noreferrer noopener nofollow" data-print-url className="text-accent underline">
                            source
                          </a>
                        </>
                      )}
                      <span className="ml-1 uppercase tracking-[0.06em]">{f.confidence}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Block>
      )}
    </>
  );
}
