import Link from "next/link";
import { listMovement, listStalled, quarterRollUp, type Movement, type MovementKind } from "@/lib/queries/movement";
import type { OwnerScope } from "@/lib/queries/owner";
import { currentFiscalQuarter } from "@/lib/fiscal";
import { fmtDay, fmtMoney, fmtMoneyShort, relativeDays, stageText } from "@/lib/format";
import { AccountLink, Chip, Empty, Eyebrow, Section, Stat } from "@/components/ui";
import type { Tone } from "@/lib/tone";

// The pipeline's memory.
//
// Everything on this screen is read from change_log, which has held every
// deal's close date, stage, value and status in full fidelity since the first
// commit and which nothing had ever read by field. No snapshot table, no
// nightly job, no migration — the data was always there and the question just
// had no query behind it.
//
// The question is the one a weekly review actually opens with: what moved
// since last week, what slipped out of this quarter, and which deals has
// nobody touched at all.

// Per group, like the pipeline's own per-quarter cap and for the same reason.
//
// This list has no natural bound: a ninety-day window taken after a big report
// import can hold a row per deal on file. Rendered uncapped against the
// committed fixture it was 1.1 MB, which is exactly the shape DECISIONS #20
// exists to stop — and the tail is not put behind a <details>, because that
// hides the rows and ships them anyway.
const PER_GROUP = 12;

const KIND_LABEL: Record<MovementKind, string> = {
  pushed_out: "Pushed out",
  pulled_in: "Pulled in",
  date_moved: "Date moved",
  stage_up: "Stage up",
  stage_down: "Stage down",
  value_up: "Value up",
  value_down: "Value down",
  won: "Won",
  lost: "Lost",
  reopened: "Reopened",
  new: "New",
};

const KIND_TONE: Record<MovementKind, Tone> = {
  pushed_out: "danger",
  pulled_in: "positive",
  date_moved: "neutral",
  stage_up: "positive",
  stage_down: "warning",
  value_up: "positive",
  value_down: "warning",
  won: "positive",
  lost: "danger",
  reopened: "warning",
  new: "accent",
};

// One word for the whole group, derived from the tone rather than restated
// beside it — the first version spelled the two out separately and promptly
// disagreed with itself, calling a value drop "better".
const TONE_WORD: Record<Tone, string> = {
  danger: "worse",
  warning: "worse",
  positive: "better",
  accent: "news",
  neutral: "news",
  info: "news",
};

// Read order: what went wrong first. A review that opens with the good news is
// a review that runs out of time before reaching the slips.
const ORDER: MovementKind[] = [
  "pushed_out",
  "value_down",
  "stage_down",
  "lost",
  "pulled_in",
  "stage_up",
  "value_up",
  "won",
  "reopened",
  "date_moved",
  "new",
];

function detail(m: Movement): string {
  if (m.kind === "pushed_out" || m.kind === "pulled_in") return `${m.fromQuarter ?? "no quarter"} → ${m.toQuarter ?? "no quarter"}`;
  if (m.kind === "date_moved") return `${fmtDay(m.from)} → ${fmtDay(m.to)}`;
  if (m.kind === "value_up" || m.kind === "value_down") {
    const delta = m.deltaUsd ?? 0;
    return `${fmtMoney(Number(m.from))} → ${fmtMoney(Number(m.to))} (${delta > 0 ? "+" : "−"}${fmtMoneyShort(Math.abs(delta)).slice(1)})`;
  }
  if (m.kind === "stage_up" || m.kind === "stage_down") return `${stageText(Number(m.from), null)} → ${stageText(Number(m.to), null)}`;
  if (m.kind === "new") return "added";
  return `${m.from ?? "—"} → ${m.to ?? "—"}`;
}

export function MovementView({
  days,
  accountId,
  scope,
  handEditsOnly,
  showAll,
  allHref,
  names,
}: {
  days: number;
  accountId?: string | null;
  /** Whose accounts, if the page is narrowed to one of them. */
  scope?: OwnerScope;
  handEditsOnly: boolean;
  showAll: boolean;
  allHref: string;
  /** user id → display name, for saying who moved it. */
  names: Map<string, string>;
}) {
  const since = Date.now() - days * 86_400_000;
  const quarter = currentFiscalQuarter();
  const moves = listMovement(since, { accountId, handEditsOnly, scope });
  // The roll-up is handed the rows the list already read, so the totals and
  // the rows are the same set by construction rather than by coincidence —
  // which is also what keeps the owner filter from applying to one and not
  // the other.
  const roll = quarterRollUp(since, quarter, { accountId, handEditsOnly, scope }, moves);
  const stalled = listStalled(since, quarter, { accountId, scope });

  const groups = ORDER.map((kind) => ({ kind, rows: moves.filter((m) => m.kind === kind) })).filter((g) => g.rows.length > 0);

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-4 rounded-xl border border-line bg-surface p-4 shadow-card sm:grid-cols-5 sm:p-5">
        {/* `in now` comes from the deals table, because that is the truth. The
            four movement figures come from the same rows the list below
            renders, so a total here can never disagree with what is under it.
            Deliberately not "what the quarter was worth a week ago":
            reconstructing that means replaying every deal backwards, and a
            number nobody can check is worse than one they can. */}
        <Stat label={`In ${quarter.label} now`} value={fmtMoneyShort(roll.inNowUsd)} sub={`${roll.inNowCount} deal${roll.inNowCount === 1 ? "" : "s"}`} tone="accent" />
        <Stat label="Pulled in" value={fmtMoneyShort(roll.pulledInUsd)} />
        <Stat label="Pushed out" value={fmtMoneyShort(roll.pushedOutUsd)} tone={roll.pushedOutUsd > 0 ? "accent" : undefined} />
        <Stat label="Won" value={fmtMoneyShort(roll.wonUsd)} />
        <Stat label="Lost" value={fmtMoneyShort(roll.lostUsd)} />
      </div>

      {groups.length === 0 ? (
        <Section title="What moved">
          <Empty>
            Nothing moved in the last {days} day{days === 1 ? "" : "s"}
            {handEditsOnly ? " that one of you typed" : ""}. Widen the window, or look at what is stalled below.
          </Empty>
        </Section>
      ) : (
        groups.map((g) => (
          <Section
            key={g.kind}
            title={KIND_LABEL[g.kind]}
            aside={
              <>
                <Chip tone={KIND_TONE[g.kind]}>{TONE_WORD[KIND_TONE[g.kind]]}</Chip>
                <span className="font-semibold tabular-nums text-ink">{fmtMoneyShort(g.rows.reduce((s, m) => s + (m.tcvUsd ?? 0), 0))}</span>
                <span>
                  {g.rows.length} deal{g.rows.length === 1 ? "" : "s"}
                </span>
              </>
            }
          >
            <ul className="divide-y divide-line">
              {(showAll ? g.rows : g.rows.slice(0, PER_GROUP)).map((m) => (
                <li key={`${m.kind}-${m.dealId}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5">
                  <span className="min-w-0 flex-1">
                    <Link
                      href={`/accounts/${m.accountId}/deals/${encodeURIComponent(m.dealId)}`}
                      className="font-medium text-ink hover:text-accent hover:underline"
                    >
                      {m.name}
                    </Link>
                    <span className="ml-2 text-micro text-ink-muted">
                      <AccountLink id={m.accountId} name={m.accountName} className="text-micro font-normal text-ink-muted" />
                      {" · "}
                      {detail(m)}
                    </span>
                  </span>
                  <span className="flex items-baseline gap-2 text-micro text-ink-muted">
                    <span className="font-semibold tabular-nums text-ink">{fmtMoney(m.tcvUsd)}</span>
                    {/* Who, and whether it was a decision or the CRM
                        restating itself. Without this, "twelve deals slipped"
                        is often really "the report import ran on Tuesday". */}
                    <span title={m.fromImport ? "Applied from an accepted report import" : undefined}>
                      {m.fromImport ? "from a report" : (names.get(m.actorUserId ?? "") ?? "by hand")}
                    </span>
                    <span className="tabular-nums">{relativeDays(m.at)}</span>
                  </span>
                </li>
              ))}
            </ul>
            {!showAll && g.rows.length > PER_GROUP && (
              <Link href={allHref} className="mt-3 inline-block text-label text-accent hover:underline">
                Show the other {g.rows.length - PER_GROUP} under {KIND_LABEL[g.kind].toLowerCase()}
              </Link>
            )}
          </Section>
        ))
      )}

      {/* The inverse, and the one that costs a quarter: every other signal in
          this app fires on something happening. */}
      <Section
        title="Nobody has touched these"
        aside={
          <>
            <span className="font-semibold tabular-nums text-ink">{fmtMoneyShort(stalled.reduce((s, d) => s + (d.tcvUsd ?? 0), 0))}</span>
            <span>
              {stalled.length} deal{stalled.length === 1 ? "" : "s"}
            </span>
          </>
        }
      >
        <Eyebrow>
          Open, closing in {quarter.label}, and nothing about them has changed in {days} day{days === 1 ? "" : "s"}
        </Eyebrow>
        {stalled.length === 0 ? (
          <Empty>Everything closing this quarter has been touched. Rare, and worth noticing.</Empty>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {(showAll ? stalled : stalled.slice(0, PER_GROUP)).map((d) => (
              <li key={d.dealId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5">
                <span className="min-w-0 flex-1">
                  <Link
                    href={`/accounts/${d.accountId}/deals/${encodeURIComponent(d.dealId)}`}
                    className="font-medium text-ink hover:text-accent hover:underline"
                  >
                    {d.name}
                  </Link>
                  <span className="ml-2 text-micro text-ink-muted">
                    <AccountLink id={d.accountId} name={d.accountName} className="text-micro font-normal text-ink-muted" />
                    {" · closes "}
                    {fmtDay(d.closeDate)}
                    {d.stage ? ` · ${stageText(d.stage, null)}` : ""}
                  </span>
                </span>
                <span className="flex items-baseline gap-2 text-micro text-ink-muted">
                  <span className="font-semibold tabular-nums text-ink">{fmtMoney(d.tcvUsd)}</span>
                  <Chip tone="warning">last touched {relativeDays(d.lastTouched)}</Chip>
                </span>
              </li>
            ))}
          </ul>
        )}
        {!showAll && stalled.length > PER_GROUP && (
          <Link href={allHref} className="mt-3 inline-block text-label text-accent hover:underline">
            Show the other {stalled.length - PER_GROUP}
          </Link>
        )}
      </Section>
    </>
  );
}
