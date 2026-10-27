import Link from "next/link";
import type { AskThread } from "@/lib/ask/threads";
import { relativeDays } from "@/lib/format";
import { Empty } from "./ui";

// Kept conversations, newest first, with who started each: the two of you
// share them, as you share the accounts.
export function AskThreadList({ threads, names, showAccount = true, empty }: { threads: Array<AskThread & { accountName: string | null }>; names: Map<string, string>; showAccount?: boolean; empty: string }) {
  if (threads.length === 0) return <Empty>{empty}</Empty>;
  const now = Date.now();
  return (
    <ul className="divide-y divide-line" data-testid="ask-threads">
      {threads.map((t) => (
        <li key={t.id} className="py-2.5">
          <Link href={`/ask/${t.id}`} className="font-medium text-ink hover:text-accent [overflow-wrap:anywhere]">{t.title}</Link>
          <p className="mt-0.5 text-micro text-ink-muted">
            {showAccount && (t.accountName ? `${t.accountName} · ` : "All accounts · ")}
            {names.get(t.createdBy ?? "") ?? "someone"} · {relativeDays(t.updatedAt, now)}
          </p>
        </li>
      ))}
    </ul>
  );
}
