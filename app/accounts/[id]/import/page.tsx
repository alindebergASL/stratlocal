import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { todayISO } from "@/lib/clock";
import { getAccount } from "@/lib/queries/accounts";
import { providerProblem } from "@/lib/ai/client";
import { ROLES } from "@/lib/ai/models";
import { Page } from "@/components/Nav";
import { Breadcrumb, Callout, PageHeader, Section } from "@/components/ui";
import { ImportForm } from "./ImportForm";
import { localOnly } from "@/lib/localMode";

export const dynamic = "force-dynamic";

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const account = getAccount(id);
  if (!account) notFound();
  const problem = providerProblem(ROLES.import.provider);
  const local = localOnly();

  return (
    <Page user={user}>
      <Breadcrumb accountId={id} accountName={account.name} page="Import" />
      <PageHeader title="Import a report" sub={local ? "Bring research from MyAgent. Review JSON account changes or keep reference documents locally." : "A report from your sales tool, or a document from the customer."} />
      <Section title="Upload">
        {local ? <Callout tone="neutral">Cloud AI is off. Import a structured JSON export to propose changes, or keep a PDF, HTML or Markdown document as reference. No Bedrock account is needed.</Callout> : problem && (
          <Callout tone="warning">{problem} You can still upload and keep customer documents locally. Report extraction is unavailable.</Callout>
        )}
        <ImportForm accountId={id} today={todayISO()} reportAvailable={local || !problem} localImport={local} />
        <details className="mt-4 border-t border-line pt-3">
          <summary className="cursor-pointer text-label text-ink-muted hover:text-ink">What happens to the file</summary>
          <p className="mt-2 max-w-2xl text-label text-ink-muted">
            Customer documents are kept locally with this account. Uploading one does not start AI or propose account changes.
            When report extraction is available, account details, team, opportunities, install base and plays become proposals for you to review.
            Conflicting account names or CRM identifiers stop the import before any proposals are created.
            The original file is kept; uploading the same file again for the same account and purpose reuses it.
          </p>
        </details>
      </Section>
    </Page>
  );
}
