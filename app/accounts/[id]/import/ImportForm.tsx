"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fmtCostNote } from "@/lib/format";
import { Button, ButtonLink, Callout, controlSm } from "@/components/ui";
import { useAiRun } from "@/components/useAiRun";
import { DOCUMENT_ACCEPT } from "@/lib/documents/accept";

type ImportResult = { batchId: string; proposals: number; dropped: string[]; attempts: number };

export function ImportForm({ accountId, today, reportAvailable = true, localImport = false }: { accountId: string; today: string; reportAvailable?: boolean; localImport?: boolean }) {
  const { start, state, error, busy } = useAiRun<ImportResult>();
  const fileRef = useRef<HTMLInputElement>(null);
  const asOfRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [selectedPurpose, setPurpose] = useState<"report" | "customer_doc">("report");
  const purpose = reportAvailable ? selectedPurpose : "customer_doc";
  const [kept, setKept] = useState<{ ok: boolean; text: string } | null>(null);
  const [keeping, setKeeping] = useState(false);
  const [localResult, setLocalResult] = useState<ImportResult | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    setKept(null);
    setLocalResult(null);
    if (purpose === "customer_doc") {
      // Kept as it is: nothing to extract, so no run to wait on.
      fd.append("purpose", "customer_doc");
      setKeeping(true);
      try {
        const res = await fetch(`/api/accounts/${accountId}/import`, { method: "POST", body: fd });
        const body = (await res.json().catch(() => ({}))) as { documentId?: string; error?: string };
        setKept(res.ok && body.documentId ? { ok: true, text: `Kept “${file.name}”. It is listed on Research and read with the account's records from now on.` } : { ok: false, text: body.error ?? "The upload did not go through." });
        if (res.ok) router.refresh();
      } catch {
        setKept({ ok: false, text: "The upload did not come back. Reload to see whether it was kept." });
      } finally {
        setKeeping(false);
      }
      return;
    }
    if (asOfRef.current?.value) fd.append("as_of", asOfRef.current.value);
    if (localImport) {
      setKeeping(true);
      try {
        const res = await fetch(`/api/accounts/${accountId}/import`, { method: "POST", body: fd });
        const body = (await res.json()) as { result?: ImportResult; error?: string };
        if (!res.ok || !body.result) setKept({ ok: false, text: body.error ?? "The import could not be completed." });
        else { setLocalResult(body.result); router.refresh(); }
      } catch {
        setKept({ ok: false, text: "The import response was lost. Check pending changes before trying again." });
      } finally { setKeeping(false); }
      return;
    }
    await start(`/api/accounts/${accountId}/import`, fd);
  }

  const result = localImport ? localResult : state?.status === "done" ? state.result : null;

  return (
    <div>
      <fieldset className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-label" data-testid="import-purpose">
        <legend className="sr-only">What is this file?</legend>
        <label className="flex min-h-9 items-center gap-2">
          <input type="radio" name="purpose" value="report" checked={purpose === "report"} disabled={!reportAvailable} onChange={() => setPurpose("report")} className="accent-accent" />
          <span>
            <span className="font-semibold text-ink">{localImport ? "MyAgent JSON report" : "Account report"}</span> <span className="text-ink-muted">deals, team, install base, plays</span>
          </span>
        </label>
        <label className="flex min-h-9 items-center gap-2">
          <input type="radio" name="purpose" value="customer_doc" checked={purpose === "customer_doc"} onChange={() => setPurpose("customer_doc")} className="accent-accent" data-testid="import-purpose-customer" />
          <span>
            <span className="font-semibold text-ink">{localImport ? "Reference document" : "Customer document"}</span> <span className="text-ink-muted">research, plans, budgets or notes</span>
          </span>
        </label>
      </fieldset>
      <form onSubmit={submit} className="flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept={localImport && purpose === "report" ? ".json" : DOCUMENT_ACCEPT}
          required
          aria-label={purpose === "report" ? "Report file" : "Customer document"}
          className="min-w-0 flex-1 text-label file:mr-3 file:rounded-md file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-label file:font-semibold file:text-ink-invert hover:file:bg-ink-strong"
        />
        {/* The install base is filed under this date, and the trend on the
            account page is read off it. Defaulting to today is right for the
            usual case and wrong for a backfill, which is exactly why it has
            to be a field rather than the clock. */}
        {purpose === "report" && (
          <label className="flex items-center gap-2 text-label text-ink-muted">
            <span>Report date</span>
            <input ref={asOfRef} type="date" name="as_of" defaultValue={today} max={today} className={controlSm} />
          </label>
        )}
        <Button type="submit" disabled={busy || keeping} aria-busy={busy || keeping} data-testid="import-submit">
          {busy ? "Reading…" : keeping ? "Processing…" : purpose === "report" ? localImport ? "Import for review" : "Upload and extract" : "Upload and keep"}
        </Button>
      </form>
      {kept && (
        <Callout tone={kept.ok ? "positive" : "danger"} className="mt-3" testId="import-kept">
          {kept.text}
          {kept.ok && (
            <>
              {" "}
              <Link href={`/accounts/${accountId}/research?view=documents`} className="font-semibold underline">
                See it on Research
              </Link>
            </>
          )}
        </Callout>
      )}

      <div role="status" aria-live="polite">
        {error && (
          <Callout tone="danger" className="mt-3">
            {error}
          </Callout>
        )}
        {state?.status === "running" && (
          <Callout tone="neutral" className="mt-3">
            Reading the report. This usually takes under a minute, and you can leave this page — the result will be waiting on the account.
          </Callout>
        )}
        {state?.status === "failed" && (
          <Callout tone="danger" className="mt-3">
            Extraction failed: {state.error}
          </Callout>
        )}
        {result && (
          // Three outcomes, not two. Proposals, or nothing because the account
          // already matches, or — the one that used to be told as the second —
          // nothing because every deal was thrown away for not having its id
          // verbatim in the report text.
          //
          // That last case said "The account already matches this report" in a
          // green box, which is a confident wrong explanation of the most
          // likely first-day failure: a model whose id extraction does not
          // line up with the file. Worse than saying nothing.
          <Callout tone={result.proposals > 0 ? "positive" : result.dropped.length > 0 ? "warning" : "neutral"} className="mt-3">
            {result.proposals > 0 ? (
              <>
                <p>
                  <strong className="tabular-nums">{result.proposals}</strong> proposed change{result.proposals === 1 ? "" : "s"} ready
                  {fmtCostNote(state?.cost_cents ?? null, state?.cost_estimated ?? null)}
                </p>
                <ButtonLink href={`/inbox?kind=changes&account=${accountId}`} variant="positive" className="mt-2">
                  Review them
                </ButtonLink>
              </>
            ) : result.dropped.length > 0 ? (
              <>
                <p className="font-semibold">No new proposals were created. Some input was omitted.</p>
                <p className="mt-1">
                  Review the omitted items below and correct the source before importing again. Records that already match may also produce no proposals.
                </p>
              </>
            ) : (
              <p>
                No new proposals were created. The supported changes may already match, be pending review, or have been declined
                {fmtCostNote(state?.cost_cents ?? null, state?.cost_estimated ?? null)}.{" "}
                <Link href={`/inbox?kind=changes&account=${accountId}`} className="underline">
                  Review pending changes.
                </Link>
              </p>
            )}
            {/* What was dropped, by name. The count alone is a number nobody
                can act on; the ids are the whole diagnosis. */}
            {result.dropped.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-micro">
                  {result.dropped.length} omitted during validation
                </summary>
                <ul className="mt-1 list-disc pl-5 text-micro">
                  {result.dropped.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </details>
            )}
          </Callout>
        )}
      </div>
    </div>
  );
}
