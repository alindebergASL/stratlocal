import Link from "next/link";
import type { Sentence } from "@/lib/accounts/whereItStands";
import type { SinceLooked } from "@/lib/accounts/sinceLooked";
import { originLabel } from "@/lib/queries/today";
import { relativeDays } from "@/lib/format";
import { ChangeSummary, Section } from "./ui";
import { QuickAccept } from "@/app/inbox/InboxControls";

// Where the account stands, in two or three counted sentences, each clause a
// link to its record (lib/accounts/whereItStands.ts).
// `bare`: inside the written version's "show the counts", without its own landmark.
export function WhereItStands({ sentences, bare }: { sentences: Sentence[]; bare?: boolean }) {
  const Tag = bare ? "div" : "section";
  return (
    <Tag {...(bare ? { "data-testid": "where-it-stands-counted" } : { id: "where-it-stands", "aria-label": "Where it stands", "data-testid": "where-it-stands" })} className={bare ? "text-label leading-relaxed text-ink" : "mb-6 max-w-3xl text-lead leading-relaxed text-ink"}>
      {sentences.map((s, i) => (
        <span key={i}>
          {s.map((c, j) =>
            c.href ? (
              <Link key={j} href={c.href} className="font-semibold text-ink-strong underline decoration-line-strong underline-offset-4 hover:text-accent hover:decoration-accent">
                {c.text}
              </Link>
            ) : (
              <span key={j}>{c.text}</span>
            ),
          )}
          {i < sentences.length - 1 ? " " : ""}
        </span>
      ))}
    </Tag>
  );
}

// What happened since your last visit, and what of this account is waiting
// on a decision, with the quick ones acceptable right here.
export function AccountSince({ view, accountId, labels, names, now }: { view: SinceLooked; accountId: string; labels: Record<string, string>; names: Map<string, string>; now: number }) {
  const { changes, findings, waiting } = view;
  const waitingAny = !!waiting.changes || waiting.research.length > 0;
  if (view.since === null && !waitingAny) return null;
  const nothing = changes.length === 0 && findings.length === 0 && view.mail.length === 0;
  return (
    <Section id="since" title="Since you last looked" aside={view.since ? <span className="text-micro">{relativeDays(view.since, now)}</span> : undefined}>
      <div data-testid="account-since">
        {waitingAny && (
          <ul className="mb-3 space-y-2" data-testid="since-waiting">
            {waiting.changes && (
              <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-accent-soft/60 px-3 py-2 text-label">
                <span className="text-ink">
                  <strong className="tabular-nums">{waiting.changes.total}</strong> change{waiting.changes.total === 1 ? "" : "s"} waiting, from {waiting.changes.sources.join(" and ")}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {waiting.changes.quick > 0 && <QuickAccept accountId={accountId} count={waiting.changes.quick} />}
                  <Link href={`/inbox?kind=changes&account=${accountId}`} className="inline-flex min-h-11 items-center rounded-lg bg-ink px-3 text-label font-semibold text-ink-invert hover:bg-ink-strong sm:min-h-9" data-testid="since-review">
                    Review
                  </Link>
                </span>
              </li>
            )}
            {waiting.research.map((r) => (
              <li key={r.noteId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-accent-soft/60 px-3 py-2 text-label">
                <span className="min-w-0 text-ink [overflow-wrap:anywhere]">Research to keep: {r.title} · {r.findings} finding{r.findings === 1 ? "" : "s"}</span>
                <Link href={`/accounts/${accountId}/research#research-review`} className="font-semibold text-accent hover:underline">Review →</Link>
              </li>
            ))}
          </ul>
        )}
        {view.since !== null && nothing && <p className="text-label text-ink-muted" data-testid="since-nothing">Nothing new on the records since then.</p>}
        {changes.length > 0 && (
          <ul className="divide-y divide-line" data-testid="since-changes">
            {changes.map((c) => (
              <li key={c.kind === "batch" ? c.batchId : `${c.entityType}-${c.entityId}-${c.at}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 text-label">
                <span className="min-w-0">
                  {c.kind === "batch" ? (
                    <span className="text-ink">
                      {originLabel(c.origin)} accepted · {c.fields} change{c.fields === 1 ? "" : "s"} across {c.records} record{c.records === 1 ? "" : "s"}
                    </span>
                  ) : (
                    <>
                      <span className="font-medium text-ink">{labels[c.entityId] ?? c.entityType.replace(/_/g, " ")}</span>{" "}
                      <ChangeSummary changes={c.changes} max={2} labels={(x) => labels[x]} />
                    </>
                  )}
                </span>
                <span className="text-micro text-ink-muted">{c.actors.map((a) => names.get(a) ?? "Someone").join(", ") || "Import"}</span>
              </li>
            ))}
          </ul>
        )}
        {findings.length > 0 && (
          <ul className="mt-2 space-y-1 text-label" data-testid="since-findings">
            {findings.map((f) => (
              <li key={`${f.noteId}-${f.index}`} className="min-w-0">
                <span className="text-micro font-semibold uppercase tracking-[0.06em] text-accent">Research kept</span>{" "}
                <Link href={`/accounts/${accountId}/research?note=${f.noteId}&finding=${f.index}#finding-${f.noteId}-${f.index}`} className="text-ink hover:text-accent hover:underline [overflow-wrap:anywhere]">
                  {f.finding.text.length > 160 ? `${f.finding.text.slice(0, 157)}…` : f.finding.text}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {view.mail.length > 0 && (
          <ul className="mt-2 space-y-1 text-label" data-testid="since-mail">
            {view.mail.map((m) => (
              <li key={m.id} className="min-w-0">
                <span className="text-micro font-semibold uppercase tracking-[0.06em] text-accent">Email</span>{" "}
                <Link href={`/accounts/${accountId}/email`} className="text-ink hover:text-accent hover:underline [overflow-wrap:anywhere]">{m.subject}</Link>
                <span className="text-micro text-ink-muted"> · {m.from}</span>
              </li>
            ))}
          </ul>
        )}
        {changes.length > 0 && (
          <p className="mt-2 text-micro"><Link href={`/activity?account=${accountId}`} className="font-semibold text-accent hover:underline">Everything that changed here →</Link></p>
        )}
      </div>
    </Section>
  );
}
