// One affordance, three lists. Nothing left this app as data before it
// except the printable one-pager, which is a document rather than a table.
export function ExportCsv({ accountId, what }: { accountId: string; what: "deals" | "contacts" | "follow-ups" }) {
  return (
    <a href={`/api/accounts/${accountId}/export/${what}`} className="text-micro font-semibold text-accent hover:underline" data-testid={`export-${what}`}>
      CSV
    </a>
  );
}
