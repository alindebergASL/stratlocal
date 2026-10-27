"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
type Choice = { id: string; text: string; asOf: string };
export function ResolveResearch({ noteId, findings, choices }: { noteId: string; findings: { index: number; text: string }[]; choices: Choice[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [obsolete, setObsolete] = useState("");
  const [support, setSupport] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  // Separate from `error`: one is the server refusing and saying so, the other
  // is not knowing what it did. Only the second one locks the button.
  const [unknown, setUnknown] = useState("");
  return (
    <details className="my-3 rounded border border-line p-3" data-testid="resolve-research">
      <summary className="cursor-pointer font-semibold">Resolve an outdated finding or conflicting claim</summary>
      <p className="my-2 text-micro text-ink-muted">
        Explicitly supersede one retained finding using another. Both original statements and your reason remain in history. This does not verify either claim or undo applied
        account records.
      </p>
      <label className="my-2 block text-label">
        Finding to supersede
        <select aria-label="Finding to supersede" value={obsolete} onChange={(e) => setObsolete(e.target.value)} className="mt-1 w-full rounded border border-line bg-surface p-2">
          <option value="">Choose a finding</option>
          {findings.map((f) => (
            <option key={f.index} value={String(f.index)}>
              {f.text.slice(0, 160)}
            </option>
          ))}
        </select>
      </label>
      <label className="my-2 block text-label">
        Supporting retained evidence
        <select
          aria-label="Supporting retained evidence"
          value={support}
          onChange={(e) => setSupport(e.target.value)}
          className="mt-1 w-full rounded border border-line bg-surface p-2"
        >
          <option value="">Choose support</option>
          {choices
            .filter((c) => c.id !== `${noteId}#${obsolete}`)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.asOf} · {c.text.slice(0, 160)}
              </option>
            ))}
        </select>
      </label>
      <label className="my-2 block text-label">
        Reason
        <textarea
          aria-label="Resolution reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={1000}
          className="mt-1 w-full rounded border border-line bg-surface p-2"
        />
      </label>
      <Button
        data-testid="resolve-submit"
        disabled={pending || !!unknown || obsolete === "" || !support || !reason.trim()}
        onClick={() => {
          setError("");
          const uncertain = (why: string) =>
            setUnknown(
              `${why} Whether this resolution was recorded is not known from here, and it may have been. What you typed is still here. Recording is locked until you reload this page and see what was saved.`,
            );
          start(async () => {
            // A refusal and a lost reply were the same message here, and both
            // read as "nothing happened". What is typed stays typed either
            // way — the fields are only cleared once a resolution is known to
            // have been recorded.
            let r: Response;
            try {
              r = await fetch(`/api/research-notes/${noteId}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  action: "resolve",
                  obsoleteIndex: Number(obsolete),
                  supportingIds: [support],
                  reason,
                }),
              });
            } catch {
              uncertain("The reply never arrived.");
              return;
            }
            const b = (await r.json().catch(() => null)) as { status?: unknown; error?: unknown } | null;
            if (!r.ok) {
              const message = typeof b?.error === "string" ? b.error.trim() : "";
              // A 5xx or a gateway timeout can follow a resolution the server
              // has already written; only an explained 4xx is a refusal.
              if (r.status >= 500 || r.status === 408 || !message) {
                uncertain(`The server answered ${r.status} without saying what it did.`);
                return;
              }
              setError(`${message} Nothing was recorded; what you typed is unchanged. You can record it again.`);
              return;
            }
            // The route answers `{ status: "resolved" }`. Anything else — an
            // empty body, a status from elsewhere — is not a confirmation,
            // and the typed reason must survive it.
            if (b?.status !== "resolved") {
              uncertain("The server answered without an outcome this screen can read.");
              return;
            }
            setObsolete("");
            setSupport("");
            setReason("");
            router.refresh();
          });
        }}
      >
        Record resolution
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-danger">
          {error}
        </p>
      )}
      {unknown && (
        <div role="alert" data-testid="resolve-unknown-outcome" className="mt-2 rounded-lg border border-warning-line bg-warning-soft/60 p-2.5 text-label text-ink">
          <p>
            <span className="font-semibold">Outcome unknown.</span> {unknown}
          </p>
          <div className="mt-2">
            {/* A real reload: a refresh would leave this form, and its
                uncertainty, exactly where they are. */}
            <Button variant="quiet" size="sm" data-testid="resolve-reload" onClick={() => window.location.reload()}>
              Reload the page and check what was recorded
            </Button>
          </div>
        </div>
      )}
    </details>
  );
}
