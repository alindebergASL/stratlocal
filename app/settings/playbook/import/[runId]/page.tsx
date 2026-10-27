import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { getRun } from "@/lib/ai/guard";
import { currentPlaybook } from "@/lib/playbook/store";
import { Playbook } from "@/lib/playbook/schema";
import { Page } from "@/components/Nav";
import { Callout, PageHeader, Section } from "@/components/ui";
import { ResultButton } from "@/components/ResultButton";
import { PlaybookView } from "@/components/PlaybookView";
import { saveImportedAction } from "../../actions";

export const dynamic = "force-dynamic";

// The draft a document was read into, to check before it becomes the
// playbook. What is wrong can be fixed after saving, in the editor.
export default async function PlaybookImportReview({ params, searchParams }: { params: Promise<{ runId: string }>; searchParams?: Promise<{ pb?: string }> }) {
  const user = await requirePageUser();
  const { runId } = await params;
  const run = getRun(runId);
  if (!run || run.kind !== "playbook_import" || run.status !== "done" || !run.result_json) notFound();
  const result = JSON.parse(run.result_json) as { draft: unknown; problems: string[] | null; filename: string | null };
  const parsed = Playbook.safeParse(result.draft);
  // Saved into the playbook it was imported from, the default unless another was open.
  const current = currentPlaybook({ slug: (await searchParams)?.pb ?? null });
  return (
    <Page user={user} main="max-w-4xl">
      <PageHeader title="Check the imported playbook" sub={`Read from ${result.filename ?? "the pasted text"}. Read it through; nothing is saved until you press Save.`} />
      <Section title="What was understood">
        {!parsed.success || result.problems ? (
          <Callout tone="warning" className="mb-3">
            <p className="font-semibold">Some of it did not fit together:</p>
            <ul className="list-disc pl-5">{(result.problems ?? parsed.error?.issues.map((i) => i.message) ?? []).map((p) => <li key={p}>{p}</li>)}</ul>
          </Callout>
        ) : null}
        {parsed.success && <PlaybookView playbook={parsed.data} />}
      </Section>
      <div className="mb-8 flex flex-wrap items-center gap-3" data-testid="playbook-import-actions">
        {parsed.success && !result.problems && (
          <ResultButton run={saveImportedAction.bind(null, runId, current?.id ?? null)} variant="primary" testId="playbook-import-save">
            {current ? "Save as the new playbook" : "Save as the playbook"}
          </ResultButton>
        )}
        <Link href="/settings/playbook" className="text-label text-accent hover:underline">
          {parsed.success && !result.problems ? "Not now" : "Back"}
        </Link>
        {current && <span className="text-micro text-ink-muted">The current playbook is kept as an earlier version and can be restored.</span>}
      </div>
    </Page>
  );
}
