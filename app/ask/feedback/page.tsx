// How Ask is doing: the numbers worth watching in the first weeks, then the
// answers someone marked wrong, with what they asked, what it looked at and
// what they said, so prompts and tools are fixed from real misses.
import Link from "next/link";
import { requirePageUser, listUsers } from "@/lib/auth";
import { listJudged } from "@/lib/ask/threads";
import { askHealth } from "@/lib/ask/health";
import { AskMarkdown } from "@/lib/ask/markdown";
import { fmtWhen } from "@/lib/format";
import { Page } from "@/components/Nav";
import { Card, Empty, PageHeader, Section } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AskFeedbackPage() {
  const user = await requirePageUser();
  const wrong = listJudged("wrong");
  const useful = listJudged("useful", 500).length;
  const h = askHealth();
  const names = new Map(listUsers({ includeInactive: true }).map((u) => [u.id, u.display_name]));
  const plain = (n: number) => <sup className="ml-0.5 text-micro text-ink-muted">[{n}]</sup>;
  return (
    <Page user={user} main="max-w-3xl">
      <PageHeader
        title="How Ask is doing"
        sub={`The last ${h.days} days, from what is stored. ${wrong.length} answer${wrong.length === 1 ? "" : "s"} marked wrong in all, ${useful} useful.`}
      />
      <Section title="Last 30 days">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3" data-testid="ask-health">
          <Stat label="Answers" value={String(h.answered)} sub={h.failed ? `${h.failed} failed` : "none failed"} warn={h.failed > 0} />
          <Stat label="Time to answer" value={h.medianSeconds == null ? "—" : `${h.medianSeconds}s`} sub="median" warn={(h.medianSeconds ?? 0) > 20} />
          <Stat label="Cost per answer" value={h.medianCents == null ? "—" : `$${(h.medianCents / 100).toFixed(2)}`} sub={`$${(h.totalCents / 100).toFixed(2)} in all`} />
          <Stat label="Marked wrong" value={h.useful + h.wrong ? `${Math.round((100 * h.wrong) / (h.useful + h.wrong))}%` : "—"} sub={`${h.wrong} wrong · ${h.useful} useful · ${h.unmarked} unmarked`} warn={h.wrong > h.useful} />
          <Stat label="Changes it proposed" value={String(h.proposals.accepted + h.proposals.waiting + h.proposals.rejected)} sub={`${h.proposals.accepted} accepted · ${h.proposals.waiting} waiting · ${h.proposals.rejected} turned down`} warn={h.proposals.waiting > h.proposals.accepted} />
          <Stat label="Reports" value={String(h.reports.written)} sub={`${h.reports.shared} shared by link`} />
        </dl>
        {h.repeated.length > 0 && (
          <div className="mt-4 border-t border-line pt-3" data-testid="ask-repeated">
            <p className="text-micro font-semibold uppercase tracking-[0.06em] text-ink-muted">Asked more than once</p>
            <ul className="mt-1 space-y-0.5 text-label">
              {h.repeated.map((r) => (
                <li key={r.text} className="flex justify-between gap-3">
                  <span className="min-w-0 [overflow-wrap:anywhere]">{r.text}</span>
                  <span className="shrink-0 tabular-nums text-ink-muted">×{r.times}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>
      <Section title="Wrong">
        {wrong.length === 0 ? (
          <Empty>Nothing marked wrong yet.</Empty>
        ) : (
          <ul className="space-y-4" data-testid="feedback-wrong">
            {wrong.map(({ answer, question, threadId }) => (
              <li key={answer.id}>
                <Card className="p-4 sm:p-5">
                  <p className="text-micro text-ink-muted">
                    {names.get(answer.verdict?.by ?? "") ?? "someone"} · {fmtWhen(answer.verdict?.at ?? null)} ·{" "}
                    <Link href={`/ask/${threadId}`} className="font-semibold text-accent hover:underline">the conversation</Link>
                  </p>
                  {question && <p className="mt-2 font-semibold text-ink-strong [overflow-wrap:anywhere]">{question}</p>}
                  {answer.verdict?.note && <p className="mt-1 rounded-lg bg-danger-soft px-3 py-1.5 text-label text-ink">“{answer.verdict.note}”</p>}
                  <div className="mt-3 max-h-48 overflow-hidden text-label">
                    <AskMarkdown text={answer.text} marker={plain} />
                  </div>
                  {answer.steps.length > 0 && <p className="mt-2 text-micro text-ink-muted">Looked at: {answer.steps.join(" · ")}</p>}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Page>
  );
}

function Stat({ label, value, sub, warn = false }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-micro font-semibold uppercase tracking-[0.06em] text-ink-muted">{label}</dt>
      <dd className={`font-display text-heading font-bold tabular-nums ${warn ? "text-warning" : "text-ink-strong"}`}>{value}</dd>
      <dd className="text-micro text-ink-muted">{sub}</dd>
    </div>
  );
}
