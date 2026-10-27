import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { getAccount, listContacts } from "@/lib/queries/accounts";
import type { ContactRow } from "@/lib/db";
import { CONTACT_ROLES, ROLE_LABELS } from "@/lib/tone";
import { Page } from "@/components/Nav";
import { AccountHeader } from "@/components/AccountHeader";
import { ActionForm } from "@/components/ActionForm";
import { ArchiveButton } from "@/components/ArchiveButton";
import { ExportCsv } from "@/components/ExportCsv";
import { control, Empty, Field, Section } from "@/components/ui";
import { archiveRecord, saveContact } from "@/app/actions";

export const dynamic = "force-dynamic";

// Their side first: who you know at the customer is the relationship map,
// and "nobody yet" there is itself the finding. Our own team is last.
const GROUPS: Array<{ org: string; label: string; empty: string }> = [
  { org: "customer", label: "Their side", empty: "Nobody on the customer side yet." },
  { org: "partner", label: "Partners", empty: "" },
  { org: "vendor", label: "Our team", empty: "" },
];

export default async function AccountPeoplePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const account = getAccount(id);
  if (!account) notFound();
  if (account.kind === "own_work") redirect("/follow-ups");
  const contacts = listContacts(id);

  return (
    <Page user={user}>
      <AccountHeader account={account} tab="people" />
      <Section
        id="people"
        title="People"
        aside={
          <>
            <span>{contacts.length}</span>
            <ExportCsv accountId={id} what="contacts" />
          </>
        }
      >
        {contacts.length === 0 ? (
          <Empty>
            Nobody applied yet.{" "}
            <Link href={`/accounts/${id}/research`} className="text-accent underline">
              Review suggested People updates from accepted research
            </Link>
            , import a report, or add someone below. Public job titles do not establish buying roles.
          </Empty>
        ) : (
          GROUPS.map((g) => {
            const rows = contacts.filter((c) => (c.org ?? "customer") === g.org);
            if (rows.length === 0 && !g.empty) return null;
            return (
              <div key={g.org} className="mb-5 last:mb-0" data-testid={`people-${g.org}`}>
                <h3 className="mb-2 text-micro font-semibold uppercase tracking-[0.06em] text-ink-muted">
                  {g.label} <span className="tabular-nums">· {rows.length}</span>
                </h3>
                {rows.length === 0 ? <Empty>{g.empty}</Empty> : <div className="grid gap-2 md:grid-cols-2">{rows.map((c) => <PersonCard key={c.id} accountId={id} c={c} />)}</div>}
              </div>
            );
          })
        )}
        <div className="mt-4">
          <ActionForm action={saveContact.bind(null, id, null)} testId="contact-new" trigger="Add person" submitLabel="Add person">
            <Field label="Name">
              <input name="name" required className={control} />
            </Field>
            <Field label="Title">
              <input name="title" className={control} />
            </Field>
            <Field label="Org">
              <select name="org" defaultValue="customer" className={control}>
                <option value="customer">Customer</option>
                <option value="vendor">Our team</option>
                <option value="partner">Partner</option>
              </select>
            </Field>
            <Field label="Role" hint="What they are to us. Their job title goes above.">
              <select name="role" defaultValue="" className={control}>
                <option value="">not set</option>
                {CONTACT_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r] ?? r}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Email">
              <input name="email" type="email" className={control} />
            </Field>
          </ActionForm>
        </div>
      </Section>
    </Page>
  );
}

// The edit form and the merge picker live on the person's own page, where
// they are the subject rather than one of twenty-five identical widgets.
function PersonCard({ accountId, c }: { accountId: string; c: ContactRow }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-line p-3">
      <div className="min-w-0">
        <Link href={`/accounts/${accountId}/contacts/${c.id}`} className="font-semibold text-ink-strong hover:text-accent hover:underline">
          {c.name}
        </Link>
        <div className="text-micro text-ink-muted">{[c.title, c.role ? (ROLE_LABELS[c.role] ?? c.role.replace("_", " ")) : null].filter(Boolean).join(" · ")}</div>
        {c.email && <div className="text-micro text-ink-muted [overflow-wrap:anywhere]">{c.email}</div>}
        {c.notes && <div className="mt-1 line-clamp-2 text-label text-ink">{c.notes}</div>}
      </div>
      <div className="flex items-center gap-3">
        <Link href={`/accounts/${accountId}/contacts/${c.id}`} className="text-micro font-semibold text-accent hover:underline">
          Open
        </Link>
        <ArchiveButton what={c.name} action={archiveRecord.bind(null, "contact", c.id)} />
      </div>
    </div>
  );
}
