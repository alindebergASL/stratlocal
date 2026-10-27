import { listUsers, requirePageUser } from "@/lib/auth";
import { currentDirection, directionHistory, MAX_FOCUS_AREAS } from "@/lib/teamDirection";
import { fmtWhen } from "@/lib/format";
import { Page } from "@/components/Nav";
import { ActionForm } from "@/components/ActionForm";
import { control, Field, PageHeader, Section } from "@/components/ui";
import { saveDirectionAction } from "./actions";

export const dynamic = "force-dynamic";

// What the team is for, in its own words (lib/teamDirection.ts).
//
// Briefs and plan drafts read all of it; web research and Account watch read
// only the focus areas, because research runs outside AWS (DECISIONS #3).
// Nothing written here is ever treated as a fact about a customer.
export default async function DirectionPage() {
  const user = await requirePageUser();
  const current = currentDirection();
  const history = directionHistory(10);
  const names = new Map(listUsers({ includeInactive: true }).map((u) => [u.id, u.display_name]));
  const who = (id: string | null) => (id ? (names.get(id) ?? "one of you") : "—");

  return (
    <Page user={user} main="max-w-3xl">
      <PageHeader
        title="Team direction"
        sub="What the team sells and is trying to achieve. Briefs and plan drafts read all of it; research and Account watch read only the focus areas."
      />

      <Section title="Direction" aside={current ? <span>Last changed {fmtWhen(current.createdAt)} by {who(current.createdBy)}</span> : <span>Not written yet</span>}>
        {current ? (
          <dl className="mb-4 space-y-3 text-label" data-testid="direction-current">
            {current.focusAreas.length > 0 && (
              <div>
                <dt className="text-micro font-semibold text-ink-muted">What we sell</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {current.focusAreas.map((f) => (
                    <span key={f} className="rounded-full bg-accent-soft px-2.5 py-0.5 text-ink">{f}</span>
                  ))}
                </dd>
              </div>
            )}
            {(
              [
                ["Goals", current.goals],
                ["Signals that matter", current.signals],
                ["Steer away from", current.avoid],
              ] as const
            ).map(([label, value]) =>
              value ? (
                <div key={label}>
                  <dt className="text-micro font-semibold text-ink-muted">{label}</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-ink">{value}</dd>
                </div>
              ) : null,
            )}
          </dl>
        ) : (
          <p className="mb-4 text-label text-ink-muted">
            Nothing written yet, so briefs, plans and research work exactly as before: for a seller in general, not for this team.
          </p>
        )}

        <ActionForm action={saveDirectionAction} trigger={current ? "Edit direction" : "Write the team's direction"} submitLabel="Save direction" testId="direction-edit" open={!current}>
          <input type="hidden" name="basis_id" value={current?.id ?? ""} />
          <Field label="What we sell" hint={`One per line, up to ${MAX_FOCUS_AREAS}. The only part sent to web research.`} wide>
            <textarea name="focus_areas" rows={5} className={control} defaultValue={(current?.focusAreas ?? []).join("\n")} placeholder={"AI agents\nAI systems and infrastructure\nAI security\nObservability"} />
          </Field>
          <Field label="Goals" hint="What the team is trying to achieve this half or quarter. Never leaves AWS." wide>
            <textarea name="goals" rows={4} maxLength={2000} className={control} defaultValue={current?.goals ?? ""} />
          </Field>
          <Field label="Signals that matter" hint="What makes an account worth your time." wide>
            <textarea name="signals" rows={3} maxLength={2000} className={control} defaultValue={current?.signals ?? ""} />
          </Field>
          <Field label="Steer away from" hint="What you do not sell or chase." wide>
            <textarea name="avoid" rows={3} maxLength={2000} className={control} defaultValue={current?.avoid ?? ""} />
          </Field>
        </ActionForm>
      </Section>

      {history.length > 1 && (
        <Section title="Earlier versions">
          <ul className="divide-y divide-line text-label" data-testid="direction-history">
            {history.slice(1).map((h) => (
              <li key={h.id} className="py-2">
                <p className="text-micro text-ink-muted">
                  {fmtWhen(h.createdAt)} · {who(h.createdBy)}
                </p>
                <p className="text-ink">{h.focusAreas.length ? h.focusAreas.join(" · ") : "No focus areas"}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </Page>
  );
}
