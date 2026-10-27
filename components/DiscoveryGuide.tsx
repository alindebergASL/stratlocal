import { MEDDPICC_LABELS } from "@/lib/playbook/schema";
import type { DiscoveryGuide } from "@/lib/playbook/discovery";

// The playbook's questions for one meeting, by movement, each with the
// qualification element it uncovers and why it was chosen.
export function DiscoveryGuideView({ guide }: { guide: DiscoveryGuide }) {
  return (
    <div className="space-y-4" data-testid="discovery-guide">
      {guide.map((g) => (
        <div key={g.movement.id ?? "other"} className="break-inside-avoid">
          <h3 className="text-label font-semibold text-ink-strong">{g.movement.name}</h3>
          {g.movement.purpose && <p className="text-micro text-ink-muted">{g.movement.purpose}</p>}
          <ol className="mt-1.5 space-y-2">
            {g.questions.map((q) => (
              <li key={q.id} className="text-body text-ink" data-testid="discovery-question">
                <span>{q.text}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-micro text-ink-muted">
                  {q.meddpicc && (
                    <abbr title={MEDDPICC_LABELS[q.meddpicc]} className="rounded bg-surface-sunk px-1.5 py-px font-semibold text-ink no-underline" data-testid="discovery-meddpicc">
                      {q.meddpicc}
                    </abbr>
                  )}
                  {q.why.length > 0 && <span>{q.why.join(" · ")}</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
