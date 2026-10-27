"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Callout, control } from "@/components/ui";
import { useAiRun } from "@/components/useAiRun";
import { DOCUMENT_ACCEPT } from "@/lib/documents/accept";

// Upload the team's playbook document, or paste it; a draft comes back to
// read and correct before it becomes the playbook.
export function PlaybookImport({ slug = null }: { slug?: string | null } = {}) {
  const { start, state, error, busy } = useAiRun<{ chars?: number }>(null);
  const [runId, setRunId] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const id = await start("/api/playbook/import", new FormData(e.currentTarget));
    if (id) setRunId(id);
  }
  return (
    <form onSubmit={submit} className="space-y-3 text-label" data-testid="playbook-import">
      <label className="block">
        <span className="mb-1 block text-micro font-medium text-ink-muted">The playbook document (PDF, Word, HTML or text)</span>
        <input type="file" name="file" accept={DOCUMENT_ACCEPT} className="block w-full max-w-full text-label file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5" data-testid="playbook-import-file" />
      </label>
      <label className="block">
        <span className="mb-1 block text-micro font-medium text-ink-muted">Or paste its text</span>
        <textarea name="text" rows={4} className={control} data-testid="playbook-import-text" />
      </label>
      <p className="text-micro text-ink-muted">Read inside your AWS account. You check the draft before it is saved.</p>
      <Button type="submit" disabled={busy} aria-busy={busy} data-testid="playbook-import-run">
        {busy ? "Reading the document…" : "Read the playbook"}
      </Button>
      <div role="status" aria-live="polite">
        {error && <Callout tone="danger" className="mt-2">{error}</Callout>}
        {state?.status === "failed" && <Callout tone="danger" className="mt-2">Could not read it: {state.error}</Callout>}
        {state?.status === "done" && runId && (
          <Link href={`/settings/playbook/import/${runId}${slug ? `?pb=${slug}` : ""}`} className="inline-flex min-h-11 items-center font-semibold text-accent hover:underline" data-testid="playbook-import-review">
            Check the draft →
          </Link>
        )}
      </div>
    </form>
  );
}
