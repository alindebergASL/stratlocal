"use client";

// Two clicks, no dialog. Archiving is reversible, so the confirmation only has
// to stop a misclick, not interrogate the user.
import { useState, useTransition } from "react";
import { Button } from "./ui";
import { attempt } from "./attempt";

type Result = { ok: true } | { ok: false; error: string };

export function ArchiveButton({
  action,
  mode = "archive",
  label,
  size = "sm",
  // What is being archived, for the accessible name. A page can carry ten of
  // these and every one of them announced itself as just "Archive".
  what,
}: {
  action: () => Promise<Result>;
  mode?: "archive" | "restore";
  label?: string;
  size?: "sm" | "md";
  what?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run() {
    start(async () => {
      setError(null);
      const r = await attempt(action);
      if (!r.ok) setError(r.error);
      setArmed(false);
    });
  }

  if (mode === "restore") {
    return (
      <span className="inline-flex items-center gap-2">
        <Button variant="quiet" size={size} onClick={run} disabled={pending} aria-busy={pending} aria-label={what ? `Restore ${what}` : undefined}>
          {pending ? "Restoring…" : (label ?? "Restore")}
        </Button>
        {error && (
          <span role="alert" className="text-micro font-medium text-danger">
            {error}
          </span>
        )}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      {armed ? (
        <>
          {/* Announced, because the button under the cursor has just changed
              its label to a destructive one. */}
          <span role="status" aria-live="polite" className="sr-only">
            Confirm to archive{what ? ` ${what}` : ""}
          </span>
          <Button variant="danger" size={size} onClick={run} disabled={pending} aria-busy={pending} aria-label={what ? `Confirm archiving ${what}` : undefined}>
            {pending ? "Archiving…" : "Confirm"}
          </Button>
          <Button variant="quiet" size={size} onClick={() => setArmed(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <Button variant="ghost" size={size} onClick={() => setArmed(true)} aria-label={what ? `Archive ${what}` : undefined}>
          {label ?? "Archive"}
        </Button>
      )}
      {error && (
        <span role="alert" className="text-micro font-medium text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
