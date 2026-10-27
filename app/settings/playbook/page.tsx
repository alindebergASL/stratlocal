import { listUsers, requirePageUser } from "@/lib/auth";
import { currentPlaybook, listPlaybooks, playbookHistory } from "@/lib/playbook/store";
import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { fmtWhen } from "@/lib/format";
import { Page } from "@/components/Nav";
import { Field, PageHeader, Section, control } from "@/components/ui";
import { ResultButton } from "@/components/ResultButton";
import { PlaybookView } from "@/components/PlaybookView";
import { createPlaybookAction, restorePlaybookAction, setDefaultPlaybookAction, startFromStarterAction } from "./actions";
import { PlaybookImport } from "./PlaybookImport";
import { PlaybookEditor } from "./PlaybookEditor";
import { playbookDiff } from "@/lib/playbook/diff";
import { playbookHealth } from "@/lib/playbook/lifecycle";
import { MIN_FOR_RATE, playbookOutcomes } from "@/lib/playbook/outcomes";
import { fmtMoneyShort } from "@/lib/format";

export const dynamic = "force-dynamic";

// The team's sales playbook: the steps an account goes through, the
// archetypes, the discovery questions and the workshop. It is the team's own,
// kept here and never in the code (lib/playbook/schema.ts).
export default async function PlaybookPage({ searchParams }: { searchParams?: Promise<{ edit?: string; pb?: string }> } = {}) {
  const sp = (await searchParams) ?? {};
  const editing = sp.edit === "1";
  const user = await requirePageUser();
  const playbooks = listPlaybooks();
  const current = currentPlaybook({ slug: sp.pb && playbooks.some((p) => p.slug === sp.pb) ? sp.pb : null });
  const shown = playbooks.find((p) => p.slug === current?.slug) ?? null;
  const here = (extra: Record<string, string> = {}) => {
    const q = new URLSearchParams({ ...(shown && !shown.isDefault ? { pb: shown.slug } : {}), ...extra });
    return `/settings/playbook${q.size ? `?${q}` : ""}`;
  };
  const history = current ? playbookHistory(15, current.slug) : [];
  const names = new Map(listUsers({ includeInactive: true }).map((u) => [u.id, u.display_name]));
  const who = (id: string | null) => (id ? (names.get(id) ?? "someone") : "—");
  const health = current && !editing ? playbookHealth(current.playbook, Date.now(), current.slug) : [];
  const onSteps = health.reduce((n, h) => n + h.accounts, 0);
  const outcomes = current && !editing ? playbookOutcomes(current.playbook, current.slug) : [];

  return (
    <Page user={user} main="max-w-4xl">
      <PageHeader
        title="Playbook"
        sub="How the team runs an account, step by step. Every account's Playbook tab, meeting prep and qualification read it."
        actions={<a href="/settings/salesforce" className="text-label font-semibold text-accent hover:underline">Salesforce →</a>}
      />
      {playbooks.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="playbook-switcher">
          {playbooks.length > 1 && (
            <nav aria-label="Playbooks" className="flex flex-wrap items-center gap-1.5 text-label">
              {playbooks.map((p) => (
                <Link key={p.slug} href={p.isDefault ? "/settings/playbook" : `/settings/playbook?pb=${p.slug}`} aria-current={p.slug === current?.slug ? "page" : undefined} className={`rounded-full px-2.5 py-0.5 ring-1 ${p.slug === current?.slug ? "bg-accent-soft font-semibold text-ink ring-accent-line" : "text-ink-muted ring-line hover:text-ink"}`}>
                  {p.name}
                  <span className="ml-1 text-micro text-ink-muted">{p.isDefault ? "default · " : ""}{p.accounts} account{p.accounts === 1 ? "" : "s"}</span>
                </Link>
              ))}
            </nav>
          )}
          <ActionForm action={createPlaybookAction.bind(null, current?.slug ?? null)} trigger="New playbook" submitLabel="Create" testId="playbook-new">
            <Field label="Name" wide>
              <input name="name" required maxLength={120} className={control} />
            </Field>
            <Field label="Start from">
              <select name="from" defaultValue="copy" className={control}>
                <option value="copy">A copy of {current?.playbook.name ?? "this one"}</option>
                <option value="starter">The neutral starter</option>
              </select>
            </Field>
          </ActionForm>
          {shown && !shown.isDefault && (
            <ResultButton run={setDefaultPlaybookAction.bind(null, shown.slug)} testId="playbook-make-default">Make it the default</ResultButton>
          )}
        </div>
      )}
      <Section title={playbooks.length > 1 ? (shown?.isDefault ? "The default playbook" : "This playbook") : "Current playbook"} aside={current ? <span>Changed {fmtWhen(current.createdAt)} by {who(current.createdBy)}</span> : <span>None yet</span>}>
        {current ? (
          editing ? (
            <>
              <a href={here()} className="mb-3 inline-block text-label text-accent hover:underline">
                ← Back to reading it
              </a>
              <PlaybookEditor initial={current.playbook} basisId={current.id} slug={shown && !shown.isDefault ? shown.slug : null} />
            </>
          ) : (
            <>
              <a href={here({ edit: "1" })} className="mb-3 inline-flex min-h-11 items-center text-label font-semibold text-accent hover:underline sm:min-h-0" data-testid="playbook-edit-open">
                Edit the playbook →
              </a>
              <PlaybookView playbook={current.playbook} />
            </>
          )
        ) : (
          <div className="space-y-3 text-label" data-testid="playbook-empty">
            <p className="text-ink">
              No playbook yet. Start from a neutral one and make it yours, or import the team&rsquo;s own document. Either way it is kept here, in this app&rsquo;s
              database, and nowhere else.
            </p>
            <ResultButton run={startFromStarterAction.bind(null, null)} variant="primary" testId="playbook-use-starter">
              Start from the neutral starter
            </ResultButton>
          </div>
        )}
      </Section>
      {onSteps > 0 && (
        <Section title="Where accounts are" aside={<span>{onSteps} account{onSteps === 1 ? "" : "s"} on a step</span>}>
          <ol className="divide-y divide-line text-label" data-testid="playbook-health">
            {health.map((h, i) => (
              <li key={h.step.id} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="mr-2 tabular-nums text-ink-muted">{i + 1}</span>
                  <span className={h.accounts ? "font-semibold text-ink" : "text-ink-muted"}>{h.step.name}</span>
                </span>
                <span className="shrink-0 tabular-nums text-ink-muted">
                  {h.accounts ? `${h.accounts} · ${h.medianDays === 0 ? "under a day" : `${h.medianDays} day${h.medianDays === 1 ? "" : "s"}`} typical` : "—"}
                </span>
              </li>
            ))}
          </ol>
        </Section>
      )}
      {outcomes.length > 0 && (
        <Section title="How the playbook is doing" aside={<span>deals closed in the last year</span>}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-label" data-testid="playbook-outcomes">
              <thead className="text-micro uppercase tracking-[0.06em] text-ink-muted">
                <tr className="text-left">
                  <th className="py-1.5 pr-3 font-medium">Archetype when it closed</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Won</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Lost</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Win rate</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Typical cycle</th>
                  <th className="py-1.5 font-medium">Usually reached</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {outcomes.map((o) => (
                  <tr key={o.archetypeId ?? "none"} data-testid="playbook-outcome" data-archetype={o.archetypeId ?? ""}>
                    <td className="py-2 pr-3">
                      <span className={o.archetypeId ? "font-semibold text-ink" : "text-ink-muted"}>{o.name}</span>
                      {o.entryPoint && <span className="block max-w-xs truncate text-micro text-ink-muted">{o.entryPoint}</span>}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{o.won}{o.wonUsd ? <span className="block text-micro text-ink-muted">{fmtMoneyShort(o.wonUsd)}</span> : null}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{o.lost}{o.lostUsd ? <span className="block text-micro text-ink-muted">{fmtMoneyShort(o.lostUsd)}</span> : null}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{o.winRate === null ? <span className="text-ink-muted">—</span> : `${o.winRate}%`}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{o.medianCycleDays === null ? "—" : `${o.medianCycleDays} days`}</td>
                    <td className="py-2 text-ink">{o.typicalStep ?? <span className="text-ink-muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-micro text-ink-muted">A win rate shows once a group has {MIN_FOR_RATE} closed deals; below that the counts say more. Cycle is from when the deal was first on file to its close date.</p>
        </Section>
      )}
      <Section title={current ? "Import a new version" : "Import the team's playbook"}>
        <PlaybookImport slug={shown && !shown.isDefault ? shown.slug : null} />
      </Section>
      {history.length > 1 && (
        <Section title="Earlier versions">
          <ul className="divide-y divide-line text-label" data-testid="playbook-history">
            {history.slice(1).map((h, i) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span>
                  <span className="text-ink">{h.playbook.name}</span>
                  <span className="block text-micro text-ink-muted">
                    {fmtWhen(h.createdAt)} · {who(h.createdBy)}
                    {h.note ? ` · ${h.note}` : ""}
                  </span>
                  {/* What the next version changed from this one. */}
                  <span className="block text-micro text-ink" data-testid="playbook-history-diff">
                    Then: {playbookDiff(h.playbook, history[i]!.playbook).join("; ")}
                  </span>
                </span>
                <ResultButton run={restorePlaybookAction.bind(null, h.id, current?.id ?? null)} testId="playbook-restore">
                  Restore
                </ResultButton>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </Page>
  );
}
