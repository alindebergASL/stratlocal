import Link from "next/link";
import { findUserById, listTeam, requirePageUser } from "@/lib/auth";
import { branding } from "@/lib/team/branding";
import { MIN_PASSWORD } from "@/lib/team/members";
import { currentPlaybook } from "@/lib/playbook/store";
import { Page } from "@/components/Nav";
import { ActionForm } from "@/components/ActionForm";
import { ResultButton } from "@/components/ResultButton";
import { Field, PageHeader, Section, control } from "@/components/ui";
import { addMemberAction, applyPackAction, changePasswordAction, previewPackAction, saveBrandingAction, setActiveAction, setMemberAction } from "./actions";
import { PackLoader } from "./PackLoader";

export const dynamic = "force-dynamic";

// The team: who is on it and in what role, how the app is named and looks to
// it, and your own password. Admins change the team; anyone changes their
// own password.
export default async function TeamPage() {
  const user = await requirePageUser();
  const isAdmin = !!findUserById(user.id)?.is_admin;
  const team = listTeam();
  const brand = branding();
  const roles = [...(currentPlaybook()?.playbook.roles ?? []).map((r) => ({ id: r.id, name: r.name })), { id: "manager", name: "Manager" }];
  const roleName = (id: string | null) => roles.find((r) => r.id === id)?.name ?? (id ? id : "No role");
  const RoleSelect = ({ value }: { value: string | null }) => (
    <select name="role" defaultValue={value ?? ""} className={control}>
      <option value="">No role</option>
      {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
    </select>
  );
  return (
    <Page user={user} main="max-w-3xl">
      <PageHeader title="Team setup" sub="People, roles and the app's name." />

      <Section title="People" aside={<span>{team.filter((t) => t.active).length} active</span>}>
        <ul className="divide-y divide-line" data-testid="team-members">
          {team.map((m) => (
            <li key={m.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2.5" data-testid="team-member" data-active={m.active ? "true" : "false"}>
              <span className="min-w-0">
                {m.active ? (
                  <Link href={`/team/${m.id}`} className="font-semibold text-ink hover:text-accent hover:underline">{m.display_name}</Link>
                ) : (
                  <span className="font-semibold text-ink-muted line-through">{m.display_name}</span>
                )}
                {m.id === user.id && <span className="ml-1.5 text-micro text-ink-muted">you</span>}
                <span className="block text-micro text-ink-muted">
                  {m.email} · {roleName(m.role)}
                  {m.isAdmin ? " · admin" : ""}
                  {m.active ? "" : " · cannot sign in"}
                </span>
              </span>
              {isAdmin && (
                <span className="flex flex-wrap items-center gap-2">
                  <ActionForm action={setMemberAction.bind(null, m.id)} trigger="Edit" submitLabel="Save" testId={`team-edit-${m.email}`}>
                    <Field label="Name">
                      <input name="name" defaultValue={m.display_name} maxLength={80} className={control} />
                    </Field>
                    <Field label="Role">
                      <RoleSelect value={m.role} />
                    </Field>
                    <label className="flex basis-full items-center gap-2 text-label">
                      <input type="checkbox" name="is_admin" defaultChecked={m.isAdmin} className="size-4 accent-accent" /> Admin: can change the team
                    </label>
                  </ActionForm>
                  {m.id !== user.id && (
                    <ResultButton run={setActiveAction.bind(null, m.id, !m.active)} testId={`team-active-${m.email}`}>
                      {m.active ? "Turn off" : "Turn back on"}
                    </ResultButton>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
        {isAdmin && (
          <div className="mt-3">
            <ActionForm action={addMemberAction} trigger="Add someone" submitLabel="Add" testId="team-add">
              <Field label="Email">
                <input name="email" type="email" required className={control} />
              </Field>
              <Field label="Name">
                <input name="name" required maxLength={80} className={control} />
              </Field>
              <Field label="Role">
                <RoleSelect value={null} />
              </Field>
              <Field label={`First password (at least ${MIN_PASSWORD} characters)`} hint="Give it to them yourself; they change it here once signed in.">
                <input name="password" type="text" required minLength={MIN_PASSWORD} autoComplete="new-password" className={control} />
              </Field>
              <label className="flex basis-full items-center gap-2 text-label">
                <input type="checkbox" name="is_admin" className="size-4 accent-accent" /> Admin
              </label>
            </ActionForm>
          </div>
        )}
      </Section>

      <Section title="How the app looks to the team">
        <dl className="grid gap-x-4 gap-y-1 text-label sm:grid-cols-2" data-testid="team-branding">
          <dt className="text-ink-muted">App name</dt>
          <dd className="text-ink">{brand.appName}</dd>
          <dt className="text-ink-muted">Team name</dt>
          <dd className="text-ink">{brand.teamName ?? "—"}</dd>
          <dt className="text-ink-muted">Deck colour</dt>
          <dd className="flex items-center gap-2 text-ink">
            <span aria-hidden className="inline-block size-4 rounded" style={{ background: `#${brand.accent}` }} />#{brand.accent}
          </dd>
          <dt className="text-ink-muted">Logo</dt>
          <dd className="text-ink">{brand.logo ? "Set" : "None"}</dd>
        </dl>
        {isAdmin && (
          <div className="mt-3">
            <ActionForm action={saveBrandingAction} trigger="Change" submitLabel="Save" testId="team-brand">
              <Field label="App name">
                <input name="app_name" defaultValue={brand.appName} maxLength={40} className={control} />
              </Field>
              <Field label="Team name">
                <input name="team_name" defaultValue={brand.teamName ?? ""} maxLength={80} className={control} />
              </Field>
              <Field label="Deck colour">
                <input name="accent" type="color" defaultValue={`#${brand.accent}`} className="h-10 w-20 rounded border border-line" />
              </Field>
              <Field label="Logo (PNG, JPEG or SVG, small)">
                <input name="logo" type="file" accept="image/png,image/jpeg,image/svg+xml" className="w-full max-w-full text-label" />
              </Field>
              {brand.logo && (
                <label className="flex basis-full items-center gap-2 text-label">
                  <input type="checkbox" name="remove_logo" className="size-4 accent-accent" /> Remove the logo
                </label>
              )}
            </ActionForm>
          </div>
        )}
      </Section>

      <Section title="Team pack">
        <p className="text-label text-ink">
          Everything this team has set up that another team could start from: the playbook, team direction, saved report templates, assistant settings, the
          app&rsquo;s name and colour, and the Salesforce mapping. Never an account, a person or a credential.
        </p>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-label">
          <a href="/api/team-pack/export" download className="font-semibold text-accent hover:underline" data-testid="pack-export">Download this team&rsquo;s pack</a>
          <a href="/api/team-pack/export?starter=1" download className="font-semibold text-accent hover:underline" data-testid="pack-starter">Download the neutral starter</a>
        </p>
        {isAdmin && (
          <div className="mt-3">
            <PackLoader preview={previewPackAction} apply={applyPackAction} />
          </div>
        )}
      </Section>

      <Section title="Your password">
        <ActionForm action={changePasswordAction} trigger="Change your password" submitLabel="Change" testId="team-password">
          <Field label="Current password">
            <input name="current" type="password" required autoComplete="current-password" className={control} />
          </Field>
          <Field label={`New password (at least ${MIN_PASSWORD} characters)`}>
            <input name="next" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" className={control} />
          </Field>
        </ActionForm>
      </Section>
    </Page>
  );
}
