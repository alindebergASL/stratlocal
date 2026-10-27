import { MEDDPICC_LABELS, type Playbook } from "@/lib/playbook/schema";

// The whole playbook, read at a glance: the story, who does what, the steps,
// the archetypes, the discovery questions by movement with their MEDDPICC
// element, the workshop and the placement rubric.
export function PlaybookView({ playbook }: { playbook: Playbook }) {
  const role = (id: string | null) => playbook.roles.find((r) => r.id === id)?.name ?? null;
  const H = ({ children }: { children: React.ReactNode }) => <h3 className="mt-5 text-micro font-semibold uppercase tracking-[0.06em] text-ink-muted">{children}</h3>;
  return (
    <div className="min-w-0 max-w-full text-label" data-testid="playbook-view">
      <h2 className="font-display text-heading font-bold text-ink-strong">{playbook.name}</h2>
      {playbook.summary && <p className="mt-1 whitespace-pre-wrap text-ink">{playbook.summary}</p>}

      {playbook.roles.length > 0 && (
        <>
          <H>Who does what</H>
          <ul className="mt-1 divide-y divide-line">
            {playbook.roles.map((r) => (
              <li key={r.id} className="py-1.5">
                <span className="font-semibold text-ink-strong">{r.name}</span>
                {r.responsibilities && <span className="text-ink"> · {r.responsibilities}</span>}
                {r.owns && <span className="block text-micro text-ink-muted">In meetings: {r.owns}</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      {playbook.steps.length > 0 && (
        <>
          <H>The steps</H>
          <ol className="mt-1 space-y-2" data-testid="playbook-steps">
            {playbook.steps.map((s, i) => (
              <li key={s.id} className="rounded-lg border border-line p-3">
                <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-semibold text-ink-strong">
                    {i + 1}. {s.name}
                  </span>
                  <span className="text-micro text-ink-muted">{[s.timebox, role(s.owner_role)].filter(Boolean).join(" · ")}</span>
                </p>
                {s.detail && <p className="mt-0.5 text-ink">{s.detail}</p>}
                {s.output && <p className="mt-0.5 text-micro text-ink-muted">Produces: {s.output}</p>}
                {s.checklist.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-micro text-ink">
                    {s.checklist.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </>
      )}

      {playbook.archetypes.length > 0 && (
        <>
          <H>Archetypes</H>
          {/* Cards on a phone; a table where there is room to compare. */}
          <ul className="mt-1 space-y-2 sm:hidden">
            {playbook.archetypes.map((a) => (
              <li key={a.id} className="rounded-lg border border-line p-3">
                <p className="font-semibold text-ink-strong">{a.name}</p>
                {a.posture && <p className="text-ink">{a.posture}</p>}
                {a.pain && <p className="mt-0.5 text-micro text-ink-muted">Pain: {a.pain}</p>}
                {a.entry_point && <p className="mt-0.5 text-micro text-ink">Start with: {a.entry_point}</p>}
              </li>
            ))}
          </ul>
          <div className="mt-1 hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[36rem] text-left text-label" data-testid="playbook-archetypes">
              <thead className="text-micro text-ink-muted">
                <tr>
                  <th className="py-1 pr-3 font-semibold">Archetype</th>
                  <th className="py-1 pr-3 font-semibold">Posture</th>
                  <th className="py-1 pr-3 font-semibold">Pain</th>
                  <th className="py-1 font-semibold">Where to start</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line align-top">
                {playbook.archetypes.map((a) => (
                  <tr key={a.id}>
                    <td className="py-1.5 pr-3 font-semibold text-ink-strong">{a.name}</td>
                    <td className="py-1.5 pr-3 text-ink">{a.posture}</td>
                    <td className="py-1.5 pr-3 text-ink">{a.pain}</td>
                    <td className="py-1.5 text-ink">{a.entry_point}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {playbook.questions.length > 0 && (
        <>
          <H>Discovery questions</H>
          {[...playbook.movements, { id: "__none", name: "Other questions", purpose: "" }].map((m) => {
            const qs = playbook.questions.filter((q) => (q.movement_id ?? "__none") === m.id);
            if (qs.length === 0) return null;
            return (
              <div key={m.id} className="mt-2">
                <p className="font-semibold text-ink-strong">{m.name}</p>
                {m.purpose && <p className="text-micro text-ink-muted">{m.purpose}</p>}
                <ul className="mt-1 space-y-1" data-testid="playbook-questions">
                  {qs.map((q) => (
                    <li key={q.id} className="flex gap-2">
                      {q.meddpicc ? (
                        <span title={MEDDPICC_LABELS[q.meddpicc]} className="mt-0.5 h-fit shrink-0 rounded bg-accent-soft px-1.5 text-micro font-semibold text-accent">
                          {q.meddpicc}
                        </span>
                      ) : (
                        <span className="w-6 shrink-0" />
                      )}
                      <span className="text-ink">
                        {q.text}
                        {q.personas.length > 0 && <span className="text-micro text-ink-muted"> · for {q.personas.join(", ")}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </>
      )}

      {playbook.workshop.length > 0 && (
        <>
          <H>Workshop · {playbook.workshop.reduce((n, s) => n + s.minutes, 0)} minutes</H>
          <ol className="mt-1 divide-y divide-line">
            {playbook.workshop.map((s) => (
              <li key={s.id} className="flex flex-wrap justify-between gap-x-3 py-1.5">
                <span>
                  <span className="font-semibold text-ink-strong">{s.name}</span>
                  {s.focus && <span className="text-ink"> · {s.focus}</span>}
                </span>
                <span className="text-micro tabular-nums text-ink-muted">{[`${s.minutes} min`, role(s.lead_role)].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ol>
        </>
      )}

      {playbook.placement && (
        <>
          <H>Where a workload should run</H>
          <div className="mt-1 max-w-full overflow-x-auto">
            <table className="w-full min-w-[30rem] text-left text-label" data-testid="playbook-placement">
              <thead className="text-micro text-ink-muted">
                <tr>
                  <th className="py-1 pr-3 font-semibold">What decides it (weight)</th>
                  {playbook.placement.options.map((o) => (
                    <th key={o.id} className="py-1 pr-3 text-center font-semibold">
                      {o.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {playbook.placement.criteria.map((c) => (
                  <tr key={c.id}>
                    <td className="py-1.5 pr-3 text-ink">
                      {c.name} <span className="text-micro text-ink-muted">×{c.weight}</span>
                    </td>
                    {playbook.placement!.options.map((o) => (
                      <td key={o.id} className="py-1.5 pr-3 text-center tabular-nums text-ink">
                        {c.scores[o.id] ? (c.scores[o.id]! > 0 ? `+${c.scores[o.id]}` : c.scores[o.id]) : "0"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {playbook.budget_hints && (
        <>
          <H>Budget calendar</H>
          <p className="mt-1 whitespace-pre-wrap text-ink">{playbook.budget_hints}</p>
        </>
      )}
    </div>
  );
}
