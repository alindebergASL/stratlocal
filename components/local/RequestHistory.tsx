import Link from "next/link";
import { fmtWhen } from "@/lib/format";
import { requestHistory } from "@/lib/local/requests";

export function RequestHistory({ accountId, userId, page = 1, compact = false }: {
  accountId: string;
  userId: string;
  page?: number;
  compact?: boolean;
}) {
  const history = requestHistory(accountId, userId, page, compact ? 5 : 20);
  const base = `/accounts/${accountId}/requests`;
  return (
    <section className="rounded-lg border border-line bg-surface p-5 space-y-3" id="saved-requests">
      <h2 className="text-lead font-semibold">Saved MyAgent requests</h2>
      <p>Your prepared requests for this account. Reopen a request to copy it or download the original prompt and selected files. Delivery to MyAgent happens outside this app.</p>
      {history.rows.length === 0 ? <p>No saved requests yet. <Link className="underline" href={`/accounts/${accountId}/evidence#new-account-intake`}>Prepare a MyAgent request</Link> to start.</p> : <>
        <p className="text-label">{compact ? `${history.rows.length} most recent of ${history.total}` : `Page ${history.page} of ${history.pages} · ${history.total} saved requests`}</p>
        <ul className="space-y-4">
          {history.rows.map(r => (
            <li className="border-t border-line pt-3 space-y-2" key={r.id}>
              <Link className="underline font-semibold" href={`/requests/${r.id}`}>{(r.prompt.split("\n", 1)[0] ?? "").replace(/^#+\s*/, "").slice(0, 180) || "MyAgent request"}</Link>
              <p className="text-label">Prepared {fmtWhen(r.created_at)}</p>
              <details>
                <summary className="cursor-pointer">Preview prompt</summary>
                <pre className="whitespace-pre-wrap break-words text-label mt-2">{r.prompt.slice(0, 1000)}{r.prompt.length > 1000 ? "\n… Open the saved request to read the full prompt." : ""}</pre>
              </details>
              <div className="flex flex-wrap gap-4 text-label">
                <a className="underline" href={`/api/local/files/${r.id}?format=markdown`}>Download prompt (.md)</a>
                <Link className="underline" href={`/requests/${r.id}`}>Open saved request</Link>
              </div>
            </li>
          ))}
        </ul>
      </>}
      {compact && history.total > 5 && <Link className="underline" href={base}>View all saved requests</Link>}
      {!compact && history.pages > 1 && <nav aria-label="Request history pages" className="flex gap-4">
        {history.page > 1 && <Link className="underline" href={`${base}?page=${history.page - 1}`}>Newer requests</Link>}
        {history.page < history.pages && <Link className="underline" href={`${base}?page=${history.page + 1}`}>Older requests</Link>}
      </nav>}
    </section>
  );
}
