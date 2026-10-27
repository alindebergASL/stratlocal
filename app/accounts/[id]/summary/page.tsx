import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { getAccount, listContacts } from "@/lib/queries/accounts";
import { listNotes } from "@/lib/research/notes";
import { todayISO, todayLabel } from "@/lib/clock";
import { evidenceText } from "@/lib/research/evidence";
import { ONE_PAGER } from "@/lib/ask/templates";
import { briefItemsOf, overviewLeads } from "@/lib/research/brief";
import { confirmedEntity } from "@/lib/research/run";
import { sourceKind } from "@/lib/research/provenance";
import { focusForResearch } from "@/lib/teamDirection";
import { Nav } from "@/components/Nav";
import { SourceLink } from "@/components/SourceLink";

export const dynamic = "force-dynamic";
// Deliberate excerpts are marked. Full text is always one click away, never
// cropped with overflow:hidden or lost from the underlying research.
function excerpt(text: string, limit: number) {
  return text.length <= limit ? text : text.slice(0, limit - 1).trimEnd() + "…";
}

export default async function SummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const account = getAccount(id);
  if (!account) notFound();
  const notes = listNotes(id, "accepted");
  // The same three lines the Overview leads with: a reason to act, where we
  // fit, then the newest by topic. It used to be three findings picked by
  // keyword, with nothing to say why any of them mattered now.
  const items = briefItemsOf(notes);
  const leads = overviewLeads(items, focusForResearch(), todayISO());
  const entity = confirmedEntity(id);
  const people = listContacts(id);
  // Who decides comes first, from the research's own guesses; then a
  // question per fact; then the general ones.
  const guesses = [...notes].sort((a, b) => b.meta.generated_at.localeCompare(a.meta.generated_at)).find((n) => n.meta.buying_group?.length)?.meta.buying_group ?? [];
  const questions = [
    ...guesses.slice(0, 2).map((g) => g.question),
    ...leads.map((l, i) =>
      l.kind === "why"
        ? `For fact ${i + 1}: who owns it, what decision does it force, and by when?`
        : l.item.finding.topic === "leadership"
          ? `For the leader in fact ${i + 1}, what is their current scope, and who else should join the conversation?`
          : `For fact ${i + 1}, what is its current status and next decision—not just its published target?`,
    ),
  ].slice(0, 3);
  const fallbacks = ["Which priority is most important to validate first?", "Who should join the next discovery conversation?", "What evidence would make a next step worthwhile?"];
  for (const f of fallbacks) if (questions.length < 3) questions.push(f);
  return (
    <div data-print="document" data-one-page className="lg:flex">
      <Nav user={user} />
      <main className="mx-auto w-full min-w-0 max-w-3xl px-4 py-6 text-body lg:py-10">
        <div data-print-hide className="mb-5 flex flex-wrap justify-between gap-3 text-label">
          <Link href={`/accounts/${id}`} className="text-accent underline">
            ← {account.name}
          </Link>
          <Link href={`/accounts/${id}/summary/details`} className="text-accent underline">
            Full account details & research appendix →
          </Link>
          <p className="w-full text-micro text-ink-muted">Print or save as PDF for the one-page version.</p>
          {/* The other way to have this account on a page: written up by Ask
              as a report, with sources, to send or share by link. */}
          <p className="w-full text-label" data-testid="one-page-write">
            <Link href={`/accounts/${id}/ask?template=${ONE_PAGER}`} className="font-semibold text-accent underline">
              Write the one-pager
            </Link>
            <span className="text-micro text-ink-muted"> · a written version with sources, from Ask, to send or share by link.</span>
          </p>
        </div>
        <header className="mb-4 border-b-2 border-ink-strong pb-3">
          <p className="text-micro uppercase tracking-wide text-ink-muted">Account team · 1-minute brief · {todayLabel()}</p>
          <h1 className="font-display text-3xl font-bold text-ink-strong break-words">{excerpt(account.name, 100)}</h1>
          {entity && (
            <p className="text-micro text-ink-muted" data-testid="one-page-entity">
              Researched as {[entity.name, entity.domain, entity.ticker && `ticker ${entity.ticker}`, entity.parent && `part of ${entity.parent}`].filter(Boolean).join(" · ")}
            </p>
          )}
          {account.archived_at && <p className="text-warning">Archived account — {account.archived_at}</p>}
        </header>
        <section className="mb-4">
          <h2 className="text-label font-bold">Purpose</h2>
          <p>Validate {excerpt(account.name, 80)}’s published priorities and identify a useful discovery conversation—not a confirmed sales opportunity.</p>
        </section>
        <section className="mb-4" data-testid="one-page-facts">
          <h2 className="text-label font-bold">{leads.some((l) => l.kind !== "topic") ? "Why now, and where we fit" : "Three relevant facts"}</h2>
          {leads.length === 0 ? (
            <p className="text-ink-muted">No retained research evidence. Start with discovery; no facts have been inferred.</p>
          ) : (
            <ol className="mt-2 space-y-2">
              {leads.map((l, i) => (
                <li key={`${l.item.noteId}#${l.item.index}`} className="border-l-2 border-line pl-3" data-lead={l.kind}>
                  <p>
                    <strong>{i + 1}. {l.label}: </strong>
                    {excerpt(evidenceText({ ...l.item, id: `${l.item.noteId}#${l.item.index}`, scope: "General public-source research" }), 260)}
                  </p>
                  {l.soWhat && <p className="text-label">So what: {excerpt(l.soWhat, 200)}</p>}
                  <p className="text-micro text-ink-muted">
                    <SourceLink url={l.item.finding.url}>Source {i + 1}</SourceLink> · {sourceKind(l.item.finding.url, entity?.domain ? [account.name, entity.domain] : account.name)} ·{" "}
                    {l.item.finding.date ?? (l.item.finding.page_age ? `${l.item.finding.page_age} (indexed)` : `research as of ${l.item.asOf}`)} ·{" "}
                    {l.item.finding.evidence?.kind === "source_excerpt" ? "Source-bound excerpt; not independent verification" : "Report excerpt; original support not verified"}
                  </p>
                </li>
              ))}
            </ol>
          )}
          {leads.some((l) => l.kind !== "topic") && <p className="mt-1 text-micro text-ink-muted">Which facts are reasons to act, and where they fit, is the model&rsquo;s read of them.</p>}
        </section>
        <section className="mb-4">
          <h2 className="text-label font-bold">People on file</h2>
          <p className="text-label">
            {people.length
              ? people
                  .slice(0, 2)
                  .map((p) => `${excerpt(p.name, 65)} — ${excerpt(p.title || "title unknown", 90)}`)
                  .join("; ")
              : "No people applied yet. Review named leadership suggestions from research."}
            {people.length > 2 ? ` · ${people.length - 2} more in account details.` : ""}
          </p>
        </section>
        <section className="mb-4">
          <h2 className="text-label font-bold">Hypothesis — to validate</h2>
          <p>
            {account.thesis
              ? excerpt(account.thesis, 320)
              : "No account hypothesis on file. Public initiatives alone do not establish buying intent, approved budget or vendor preference."}
          </p>
        </section>
        <section className="mb-4">
          <h2 className="text-label font-bold">Three questions</h2>
          <ol className="list-decimal space-y-1 pl-5">
            {questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        </section>
        <section className="mb-4">
          <h2 className="text-label font-bold">Close</h2>
          <p>Ask whether a follow-up conversation would be useful, and who should join. No customer commitment is recorded.</p>
        </section>
        <footer className="border-t border-line pt-2 text-micro text-ink-muted">
          <p>
            <strong>Uncertainty:</strong> Public research is not customer confirmation. Past target dates do not prove completion; proposals are not approval.
          </p>
          <p>
            {leads.length} of {items.length} retained findings shown; {items.length - leads.length} in the research appendix. Original reports and sources are preserved.
          </p>
          <p className="break-all">Full details: /accounts/{id}/summary/details</p>
        </footer>
      </main>
    </div>
  );
}
