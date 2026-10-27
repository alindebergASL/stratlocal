"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fmtCostNote } from "@/lib/format";
import { Button, ButtonLink, Callout, controlSm } from "@/components/ui";
import { useAiRun } from "@/components/useAiRun";
import { DOCUMENT_ACCEPT } from "@/lib/documents/accept";

type ImportResult = { batchId: string; proposals: number; dropped: string[]; attempts: number };

export function ImportForm({ accountId, today }: { accountId: string; today: string }) {
  const { start, state, error, busy } = useAiRun<ImportResult>();
  const fileRef = useRef<HTMLInputElement>(null);
  const asOfRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [purpose, setPurpose] = useState<"report" | "customer_doc">("report");
  const [kept, setKept] = useState<{ ok: boolean; text: string } | null>(null);
  const [keeping, setKeeping] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    setKept(null);
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
    await start(`/api/accounts/${accountId}/import`, fd);
  }

  const result = state?.status === "done" ? state.result : null;

  return (
    <div>
      <fieldset className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-label" data-testid="import-purpose">
        <legend className="sr-only">What is this file?</legend>
        <label className="flex min-h-9 items-center gap-2">
          <input type="radio" name="purpose" value="report" checked={purpose === "report"} onChange={() => setPurpose("report")} className="accent-accent" />
          <span>
            <span className="font-semibold text-ink">Account report</span> <span className="text-ink-muted">deals, team, install base, plays</span>
          </span>
        </label>
        <label className="flex min-h-9 items-center gap-2">
          <input type="radio" name="purpose" value="customer_doc" checked={purpose === "customer_doc"} onChange={() => setPurpose("customer_doc")} className="accent-accent" data-testid="import-purpose-customer" />
          <span>
            <span className="font-semibold text-ink">Customer document</span> <span className="text-ink-muted">their plan, budget, RFP or notes</span>
          </span>
        </label>
      </fieldset>
      <form onSubmit={submit} className="flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept={DOCUMENT_ACCEPT}
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
          {busy ? "Reading…" : keeping ? "Keeping…" : purpose === "report" ? "Upload and extract" : "Upload and keep"}
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
                <p className="font-semibold">Nothing came through, and it is not because the account already matches.</p>
                <p className="mt-1">
                  Every deal the model found was dropped: an id it reported is not in the report&rsquo;s own text, so there is no way to tell whether it
                  read the id or invented it. That check is the one thing standing between a report and a deal nobody can find in the CRM, so it drops
                  rather than guesses.
                </p>
              </>
            ) : (
              <p>
                The account already matches this report — nothing in it differs from what is on file
                {fmtCostNote(state?.cost_cents ?? null, state?.cost_estimated ?? null)}.{" "}
                <Link href={`/accounts/${accountId}`} className="underline">
                  Back to the account.
                </Link>
              </p>
            )}
            {/* What was dropped, by name. The count alone is a number nobody
                can act on; the ids are the whole diagnosis. */}
            {result.dropped.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-micro">
                  {result.dropped.length} dropped for not appearing in the report text
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
