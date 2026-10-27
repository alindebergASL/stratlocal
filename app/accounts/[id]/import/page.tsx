import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { todayISO } from "@/lib/clock";
import { getAccount } from "@/lib/queries/accounts";
import { providerProblem } from "@/lib/ai/client";
import { ROLES } from "@/lib/ai/models";
import { Page } from "@/components/Nav";
import { Breadcrumb, Callout, PageHeader, Section } from "@/components/ui";
import { ImportForm } from "./ImportForm";

export const dynamic = "force-dynamic";

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const account = getAccount(id);
  if (!account) notFound();
  const problem = providerProblem(ROLES.import.provider);

  return (
    <Page user={user}>
      <Breadcrumb accountId={id} accountName={account.name} page="Import" />
      <PageHeader title="Import a report" sub="A report from your sales tool, or a document from the customer." />
      <Section title="Upload">
        {problem ? (
          <Callout tone="warning">{problem}</Callout>
        ) : (
          <>
            <ImportForm accountId={id} today={todayISO()} />
            {/* The explanation is worth reading once and not on every import. */}
            <details className="mt-4 border-t border-line pt-3">
              <summary className="cursor-pointer text-label text-ink-muted hover:text-ink">What happens to the file</summary>
              <p className="mt-2 max-w-2xl text-label text-ink-muted">
                The report is read into structured facts — account details, the seller team, opportunities, install base, plays — and every difference from what
                this account already holds becomes a proposal for you to accept or reject one at a time. A deal id the report text does not actually contain is
                dropped before you see it. The original file is kept with the account, and uploading the same file twice brings the first one back rather than
                creating a second.
              </p>
            </details>
          </>
        )}
      </Section>
    </Page>
  );
}
