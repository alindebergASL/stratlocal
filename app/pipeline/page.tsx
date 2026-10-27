import Link from "next/link";
import { dealCommitmentCounts, followUpLine } from "@/lib/pipelineCommitments";
import { needsNextStep } from "@/lib/deals/nextStep";
import { requirePageUser } from "@/lib/auth";
import { listAccountChoices, listDealOwners, listOpenDeals, type PipelineDeal } from "@/lib/queries/accounts";
import { ownerNames } from "@/lib/dealOwners";
import { currentFiscalQuarter, keyFromLabel, quarterLabel } from "@/lib/fiscal";
import { crmIdText, fmtDay, fmtMoney, fmtMoneyShort, STAGE_LABELS, stageText } from "@/lib/format";
import { Page } from "@/components/Nav";
import { Button, Chip, Empty, PageHeader, Section, stageTone } from "@/components/ui";
import { DealQuickEdit } from "@/components/DealQuickEdit";
import { MovementView } from "./Movement";
import { listMovement } from "@/lib/queries/movement";
import { accountSignals } from "@/lib/queries/accountSignals";
import { SignalChips } from "@/components/Signal";
import { todayISO } from "@/lib/clock";
import { listUsers } from "@/lib/auth";
import { OwnerTabs } from "@/components/OwnerTabs";
import { ownerLabels, parseOwnerScope, type OwnerFilter } from "@/lib/queries/owner";

export const dynamic = "force-dynamic";

type Search = { stage?: string; owner?: string; account?: string; fq?: string; all?: string; status?: string; moved?: string; hand?: string; who?: string };

// What each status filter is called on screen, and what a group of them is.
// "Open" is the default and stays unwritten in the copy; anything else is
// named, because a page that silently shows lost deals under the word
// "Pipeline" would be worse than not having the filter.
const STATUS_OPTIONS = [
  { value: "open", label: "Open", noun: "open deal" },
  { value: "won", label: "Won", noun: "won deal" },
  { value: "lost", label: "Lost", noun: "lost deal" },
  { value: "closed", label: "Won and lost", noun: "closed deal" },
  { value: "all", label: "Every deal", noun: "deal" },
] as const;

type StatusValue = (typeof STATUS_OPTIONS)[number]["value"];

function statusOf(raw: string | undefined): StatusValue {
  return (STATUS_OPTIONS.find((o) => o.value === raw)?.value ?? "open") as StatusValue;
}

// Same grid-not-table treatment as the account page's deals, so one row reads
// on a laptop and stacks on a phone.
const COLS = "sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_auto_auto_auto_minmax(0,1.4fr)]";

// Per quarter, not per page: a quarter is the unit a review walks.
//
// This rendered every open deal, each with its own quick-edit client
// component, and at a year of use that was 1.6 MB of HTML on the page most
// likely to be opened on a phone. The tail is not put behind a <details> —
// that hides the rows and still ships them, and the bytes are the problem —
// so it is simply not rendered, and ?all=1 renders it.
const DEALS_PER_QUARTER = 15;

// How far back "what moved" looks. A week is the review cadence; the others
// are for coming back from leave and for the end of a quarter.
const MOVED_WINDOWS = [7, 14, 30, 90] as const;

export default async function PipelinePage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  // The same page, asked a different question. It lives here rather than on a
  // route of its own because the weekly review already happens here and the
  // account filter is already here.
  const movedDays = sp.moved ? (MOVED_WINDOWS as readonly number[]).find((d) => String(d) === sp.moved) : undefined;
  const users = listUsers();
  const names = new Map(users.map((u) => [u.id, u.display_name]));
  // Whose accounts the deals are on. `d.owner` in the filter row below is a
  // different thing entirely: free text the CRM report writes, read through
  // the spellings a person confirmed as one name (/pipeline/owners).
  const scope = parseOwnerScope(sp.who, user.id);
  const whoParam: Record<string, string> = scope.filter === "all" ? {} : { who: scope.filter };
  const movedHref = (days: number, who: OwnerFilter = scope.filter) =>
    `/pipeline?${new URLSearchParams({
      ...(sp.account ? { account: sp.account } : {}),
      ...(sp.hand ? { hand: sp.hand } : {}),
      ...(who === "all" ? {} : { who }),
      moved: String(days),
    }).toString()}`;

  const listQuery = new URLSearchParams({ ...(sp.account ? { account: sp.account } : {}), ...whoParam }).toString();
  const listHref = `/pipeline${listQuery ? `?${listQuery}` : ""}`;

  if (movedDays !== undefined) {
    const handEditsOnly = sp.hand === "1";
    return (
      <Page user={user}>
        <PageHeader
          title="What moved"
          sub={
            <>
              Read from the record of every change, over the last {movedDays} days
              {sp.account ? ` · ${listAccountChoices().find((a) => a.id === sp.account)?.name ?? "one account"}` : " · every account"}
            </>
          }
        />
        <Section title="Window">
          <div className="flex flex-wrap items-center gap-3">
            {MOVED_WINDOWS.map((d) => (
              <Link
                key={d}
                href={movedHref(d)}
                className={`text-label hover:underline ${d === movedDays ? "font-semibold text-ink" : "text-accent"}`}
              >
                {d} days
              </Link>
            ))}
            {/* A report import restating what the CRM already said is not one
                of you deciding something, and the two call for completely
                different reactions. */}
            <Link
              href={`/pipeline?${new URLSearchParams({ ...(sp.account ? { account: sp.account } : {}), moved: String(movedDays), ...(sp.hand === "1" ? {} : { hand: "1" }) }).toString()}`}
              className="text-label text-accent hover:underline"
            >
              {sp.hand === "1" ? "Include what came from reports" : "Only what one of us typed"}
            </Link>
            <Link href={listHref} className="text-label text-accent hover:underline">
              Back to the list
            </Link>
          </div>
          {users.length > 1 && (
            <div className="mt-3">
              <OwnerTabs
                current={scope.filter}
                labels={ownerLabels(users, user.id)}
                href={(f) => movedHref(movedDays, f)}
                testId="moved-owner"
              />
            </div>
          )}
        </Section>
        <MovementView
          days={movedDays}
          accountId={sp.account || null}
          scope={scope}
          handEditsOnly={handEditsOnly}
          showAll={sp.all === "1"}
          allHref={`${movedHref(movedDays)}&all=1`}
          names={names}
        />
      </Page>
    );
  }

  const stage = sp.stage ? Number(sp.stage) : undefined;
  const status = statusOf(sp.status);
  const noun = STATUS_OPTIONS.find((o) => o.value === status)!.noun;
  const filtered = Boolean(sp.stage || sp.owner || sp.account || sp.fq || (sp.status && status !== "open") || scope.filter !== "all");
  const all = listOpenDeals({
    stage: stage && stage >= 1 && stage <= 6 ? stage : undefined,
    owner: sp.owner || undefined,
    accountId: sp.account || undefined,
    status,
    scope,
  });
  // The quarter filter is the one a review actually starts with — "walk what
  // is closing this quarter" — and it was the one filter missing, so every
  // review scrolled past the other quarters first. Filtered here rather than
  // in SQL because fq_key is derived, and the list of quarters to offer has
  // to come from the unfiltered set or choosing one would empty the dropdown.
  const quarters = [...new Set(all.map((d) => quarterLabel(d.fiscal_quarter)).filter((q): q is string => Boolean(q)))].sort(
    (a, b) => (keyFromLabel(a) ?? Number.MAX_SAFE_INTEGER) - (keyFromLabel(b) ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b),
  );
  const wantedQuarter = sp.fq ? quarterLabel(sp.fq) : null;
  const deals = wantedQuarter ? all.filter((d) => quarterLabel(d.fiscal_quarter) === wantedQuarter) : all;
  const commitmentCounts = dealCommitmentCounts(deals);
  // Deliberately unscoped, and deliberately not listAccountSummaries: the
  // picker must be able to reach an account the owner filter is hiding, and
  // the summary query runs five correlated subqueries per account to produce
  // figures a dropdown does not show — the same waste the comment on
  // listAccountChoices records about the header.
  const accounts = listAccountChoices();
  const owners = listDealOwners();
  const ownerName = ownerNames().nameOf;
  const current = currentFiscalQuarter();

  const groups = new Map<string, PipelineDeal[]>();
  for (const d of deals) {
    const key = quarterLabel(d.fiscal_quarter) ?? "No quarter";
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  const ordered = [...groups.entries()].sort((a, b) => {
    const ka = a[1][0]?.fq_key ?? Number.MAX_SAFE_INTEGER;
    const kb = b[1][0]?.fq_key ?? Number.MAX_SAFE_INTEGER;
    return ka - kb;
  });
  const total = deals.reduce((s, d) => s + (d.tcv_usd ?? 0), 0);
  const showAll = sp.all === "1";
  // One line per quarter, read before any row: what it is worth, how many
  // deals, and how many of them have an agreed next step.
  const quarterSummary = ordered.map(([label, rows]) => ({
    label,
    anchor: `q-${label.replace(/[^A-Za-z0-9]+/g, "")}`,
    usd: rows.reduce((s, d) => s + (d.tcv_usd ?? 0), 0),
    count: rows.length,
    withNext: rows.filter((d) => !needsNextStep(d, todayISO())).length,
  }));
  // Preserved across the link, so "show all" does not also clear the filters
  // someone just set.
  const carried: Record<string, string> = {
    ...whoParam,
    ...(sp.stage ? { stage: sp.stage } : {}),
    ...(sp.owner ? { owner: sp.owner } : {}),
    ...(sp.account ? { account: sp.account } : {}),
    ...(sp.fq ? { fq: sp.fq } : {}),
    ...(status !== "open" ? { status } : {}),
  };
  const filterParams = new URLSearchParams(carried).toString();
  const exportQuery = filterParams ? `?${filterParams}` : "";
  const allHref = `/pipeline?${new URLSearchParams({ ...carried, all: "1" }).toString()}`;

  // What moved is the film to this photograph: said in the header, with a
  // count, rather than only as a link among the filters.
  const movedThisWeek = new Set(listMovement(Date.now() - 7 * 86400000, { scope }).map((m) => m.dealId)).size;
  // The accounts on the page that have a reason to act, to mark beside them.
  const accountSig = accountSignals([...new Set(deals.map((d) => d.account_id))]);
  const today = todayISO();

  // A wide table: on a very wide screen it takes the room
  // beside the nav instead of sitting in a narrow column in the middle of it.
  return (
    <Page user={user} main="max-w-6xl min-[1800px]:max-w-[100rem]">
      <PageHeader
        title="Pipeline"
        sub={
          <>
            <span className="font-semibold tabular-nums text-ink">{fmtMoneyShort(total)}</span> across {deals.length} {noun}
            {deals.length === 1 ? "" : "s"} · {sp.fq ? `matching ${sp.fq}` : "all matching quarters"}. Current quarter: {current.label}.
            {movedThisWeek > 0 && (
              <>
                {" "}
                <Link href={movedHref(7)} className="font-semibold text-accent hover:underline" data-testid="pipeline-moved-count">
                  {movedThisWeek} deal{movedThisWeek === 1 ? "" : "s"} moved this week →
                </Link>
              </>
            )}
          </>
        }
      />

      {/* One line, not a card: the filters are how you look at the pipeline,
          not something to read. */}
      <div className="mb-6 rounded-xl border border-line bg-surface px-3 py-2.5" data-testid="pipeline-filters">
        {users.length > 1 && (
          <div className="mb-2">
            <OwnerTabs
              current={scope.filter}
              labels={ownerLabels(users, user.id)}
              href={(f) => {
                // Everything else the page is filtered by is kept; only the
                // owner changes. `carried` already holds the current `who`,
                // so it is replaced rather than appended.
                const q = new URLSearchParams(carried);
                q.delete("who");
                if (f !== "all") q.set("who", f);
                const qs = q.toString();
                return `/pipeline${qs ? `?${qs}` : ""}`;
              }}
              testId="pipeline-owner"
            />
          </div>
        )}
        <form method="get" className="flex flex-wrap items-center gap-2">
          {/* The filter row is a GET form, so anything not in it is dropped on
              Apply. `who` lives in the URL rather than as a select because it
              is a set of links above, not a dropdown. */}
          {scope.filter !== "all" && <input type="hidden" name="who" value={scope.filter} />}
          <FilterSelect label="Stage">
            <select name="stage" defaultValue={sp.stage ?? ""} className={FILTER_SELECT}>
              <option value="">all</option>
              {[1, 2, 3, 4, 5, 6].map((s) => (
                <option key={s} value={s}>
                  {s} · {STAGE_LABELS[s]}
                </option>
              ))}
            </select>
          </FilterSelect>
          <FilterSelect label="Owner">
            <select name="owner" defaultValue={sp.owner ?? ""} className={FILTER_SELECT}>
              <option value="">all</option>
              {/* A link from before owners were matched exactly may name a
                  fragment ("Jam") that is nobody's name now. Show it rather
                  than letting the select read "all" over an empty list. */}
              {sp.owner && !owners.includes(sp.owner) && <option value={sp.owner}>{sp.owner} · no owner by this name</option>}
              {owners.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </FilterSelect>
          <FilterSelect label="Quarter">
            <select name="fq" defaultValue={sp.fq ?? ""} className={FILTER_SELECT}>
              <option value="">all</option>
              {quarters.map((q) => (
                <option key={q} value={q}>
                  {q}
                  {q === current.label ? " · this one" : ""}
                </option>
              ))}
            </select>
          </FilterSelect>
          {/* Won and lost were unreachable from anywhere but an account page,
              where the list is capped at ten. Marking a deal won removed it
              from the only cross-account view of a deal there is. */}
          <FilterSelect label="Status">
            <select name="status" defaultValue={status} className={FILTER_SELECT}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FilterSelect>
          <FilterSelect label="Account">
            <select name="account" defaultValue={sp.account ?? ""} className={FILTER_SELECT}>
              <option value="">all</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </FilterSelect>
          <Button type="submit" variant="quiet" size="sm" data-testid="pipeline-apply">
            Apply
          </Button>
          {sp.fq !== current.label && quarters.includes(current.label) && (
            <Link
              href={`/pipeline?${new URLSearchParams({ ...whoParam, fq: current.label }).toString()}`}
              className="text-label text-accent hover:underline"
            >
              Just {current.label}
            </Link>
          )}
          {filtered && (
            <Link href="/pipeline" className="text-label text-accent hover:underline">
              Clear
            </Link>
          )}
          <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
          {/* The same parameters, so this exports what is on the screen rather
              than everything — which is what "send me your Q3 pipeline"
              actually means. */}
          <a href={`/api/export/pipeline.csv${exportQuery}`} className="text-label text-accent hover:underline" data-testid="pipeline-export">
            Export CSV
          </a>
          {/* Which spellings of an owner are one person: the filter above
              offers one entry per person once that is said. */}
          <Link href="/pipeline/owners" className="text-label text-accent hover:underline" data-testid="pipeline-owners">
            Owners
          </Link>
          {/* The pipeline is a photograph; this is the film. */}
          <Link href={movedHref(7)} className="text-label font-semibold text-accent hover:underline" data-testid="pipeline-moved">
            What moved
          </Link>
          </span>
        </form>
      </div>

      {quarterSummary.length > 1 && (
        <nav aria-label="Quarters" className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2" data-testid="pipeline-quarters">
          {quarterSummary.map((q) => (
            <a key={q.label} href={`#${q.anchor}`} className={`rounded-lg border bg-surface px-3 py-2 hover:border-accent ${q.label === current.label ? "border-accent-line" : "border-line"}`}>
              <span className="block text-micro font-semibold uppercase tracking-[0.06em] text-ink-muted">{q.label}</span>
              <span className="block font-display text-heading font-bold tabular-nums text-ink-strong">{fmtMoneyShort(q.usd)}</span>
              <span className="block text-micro tabular-nums text-ink-muted">
                {q.count} deal{q.count === 1 ? "" : "s"} · <span className={q.withNext < q.count ? "text-warning" : ""}>{q.withNext} with a next step</span>
              </span>
            </a>
          ))}
        </nav>
      )}

      {deals.length === 0 ? (
        <Section title="Deals">
          <Empty>{filtered ? `No ${noun}s match these filters.` : "No open deals yet. Import a report or add a deal to an account."}</Empty>
        </Section>
      ) : (
        ordered.map(([label, rows]) => (
          <Section
            key={label}
            id={`q-${label.replace(/[^A-Za-z0-9]+/g, "")}`}
            title={label}
            aside={
              <>
                {label === current.label && <Chip tone="accent">this quarter</Chip>}
                <span className="font-semibold tabular-nums text-ink">{fmtMoneyShort(rows.reduce((s, d) => s + (d.tcv_usd ?? 0), 0))}</span>
                <span>
                  {rows.length} deal{rows.length === 1 ? "" : "s"}
                </span>
                <span data-testid="quarter-next-steps">
                  {rows.filter((d) => !needsNextStep(d, todayISO())).length} of {rows.length} with a next step or none needed
                </span>
              </>
            }
          >
            <div className={`hidden gap-x-4 border-b border-line pb-2 text-micro font-semibold uppercase tracking-[0.06em] text-ink-muted sm:grid ${COLS}`}>
              <div>Deal</div>
              <div>Account</div>
              <div>Stage</div>
              <div>Close</div>
              <div className="text-right">TCV</div>
              <div>Next step</div>
            </div>
            <ul className="divide-y divide-line">
              {(showAll ? rows : rows.slice(0, DEALS_PER_QUARTER)).map((d) => (
                <li key={d.deal_id} className={`grid gap-x-4 gap-y-1.5 py-3 sm:items-baseline ${COLS}`}>
                  {/* The deal first: it is what the row is about. The
                      account was the boldest thing on every row, and the
                      deal read as its footnote. */}
                  <div className="min-w-0">
                    <Link href={`/accounts/${d.account_id}/deals/${encodeURIComponent(d.deal_id)}`} className="font-semibold text-ink-strong hover:text-accent hover:underline">
                      {d.name}
                    </Link>
                    <div className="text-micro tabular-nums text-ink-muted">
                      {crmIdText(d.deal_id) ?? "no CRM id yet"}
                      {ownerName(d.owner) ? ` · ${ownerName(d.owner)}` : ""}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <Link href={`/accounts/${d.account_id}`} className="text-label text-ink-muted hover:text-accent hover:underline">{d.account_name}</Link>
                    {accountSig.get(d.account_id)?.reason && <SignalChips accountId={d.account_id} signals={accountSig.get(d.account_id)!} only={["reason"]} className="mt-0.5" />}
                  </div>
                  {/* On a phone, stage, close and value are one line of the
                      card; from sm they are three columns of the row. */}
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 sm:contents">
                    <div>
                      <Chip tone={stageTone(d.stage)}>{stageText(d.stage, d.stage_label)}</Chip>
                    </div>
                    {/* An open deal past its close date is the one warning a
                        row carries. */}
                    <div className={`whitespace-nowrap text-label tabular-nums ${d.status === "open" && d.close_date && d.close_date < today ? "font-semibold text-warning" : ""}`} data-past-close={d.status === "open" && d.close_date && d.close_date < today ? "" : undefined}>
                      {fmtDay(d.close_date)}
                      {d.status === "open" && d.close_date && d.close_date < today && <span className="ml-1 text-micro">past</span>}
                    </div>
                    <div className="whitespace-nowrap font-semibold tabular-nums sm:text-right">{fmtMoney(d.tcv_usd)}</div>
                  </div>
                  <div className="min-w-0">
                    <DealQuickEdit
                      accountId={d.account_id}
                      dealId={d.deal_id}
                      stage={d.stage}
                      nextStep={d.next_step}
                      status={d.status}
                      closeDate={d.close_date}
                      tcvUsd={d.tcv_usd}
                      version={d.updated_at}
                      linked={(() => {
                        const label = followUpLine(commitmentCounts.get(d.deal_id));
                        return label ? { label, href: `/accounts/${d.account_id}/deals/${encodeURIComponent(d.deal_id)}#commitments` } : null;
                      })()}
                    />
                  </div>
                </li>
              ))}
            </ul>
            {!showAll && rows.length > DEALS_PER_QUARTER && (
              <Link href={allHref} className="mt-3 inline-block text-label text-accent hover:underline">
                Show the other {rows.length - DEALS_PER_QUARTER} in {label}
              </Link>
            )}
          </Section>
        ))
      )}
    </Page>
  );
}

const FILTER_SELECT = "min-h-11 min-w-0 max-w-[14rem] cursor-pointer truncate bg-transparent pr-1 text-base font-medium text-ink focus:outline-none sm:min-h-9 sm:text-label";

// A filter as a small labelled pill: the label stays visible, the select
// takes only the room its value needs.
function FilterSelect({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-line bg-surface pl-2.5 focus-within:ring-2 focus-within:ring-accent">
      <span className="shrink-0 text-micro font-semibold uppercase tracking-[0.06em] text-ink-muted">{label}</span>
      {children}
    </label>
  );
}
