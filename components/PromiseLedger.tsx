import { splitPromises } from "@/lib/promises";
import { fmtDay } from "@/lib/format";

type Item = { id: string; text: string; owner: string | null; ownerUserId: string | null; due: string | null };

// The meeting's open promises, both ways. What we owe is on someone's list
// already; what the customer owes is not, so it is spelled out by name. With
// nothing promised either way it says nothing at all.
export function PromiseLedger({ items, owners, customers = [], today }: { items: Item[]; owners: { id: string; name: string }[]; customers?: string[]; today: string }) {
  const { ours, theirs } = splitPromises(items, owners, customers);
  if (ours.length === 0 && theirs.length === 0) return null;
  const late = (d: string | null) => d != null && d < today;
  const ourLate = ours.filter((i) => late(i.due)).length;
  return (
    <div className="mb-5 min-w-0 rounded-xl bg-surface-sunk px-4 py-3" data-testid="promise-ledger">
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-label">
        <span className="text-ink">
          You owe them <strong className="text-ink-strong" data-testid="promise-ours">{ours.length}</strong>
          {ourLate > 0 && <span className="text-warning"> · {ourLate} late</span>}
        </span>
        <span aria-hidden className="text-ink-muted">·</span>
        <span className="text-ink">
          They owe you <strong className="text-ink-strong" data-testid="promise-theirs">{theirs.length}</strong>
        </span>
      </p>
      {theirs.length > 0 && (
        <ul className="mt-2 space-y-1 text-label text-ink">
          {theirs.slice(0, 3).map((i) => (
            <li key={i.id} className="truncate">
              <span className="font-medium text-ink-strong">{i.owner}</span> · {i.text}
              {i.due && <span className={late(i.due) ? "text-warning" : "text-ink-muted"}> · {late(i.due) ? "was due" : "by"} {fmtDay(i.due)}</span>}
            </li>
          ))}
          {theirs.length > 3 && <li className="text-micro text-ink-muted">and {theirs.length - 3} more below</li>}
        </ul>
      )}
    </div>
  );
}
