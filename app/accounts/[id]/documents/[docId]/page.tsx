import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { getAccount, getDocument } from "@/lib/queries/accounts";
import { isCustomerDoc } from "@/lib/documents/customer";
import { fmtWhen } from "@/lib/format";
import { Page } from "@/components/Nav";
import { Breadcrumb, Callout, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

// A customer document as it was read: the text briefs, the plan draft and Ask
// see, and the original file to download.
export default async function CustomerDocumentPage({ params }: { params: Promise<{ id: string; docId: string }> }) {
  const user = await requirePageUser();
  const { id, docId } = await params;
  const account = getAccount(id);
  const doc = getDocument(docId);
  if (!account || !doc || doc.account_id !== id || !isCustomerDoc(doc)) notFound();
  const text = doc.content_text ?? "";

  return (
    <Page user={user}>
      <Breadcrumb accountId={id} accountName={account.name} section={{ label: "Research", href: `/accounts/${id}/research?view=documents` }} page={doc.filename} />
      <PageHeader title={doc.filename} sub={`Their document, added ${fmtWhen(doc.created_at)}. What follows is the text read from it.`} />
      {doc.archived_at && <Callout tone="warning" className="mb-4">Archived: no longer read by briefs, the plan draft or Ask.</Callout>}
      <p className="mb-3 text-label">
        <a href={`/api/documents/${doc.id}/original`} className="font-semibold text-accent hover:underline">
          Download the original
        </a>
      </p>
      <pre className="max-w-3xl whitespace-pre-wrap break-words rounded-lg border border-line bg-surface p-4 font-sans text-label text-ink" data-testid="customer-doc-text">
        {text || "No text could be read from this file."}
      </pre>
    </Page>
  );
}
