import { db } from "@/lib/db";
// One Ask conversation: each question, its answer with numbered sources
// resolved to the records as they are now, and the question box.
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser, listUsers } from "@/lib/auth";
import { getRun } from "@/lib/ai/guard";
import { runState } from "@/lib/ai/runState";
import { getThread, latestRunId, listMessages, type AskMessage, type AskProposals } from "@/lib/ask/threads";
import { batchStatus, quickFollowUps } from "@/lib/ask/propose";
import { ResultButton } from "@/components/ResultButton";
import { getReport } from "@/lib/ask/report";
import { resolveSources, type AskSource } from "@/lib/ask/sources";
import { AskMarkdown } from "@/lib/ask/markdown";
import { resolveFocus } from "@/lib/ask/focus";
import { AskAbout } from "@/components/AskAbout";
import { AskChips } from "@/components/AskChips";
import { AskChart } from "@/components/AskChart";
import { AnswerFeedback } from "@/components/AnswerFeedback";
import { markReadySeen } from "@/lib/assistants/ready";
import { answerToText } from "@/lib/ask/plainText";
import { recapMailto } from "@/lib/meetings/recap";
import { CopyAndMail } from "@/components/CopyAndMail";
import { getAccount } from "@/lib/queries/accounts";
import { fmtCostNote, fmtWhen } from "@/lib/format";
import { Page } from "@/components/Nav";
import { AskBox, AskLive } from "@/components/AskBox";
import { Button, Callout, Card, Eyebrow } from "@/components/ui";
import { addAskFollowUpsAction, archiveThreadAction, keepThreadAction } from "../actions";

export const dynamic = "force-dynamic";

function Answer({ message, subject, home }: { message: AskMessage; subject: string; home: string | null }) {
  const sources = resolveSources(message.citations);
  const mail = recapMailto([], subject, answerToText(message.text, sources, message.charts));
  const run = message.runId ? getRun(message.runId) : null;
  const byN = new Map(sources.map((s) => [s.n, s]));
  const marker = (n: number) => {
    const s = byN.get(n);
    // A marker with no checked source behind it is not drawn as one.
    if (!s) return null;
    // The record, a hover or a tap away: its name and one line about it as
    // it is now. Drawn on the server; nothing is fetched.
    return (
      // Raised by position, not by vertical-align: a superscript stretches
      // its line, and a list full of them reads unevenly spaced.
      <span className="group/src relative inline-block leading-none">
        <a href={`#${message.id}-${n}`} className="relative -top-[0.45em] ml-0.5 text-[0.75em] font-semibold text-accent no-underline hover:underline" aria-label={`source ${n}: ${s.label}`}>
          [{n}]
        </a>
        <span
          role="tooltip"
          data-print-hide
          data-testid="source-preview"
          className="pointer-events-none invisible absolute bottom-full left-1/2 z-30 mb-1 w-64 max-w-[80vw] -translate-x-1/2 max-sm:fixed max-sm:inset-x-4 max-sm:bottom-24 max-sm:left-4 max-sm:w-auto max-sm:max-w-none max-sm:translate-x-0 rounded-lg border border-line bg-surface px-3 py-2 text-left text-micro leading-snug text-ink opacity-0 shadow-raised transition-opacity group-focus-within/src:visible group-focus-within/src:opacity-100 group-hover/src:visible group-hover/src:opacity-100"
        >
          <span className="block font-semibold text-ink-strong">{s.label}</span>
          {s.account && <span className="block text-ink-muted">{s.account}</span>}
          {(s.detail || s.unavailable) && <span className="mt-0.5 block text-ink-muted">{s.unavailable ?? s.detail}</span>}
        </span>
      </span>
    );
  };
  return (
    <article className="space-y-3" data-testid="ask-answer">
      <AskMarkdown text={message.text} marker={marker} />
      {message.charts.map((c, i) => <AskChart key={i} chart={c} bare />)}
      {message.reportDocId && <ReportLink docId={message.reportDocId} />}
      {message.proposals.map((p) => <Proposed key={p.batchId} batch={p} threadId={message.threadId} />)}
      {sources.length > 0 && <Sources id={message.id} sources={sources} home={home} />}
      {/* When it was written and what it cost: an answer is a reading of the
          records at that moment, and a question is not free. */}
      <details className="text-micro text-ink-muted" data-testid="ask-answered">
        <summary className="cursor-pointer select-none">
          Answered {fmtWhen(message.createdAt)}
          {run ? fmtCostNote(run.cost_cents, runState(run).cost_estimated) : ""}
          {message.steps.length > 0 && ` · how it found this (${message.steps.length} step${message.steps.length === 1 ? "" : "s"})`}
        </summary>
        {message.steps.length > 0 && <ol className="mt-1 space-y-0.5 pl-4">{message.steps.map((s, i) => <li key={i} className="list-disc">{s}</li>)}</ol>}
      </details>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-line pt-2">
        <CopyAndMail text={answerToText(message.text, sources, message.charts)} mailto={mail.href} withBody={mail.withBody} testId="ask-copy" />
        <AnswerFeedback messageId={message.id} initial={message.verdict?.value ?? null} initialNote={message.verdict?.note ?? null} />
      </div>
    </article>
  );
}

function ReportLink({ docId }: { docId: string }) {
  const found = getReport(docId);
  if (!found) return <p className="text-label text-ink-muted">The report this answer wrote has been deleted.</p>;
  return (
    <Link href={`/reports/${docId}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-accent-line bg-accent-soft px-3 py-2 text-label text-ink hover:underline" data-testid="ask-report">
      <span>Report: <strong>{found.report.title}</strong></span>
      <span className="font-semibold text-accent">Open, print or share →</span>
    </Link>
  );
}

// What the answer filed for review, and where it stands now.
function Proposed({ batch, threadId }: { batch: AskProposals; threadId: string }) {
  const now = batchStatus(batch.batchId);
  const account = getAccount(batch.accountId);
  const decided = [now.accepted && `${now.accepted} accepted`, now.rejected && `${now.rejected} turned down`].filter(Boolean).join(", ");
  // Only new follow-ups, nothing resting on public research: add them here.
  // Anything that edits a record still goes to the review page.
  const quick = quickFollowUps(batch.batchId);
  if (quick) {
    return (
      <div className="rounded-lg border border-warning-line bg-warning-soft px-3 py-2 text-label text-ink" data-testid="ask-quick-follow-ups">
        <p>
          <strong className="tabular-nums">{quick.length}</strong> follow-up{quick.length === 1 ? "" : "s"} to add on {account?.name ?? "an account"}
          {decided && <span className="text-ink-muted"> · {decided}</span>}
        </p>
        <ul className="mt-1 list-disc pl-5">
          {quick.map((f) => (
            <li key={f.id}>
              {f.text}
              {f.due && <span className="text-ink-muted"> · due {f.due}</span>}
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <ResultButton run={addAskFollowUpsAction.bind(null, batch.batchId, threadId)} variant="primary" testId="ask-quick-add">
            Add {quick.length === 1 ? "it" : `all ${quick.length}`}
          </ResultButton>
          <Link href={`/inbox?kind=changes&account=${batch.accountId}`} className="text-label font-semibold text-accent hover:underline">
            Review first →
          </Link>
        </div>
      </div>
    );
  }
  return (
    <Link
      href={`/inbox?kind=changes&account=${batch.accountId}`}
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning-line bg-warning-soft px-3 py-2 text-label text-ink hover:underline"
      data-testid="ask-proposed"
    >
      <span>
        <strong className="tabular-nums">{batch.count}</strong> change{batch.count === 1 ? "" : "s"} proposed on {account?.name ?? "an account"}
        {decided && <span className="text-ink-muted"> · {decided}</span>}
      </span>
      <span className="font-semibold text-accent">{now.pending ? `Review ${now.pending} →` : "Reviewed"}</span>
    </Link>
  );
}

// How many sources show before the rest fold away. Every marker still
// previews its record on hover or tap, so a long list need not be read.
const SOURCES_SHOWN = 4;

function Sources({ id, sources, home }: { id: string; sources: AskSource[]; home: string | null }) {
  const row = (s: AskSource) => (
    <li key={s.n} id={`${id}-${s.n}`} className="flex gap-2 [overflow-wrap:anywhere]">
      <span className="w-6 shrink-0 text-right tabular-nums text-ink-muted">{s.n}.</span>
      <span className="min-w-0">
        {s.href ? <Link href={s.href} className="text-ink underline decoration-line-strong underline-offset-2 hover:text-accent">{s.label}</Link> : <span className="text-ink">{s.label}</span>}
        {/* The account is said only when it is not the conversation's own. */}
        {s.account && s.account !== home && <span className="text-ink-muted"> · {s.account}</span>}
        {s.detail && <span className="block text-micro text-ink-muted">{s.detail}</span>}
        {s.unavailable && <span className="block text-micro text-ink-muted">{s.unavailable}</span>}
      </span>
    </li>
  );
  const shown = sources.slice(0, SOURCES_SHOWN);
  const rest = sources.slice(SOURCES_SHOWN);
  return (
    <div className="border-t border-line pt-2" data-testid="ask-sources">
      <Eyebrow className="mb-1">Sources</Eyebrow>
      <ol className="space-y-1 text-label">{shown.map(row)}</ol>
      {rest.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer select-none pl-8 text-micro font-semibold text-accent">Show {rest.length} more</summary>
          <ol className="mt-1 space-y-1 text-label">{rest.map(row)}</ol>
        </details>
      )}
    </div>
  );
}

function draftsFor(threadId: string): number {
  return (db().prepare(`SELECT COUNT(*) AS n FROM outbound_drafts WHERE source = 'ask' AND source_id = ? AND status IN ('draft','failed')`).get(threadId) as { n: number }).n;
}

export default async function AskThreadPage({ params }: { params: Promise<{ threadId: string }> }) {
  const user = await requirePageUser();
  const { threadId } = await params;
  const thread = getThread(threadId);
  const askDrafts = thread ? draftsFor(thread.id) : 0;
  if (!thread) notFound();
  const account = thread.accountId ? getAccount(thread.accountId) : null;
  const about = resolveFocus(thread.focus, thread.accountId);
  markReadySeen(thread.id, user.id);
  const messages = listMessages(thread.id);
  const opener = messages[0]?.role === "user" ? messages[0] : null;
  const names = new Map(listUsers({ includeInactive: true }).map((u) => [u.id, u.display_name]));
  const runId = latestRunId(thread.id);
  const run = runId ? getRun(runId) : null;
  // The live view is for a question still being answered, or one that failed
  // and has no answer after it.
  const last = messages.at(-1);
  const live = run && (run.status === "running" || (run.status === "failed" && last?.role === "user")) ? { id: run.id, state: runState<{ steps?: string[] }>(run) } : null;

  return (
    <Page user={user} main="max-w-3xl">
      {/* The first question is the page's title, said once: not a heading
          and then the same words again in a bubble under it. */}
      <div className="mb-5">
        <Eyebrow>
          <Link href={account ? `/accounts/${account.id}/ask` : "/ask"} className="hover:text-accent">
            Ask{account ? ` · ${account.name}` : ""}
          </Link>
        </Eyebrow>
        <div data-testid={opener ? "ask-question" : undefined}>
          {/* A long question is a paragraph, not a headline. */}
          <h1
            className={`whitespace-pre-wrap tracking-tight text-ink-strong [overflow-wrap:anywhere] ${
              (opener?.text ?? thread.title).length > 140 ? "text-lead font-semibold" : "font-display text-title font-extrabold"
            }`}
          >
            {opener ? opener.text : thread.title}
          </h1>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3">
            <p className="text-micro text-ink-muted">
              {opener ? `${names.get(opener.createdBy ?? "") ?? "someone"} asked · ${fmtWhen(opener.createdAt)}` : null}
            </p>
            <form action={archiveThreadAction.bind(null, thread.id)}>
              <Button type="submit" variant="ghost" size="sm">Delete</Button>
            </form>
          </div>
        </div>
        {about && <AskAbout about={about} />}
      </div>

      {!thread.saved && (
        <Callout tone="warning" className="mb-4 flex flex-wrap items-center justify-between gap-2" testId="ask-temporary-note">
          <span>Not saved: this conversation is deleted a day after its last question.</span>
          <form action={keepThreadAction.bind(null, thread.id)}>
            <Button type="submit" variant="quiet" size="sm">Keep it</Button>
          </form>
        </Callout>
      )}

      <div className="space-y-5">
        {messages.map((m) =>
          m === opener ? null : m.role === "user" ? (
            <div key={m.id} className="ml-auto max-w-[90%] rounded-xl bg-accent-soft px-3.5 py-2 sm:max-w-[80%]" data-testid="ask-question">
              <p className="whitespace-pre-wrap text-body text-ink [overflow-wrap:anywhere]">{m.text}</p>
              <p className="mt-0.5 text-micro text-ink-muted">{names.get(m.createdBy ?? "") ?? "someone"} · {fmtWhen(m.createdAt)}</p>
            </div>
          ) : (
            <Card key={m.id} className="p-4 sm:p-5">
              <Answer message={m} subject={thread.title} home={account?.name ?? null} />
            </Card>
          ),
        )}
        {live && <AskLive key={live.id} run={live} startedAt={run?.started_at} />}
        {/* What Ask drafted to send: never sent by it, waiting for you (DECISIONS #103). */}
        {!live && askDrafts > 0 && (
          <Link href="/inbox?kind=send" className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-accent-soft px-3 text-label font-semibold text-accent hover:underline" data-testid="ask-draft-waiting">
            {askDrafts === 1 ? "A draft is waiting" : `${askDrafts} drafts are waiting`}: review and send →
          </Link>
        )}
        {/* What the last answer suggests asking next; only the last, so the
            page does not fill with questions already moved past. */}
        {!live && last?.role === "assistant" && last.followUps.length > 0 && (
          <div>
            <p className="mb-1.5 text-micro font-semibold uppercase tracking-wide text-ink-muted">Ask next</p>
            <AskChips questions={last.followUps} threadId={thread.id} testId="ask-next" />
          </div>
        )}
      </div>

      <div className="mt-6">
        <AskBox threadId={thread.id} busy={run?.status === "running"} placeholder="Ask a follow-up" />
      </div>
    </Page>
  );
}
