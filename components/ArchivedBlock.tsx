import { ArchiveButton } from "./ArchiveButton";
import { Eyebrow } from "./ui";
import type { Archivable } from "@/lib/proposals/schema";

type Result = { ok: true } | { ok: false; error: string };

// A document is not an Archivable — it is not an entity and nothing can
// propose one — but it archives and restores, and this is where a person
// looks for anything they hid.
export type ArchivedKind = Archivable | "document";

export type ArchivedGroup = { kind: ArchivedKind; label: string; items: Array<{ id: string; label: string }> };

// Collapsed by default: this is where mistakes go to be recovered, not
// something to look at every day.
export function ArchivedBlock({
  groups,
  restore,
  title = "Archived",
}: {
  groups: ArchivedGroup[];
  restore: (kind: ArchivedKind, id: string) => Promise<Result>;
  title?: string;
}) {
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  if (total === 0) return null;
  return (
    <details className="mb-5 rounded-xl border border-line bg-surface px-4 py-3 sm:px-5">
      <summary className="cursor-pointer text-label font-semibold text-ink-muted hover:text-ink">
        {title} ({total})
      </summary>
      <div className="mt-3 space-y-3">
        {groups
          .filter((g) => g.items.length > 0)
          .map((group) => (
            <div key={group.kind}>
              <Eyebrow className="mb-1">{group.label}</Eyebrow>
              <ul className="divide-y divide-line text-label">
                {group.items.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-ink-muted">{item.label}</span>
                    <ArchiveButton mode="restore" what={item.label} action={restore.bind(null, group.kind, item.id)} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </div>
    </details>
  );
}
