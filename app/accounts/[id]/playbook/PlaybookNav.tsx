import Link from "next/link";

export type PlanView = "plays" | "playbook" | "workshop" | "roadmap";

// One Plan area per account (DECISIONS #105): the plays, the playbook's view
// of the account, the workshop and the roadmap, as tabs of the account's Plan
// tab, with the printable plan one link away. Each keeps its own address.
export function PlanTabs({ accountId, current, playbook = true }: { accountId: string; current: PlanView; playbook?: boolean }) {
  const base = `/accounts/${accountId}`;
  const items: Array<{ key: PlanView; label: string; href: string }> = [
    { key: "plays", label: "Plays", href: `${base}/plays` },
    ...(playbook
      ? ([
          { key: "playbook", label: "Playbook", href: `${base}/playbook` },
          { key: "workshop", label: "Workshop", href: `${base}/playbook/workshop` },
          { key: "roadmap", label: "Roadmap", href: `${base}/playbook/roadmap` },
        ] as const)
      : []),
  ];
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <nav aria-label="Plan" className="flex flex-wrap gap-1 text-label" data-testid="plan-tabs">
        {items.map((i) => (
          <Link
            key={i.key}
            href={i.href}
            aria-current={i.key === current ? "page" : undefined}
            data-testid={`plan-tab-${i.key}`}
            className={`inline-flex min-h-9 items-center rounded-md px-2.5 ${i.key === current ? "bg-accent-soft font-semibold text-accent" : "text-ink-muted hover:bg-surface-sunk hover:text-ink"}`}
          >
            {i.label}
          </Link>
        ))}
      </nav>
      <Link href={`${base}/plan`} className="text-label font-semibold text-accent hover:underline" data-testid="plan-page-link">Read as a document →</Link>
    </div>
  );
}

/** @deprecated The playbook's own tabs are now the Plan area's (PlanTabs). */
export function PlaybookNav({ accountId, current }: { accountId: string; current: "status" | "workshop" | "roadmap" }) {
  return <PlanTabs accountId={accountId} current={current === "status" ? "playbook" : current} />;
}
