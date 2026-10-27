import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { getAccount } from "@/lib/queries/accounts";
import { Page } from "@/components/Nav";
import { Breadcrumb, PageHeader, Section } from "@/components/ui";
import { SheetForm } from "./SheetForm";

export const dynamic = "force-dynamic";

export default async function ImportSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const account = getAccount(id);
  if (!account) notFound();

  return (
    <Page user={user}>
      <Breadcrumb accountId={id} accountName={account.name} page="Import a spreadsheet" />
      <PageHeader
        title="Import a spreadsheet"
        sub="A CSV of deals or people. You map the columns."
      />
      <Section title="Upload">
        <SheetForm accountId={id} />
        {/* Worth reading once, not on every import. */}
        <details className="mt-4 border-t border-line pt-3">
          <summary className="cursor-pointer text-label text-ink-muted hover:text-ink">How this differs from importing a report</summary>
          <div className="mt-2 max-w-2xl space-y-2 text-label text-ink-muted">
            <p>
              No model reads this file, and it costs nothing. A spreadsheet already has a header row, so the only judgement needed is which column is
              which — and that is yours, because a confident wrong guess would write a close date into the value column across the whole pipeline in one
              accept, with every review card looking individually reasonable.
            </p>
            <p>
              A deal row with a CRM id that is already here becomes an update, and only the fields that differ. A row with an id nobody has, or no id at
              all, becomes a new deal. A blank cell is never a change: it means the export did not carry that column, not that the field should be
              emptied, so an import cannot clear something you typed.
            </p>
            <p>
              A file of people is matched differently, because no export carries an id for a person: by email address first, and then by name. Anyone
              who matches somebody already here becomes an update of the fields that differ; anyone who does not becomes a new person, at the customer
              unless a column says otherwise. It is the same rule the people named on an imported report are matched by, so the two cannot disagree.
            </p>
            <p>
              Dates have to be unambiguous — <code>2030-01-01</code> or <code>11 Dec 2026</code>. A numeric date like 03/04/2026 is a different quarter
              depending on who pressed export, so a row carrying one is refused by name rather than read as a guess. Values may be written the way a
              seller writes them: <code>1000</code>, <code>$1K</code>, <code>250</code>.
            </p>
            <p>The file itself is kept with the account, and uploading the same one twice brings the first back rather than making a second.</p>
          </div>
        </details>
      </Section>
    </Page>
  );
}
