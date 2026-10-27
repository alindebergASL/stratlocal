import Link from "next/link";
import { listCustomerDocs } from "@/lib/documents/customer";
import { fmtWhen } from "@/lib/format";
import { archiveDocumentRecord } from "@/app/actions";
import { ArchiveButton } from "./ArchiveButton";
import { Empty, Section } from "./ui";

// What the customer gave the team, beside what the public web says. Read by
// briefs, the plan draft and Ask; never sent to web research.
export function CustomerDocuments({ accountId }: { accountId: string }) {
  const docs = listCustomerDocs(accountId);
  return (
    <Section
      id="documents"
      title="Their documents"
      aside={
        <Link href={`/accounts/${accountId}/import`} className="font-semibold text-accent hover:underline" data-testid="customer-doc-add">
          Add a document
        </Link>
      }
    >
      {docs.length === 0 ? (
        <Empty>Their plan, a budget, an RFP or notes they sent: upload it and briefs, the plan draft and Ask read it with the account&rsquo;s records. It is never sent to web research.</Empty>
      ) : (
        <ul className="divide-y divide-line" data-testid="customer-docs">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <Link href={`/accounts/${accountId}/documents/${d.id}`} className="truncate font-medium text-ink hover:text-accent" data-testid="customer-doc">
                  {d.filename}
                </Link>
                <span className="text-micro tabular-nums text-ink-muted">{fmtWhen(d.created_at)}</span>
              </span>
              <ArchiveButton what={d.filename} action={archiveDocumentRecord.bind(null, d.id)} size="sm" />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
