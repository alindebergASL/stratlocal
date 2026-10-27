"use client";

// Starts a background AI run and watches it. The run row is the only state,
// so a reload while it works loses nothing.
import { fmtCostNote } from "@/lib/format";
import { Button, type ButtonVariant } from "./ui";
import { useAiRun } from "./useAiRun";
import type { InitialRun } from "@/lib/ai/runState";

// A server component cannot hand a function across the boundary, so the
// caller names the shape of the result and the formatting happens here.
export type RunKind = "extract" | "brief" | "plan_draft" | "recap" | "handoff" | "reads";

function describe(kind: RunKind | undefined, result: unknown): string {
  if (kind === "extract") {
    const r = result as { proposals?: number; dropped?: string[] } | null;
    const n = r?.proposals ?? 0;
    const dropped = r?.dropped?.length ?? 0;
    return `${n} proposed change${n === 1 ? "" : "s"}${dropped > 0 ? `, ${dropped} item${dropped === 1 ? "" : "s"} ignored for lacking support in the notes` : ""}`;
  }
  if (kind === "brief") {
    const r = result as { claims?: number } | null;
    return `${r?.claims ?? 0} line${r?.claims === 1 ? "" : "s"}`;
  }
  if (kind === "plan_draft") {
    const r = result as { proposals?: number; superseded?: number } | null;
    const n = r?.proposals ?? 0;
    const gone = r?.superseded ?? 0;
    return `${n} proposed change${n === 1 ? "" : "s"}${gone > 0 ? `, replacing ${gone} from an earlier draft` : ""}`;
  }
  if (kind === "reads") {
    const r = result as { read?: number; signals?: number; remaining?: number } | null;
    return `${r?.read ?? 0} finding${r?.read === 1 ? "" : "s"} read, ${r?.signals ?? 0} reason${r?.signals === 1 ? "" : "s"} to act${r?.remaining ? `, ${r.remaining} left for another pass` : ""}`;
  }
  if (kind === "recap") return "Drafted from the notes as they are now";
  if (kind === "handoff") return "Drafted from the records as they are now";
  return "Done";
}

export function RunButton({
  url,
  label,
  busyLabel,
  kind,
  disabledReason,
  tone = "primary",
  initialRun,
  confirm,
  body,
}: {
  url: string;
  label: string;
  busyLabel: string;
  kind?: RunKind;
  disabledReason?: string | null;
  tone?: "primary" | "quiet";
  initialRun?: InitialRun | null;
  confirm?: string;
  body?: Record<string, unknown>;
}) {
  const { start, state, error, busy } = useAiRun(initialRun);
  const variant: ButtonVariant = tone === "primary" ? "primary" : "quiet";

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant={variant}
        onClick={() => { if (!confirm || window.confirm(confirm)) void start(url, body); }}
        disabled={busy || !!disabledReason}
        aria-busy={busy}
        title={disabledReason ?? undefined}
      >
        {busy ? busyLabel : label}
      </Button>
      <div role="status" aria-live="polite" className="flex flex-col items-start gap-1 empty:hidden">
        {busy && kind === "brief" && <span className="text-micro text-ink-muted">Preparing from saved research and tasks. You can leave this page; progress is saved.</span>}
        {disabledReason && <span className="text-micro text-ink-muted">{disabledReason}</span>}
        {error && <span className="text-micro font-medium text-danger">{error}</span>}
        {state?.status === "failed" && <span className="max-w-md text-micro font-medium text-danger">{state.error}</span>}
        {state?.status === "done" && (
          <span className="text-micro font-medium text-positive">
            {describe(kind, state.result)}
            {fmtCostNote(state.cost_cents, state.cost_estimated)}
          </span>
        )}
      </div>
    </div>
  );
}
