import { keptPeers } from "@/lib/research/peers";
import { Chip, Section } from "./ui";

// How organisations like this one are going about the same ground, from kept
// research: a peer is shown only while the finding it stands on is kept.
export function ResearchPeers({ accountId }: { accountId: string }) {
  const view = keptPeers(accountId);
  if (!view) return null;
  return (
    <Section id="peers" title="Peers and competitors" aside={<span className="tabular-nums">as of {view.asOf.slice(0, 10)}</span>}>
      {view.summary && <p className="max-w-3xl text-body text-ink" data-testid="peers-summary">{view.summary}</p>}
      <ul className="mt-3 divide-y divide-line" data-testid="peers-list">
        {view.peers.map((p) => (
          <li key={`${p.noteId}-${p.finding}-${p.name}`} className="py-2.5" data-testid="peer">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-semibold text-ink-strong">{p.name}</span>
              <Chip tone={p.kind === "competitor" ? "warning" : "neutral"}>{p.kind}</Chip>
            </div>
            <p className="mt-1 max-w-3xl text-label text-ink">{p.doing}</p>
            <a href={p.href} className="mt-1 inline-flex min-h-11 items-center text-micro font-semibold text-accent hover:underline sm:min-h-0">
              Read the finding →
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-micro text-ink-muted">From public sources only, kept after review; not independently verified.</p>
    </Section>
  );
}
