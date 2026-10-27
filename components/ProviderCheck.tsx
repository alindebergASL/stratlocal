"use client";

import { useState } from "react";
import { Button, Chip } from "./ui";
import type { ProviderCheck as Check } from "@/lib/ai/smoke";

// "Is it the model, the key, or the box?"
//
// Three different failures — a model id that is no longer available, a rotated
// key, an instance role the container cannot reach — all reach a screen as the
// same red line under whichever button was pressed. This asks both providers
// one seventy-token question and says which half is wrong, in the deployment,
// without an SSH session.
export function ProviderCheck() {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/providers/check", { method: "POST" });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? `The check returned ${res.status}`);
      else setChecks(body.checks as Check[]);
    } catch (e) {
      // A fetch that never lands is its own answer: the app is not reachable,
      // which is not something the providers can be blamed for.
      setError(e instanceof Error ? e.message : "The check could not be sent");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Button variant="quiet" size="sm" onClick={run} disabled={busy} aria-busy={busy} data-testid="provider-check">
        {busy ? "Asking…" : "Check providers"}
      </Button>

      <div role="status" aria-live="polite">
        {error && (
          <p className="mt-2 text-micro font-medium text-danger" role="alert">
            {error}
          </p>
        )}
        {checks && (
          <ul className="mt-2 space-y-1.5">
            {checks.map((c) => (
              <li key={c.provider} className="text-micro">
                <span className="flex flex-wrap items-baseline gap-2">
                  <Chip tone={c.status === "ok" ? "positive" : c.status === "failed" ? "danger" : "neutral"}>{c.status}</Chip>
                  <span className="font-medium text-ink">{c.label}</span>
                </span>
                <span className="mt-0.5 block break-words text-ink-muted">
                  {c.status === "ok" ? (
                    <>
                      {/* The model the provider reports, not the one we asked
                          for. An inference profile prefix or a dated id can
                          resolve to something else, and that difference is
                          exactly what the cost table then fails to price. */}
                      {c.servedModel ?? c.model} · {c.inputTokens}/{c.outputTokens} tokens · {c.ms}ms
                      {c.costCents === null ? " · no price configured for this model" : ` · ${c.estimated ? "about " : ""}$${((c.costCents ?? 0) / 100).toFixed(4)}`}
                    </>
                  ) : (
                    c.message
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
