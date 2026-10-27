// What moved, what slipped, and what nobody has touched.
//
// The pipeline had no memory. `listOpenDeals` is a single SELECT of current
// state, so the weekly question a seller actually asks — "what changed since
// last week" — had no answer anywhere in the app, while `change_log` has held
// every deal's close date, stage, value and status in full fidelity since the
// first commit. Five readers of that table existed and not one of them read a
// value for anything but the save-conflict check.
//
// This is a read over data that is already there: no snapshot table, no
// migration, no nightly job. A deal's whole history is replayable, and the
// only thing that was missing was a query.
import { db, type DealRow } from "../db";
import { fiscalQuarter, type FiscalQuarter } from "../fiscal";
import { ownerClause, type OwnerScope } from "./owner";

// The four fields worth watching. `stage_label`, `owner`, `next_step` and the
// rest change constantly and none of them is a movement in the pipeline.
const WATCHED = ["close_date", "stage", "tcv_usd", "status"] as const;

export type MovementKind =
  | "new"
  | "won"
  | "lost"
  | "reopened"
  | "pushed_out"
  | "pulled_in"
  | "date_moved"
  | "stage_up"
  | "stage_down"
  | "value_up"
  | "value_down";

export type Movement = {
  kind: MovementKind;
  dealId: string;
  name: string;
  accountId: string;
  accountName: string;
  tcvUsd: number | null;
  at: number;
  /** Where the field stood at the start of the window, and where it stands now. */
  from: string | null;
  to: string | null;
  /** For a value move, the difference in dollars. */
  deltaUsd?: number;
  /** For a date move, the quarters either side. */
  fromQuarter?: string | null;
  toQuarter?: string | null;
  /**
   * True when the change came from accepting a proposal — a report import
   * restating what the CRM already said — rather than from one of the two of
   * them deciding something.
   *
   * This distinction is the difference between a useful list and a misleading
   * one: without it "twelve deals slipped this week" is often really "the CRM
   * export ran on Tuesday". recentChanges already draws exactly this line.
   */
  fromImport: boolean;
  actorUserId: string | null;
};

export type Stalled = {
  dealId: string;
  name: string;
  accountId: string;
  accountName: string;
  tcvUsd: number | null;
  closeDate: string | null;
  stage: number | null;
  /** When anything about this deal last changed, or null if nothing ever has. */
  lastTouched: number | null;
};

type Row = {
  entity_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  created_at: number;
  actor_user_id: string | null;
  proposal_id: string | null;
  name: string;
  account_id: string;
  account_name: string;
  tcv_usd: number | null;
  created_deal_at: number;
};

function parse(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function asText(raw: string | null): string | null {
  const v = parse(raw);
  return v === null || v === undefined ? null : String(v);
}

function asNumber(raw: string | null): number | null {
  const v = parse(raw);
  return typeof v === "number" ? v : null;
}

export type MovementOptions = {
  /** Only this account. */
  accountId?: string | null;
  /** Only what one of them typed, leaving out what an accepted import restated. */
  handEditsOnly?: boolean;
  /** Only accounts one of them runs, or the ones they share. */
  scope?: OwnerScope;
};

export function listMovement(sinceMs: number, opts: MovementOptions = {}): Movement[] {
  const conn = db();
  const scope = opts.accountId ? " AND d.account_id = ?" : "";
  const owner = ownerClause(opts.scope);
  const args: Array<string | number> = [sinceMs, ...(opts.accountId ? [opts.accountId] : []), ...owner.args];

  const rows = conn
    .prepare(
      // Archived and merged-away deals are excluded here rather than filtered
      // afterwards, the same rule every other read surface in this app
      // follows: a deal that was merged into another one has its history read
      // under the survivor, and showing its moves twice would double every
      // number on the page.
      `SELECT c.entity_id, c.field, c.old_value, c.new_value, c.created_at, c.actor_user_id, c.proposal_id,
              d.name, d.account_id, d.tcv_usd, d.created_at AS created_deal_at,
              a.name AS account_name
       FROM change_log c
       JOIN deals d ON d.deal_id = c.entity_id
       JOIN accounts a ON a.id = d.account_id
       WHERE c.entity_type = 'deal'
         AND c.field IN (${WATCHED.map(() => "?").join(", ")})
         AND c.created_at >= ?${scope}
         AND d.archived_at IS NULL AND a.archived_at IS NULL AND d.merged_into IS NULL${owner.sql}
       ORDER BY c.created_at ASC`,
    )
    .all(...WATCHED, ...args) as Row[];

  // Net, not gross: one entry per deal per field, from the earliest old value
  // in the window to the latest new value. A close date moved twice in a week
  // is one slip, not two, and two rows that disagree about where it started
  // are worse than none.
  //
  // Rows arrive oldest first, so the first one seen sets `from` and every
  // later one overwrites `to`.
  type Fold = {
    row: Row;
    from: string | null;
    to: string | null;
    at: number;
    /** Any hand edit in the window makes this a decision, not a restatement. */
    byHand: boolean;
    actor: string | null;
  };
  const folded = new Map<string, Fold>();
  for (const r of rows) {
    const key = `${r.entity_id}\u0000${r.field}`;
    const seen = folded.get(key);
    if (!seen) {
      folded.set(key, {
        row: r,
        from: r.old_value,
        to: r.new_value,
        at: r.created_at,
        byHand: r.proposal_id === null,
        actor: r.actor_user_id,
      });
      continue;
    }
    seen.to = r.new_value;
    seen.at = r.created_at;
    seen.row = r;
    seen.byHand = seen.byHand || r.proposal_id === null;
    seen.actor = r.actor_user_id;
  }

  const out: Movement[] = [];
  const isNew = new Set<string>();
  for (const f of folded.values()) {
    if (opts.handEditsOnly && !f.byHand) continue;
    const r = f.row;
    const base = {
      dealId: r.entity_id,
      name: r.name,
      accountId: r.account_id,
      accountName: r.account_name,
      tcvUsd: r.tcv_usd,
      at: f.at,
      from: asText(f.from),
      to: asText(f.to),
      fromImport: !f.byHand,
      actorUserId: f.actor,
    };

    // A deal added inside the window is news once, not four times — one row
    // per watched field would bury everything that actually moved.
    if (r.created_deal_at >= sinceMs) {
      if (!isNew.has(r.entity_id)) {
        isNew.add(r.entity_id);
        out.push({ ...base, kind: "new", from: null, to: null, at: r.created_deal_at });
      }
      continue;
    }

    if (r.field === "status") {
      const to = asText(f.to);
      const from = asText(f.from);
      if (to === from) continue;
      const kind: MovementKind | null = to === "won" ? "won" : to === "lost" ? "lost" : from === "won" || from === "lost" ? "reopened" : null;
      if (kind) out.push({ ...base, kind });
      continue;
    }

    if (r.field === "stage") {
      const from = asNumber(f.from);
      const to = asNumber(f.to);
      if (from === null || to === null || from === to) continue;
      out.push({ ...base, kind: to > from ? "stage_up" : "stage_down" });
      continue;
    }

    if (r.field === "tcv_usd") {
      const from = asNumber(f.from);
      const to = asNumber(f.to);
      if (from === null || to === null || from === to) continue;
      out.push({ ...base, kind: to > from ? "value_up" : "value_down", deltaUsd: to - from });
      continue;
    }

    // close_date. Compared as fiscal quarters, not as raw dates.
    //
    // A close date that moved two days inside its quarter is noise, and
    // calling it a slip would make this list unreadable — which is exactly
    // how a forecast report earns the reputation of being ignored. A move
    // that stays inside the quarter is reported without a direction.
    const from = asText(f.from);
    const to = asText(f.to);
    if (from === to) continue;
    const fq = from ? fiscalQuarter(from) : null;
    const tq = to ? fiscalQuarter(to) : null;
    const quarters = { fromQuarter: fq?.label ?? null, toQuarter: tq?.label ?? null };
    if (fq && tq && fq.key !== tq.key) {
      out.push({ ...base, kind: tq.key > fq.key ? "pushed_out" : "pulled_in", ...quarters });
    } else {
      out.push({ ...base, kind: "date_moved", ...quarters });
    }
  }

  return out.sort((a, b) => b.at - a.at);
}

// The deal nobody is working.
//
// The inverse query, and the one a seller most needs: an open deal closing in
// the current quarter that nothing has changed in the window. Every other
// signal in this app fires on something happening; this one fires on nothing
// happening, which is the failure mode that costs a quarter.
export function listStalled(
  sinceMs: number,
  quarter: FiscalQuarter,
  opts: { accountId?: string | null; scope?: OwnerScope } = {},
): Stalled[] {
  const conn = db();
  const scope = opts.accountId ? " AND d.account_id = ?" : "";
  const owner = ownerClause(opts.scope);
  const args: Array<string | number> = [sinceMs, ...(opts.accountId ? [opts.accountId] : []), ...owner.args];
  const rows = conn
    .prepare(
      // "Nothing has changed" means no change_log row of any field in the
      // window, not only a watched one: a next step rewritten on Tuesday is
      // someone working the deal, and calling it stalled would be wrong.
      `SELECT d.deal_id, d.name, d.account_id, d.tcv_usd, d.close_date, d.stage,
              a.name AS account_name,
              (SELECT MAX(created_at) FROM change_log c WHERE c.entity_type = 'deal' AND c.entity_id = d.deal_id) AS last_touched
       FROM deals d JOIN accounts a ON a.id = d.account_id
       WHERE d.status = 'open' AND d.archived_at IS NULL AND a.archived_at IS NULL AND d.merged_into IS NULL
         AND d.close_date IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM change_log c
           WHERE c.entity_type = 'deal' AND c.entity_id = d.deal_id AND c.created_at >= ?
         )${scope}${owner.sql}
       ORDER BY d.tcv_usd DESC`,
    )
    .all(...args) as Array<
    DealRow & { account_name: string; last_touched: number | null }
  >;
  return rows
    .filter((r) => {
      const q = r.close_date ? fiscalQuarter(r.close_date) : null;
      return q !== null && q.key === quarter.key;
    })
    .map((r) => ({
      dealId: r.deal_id,
      name: r.name,
      accountId: r.account_id,
      accountName: r.account_name,
      tcvUsd: r.tcv_usd,
      closeDate: r.close_date,
      stage: r.stage,
      lastTouched: r.last_touched,
    }));
}

export type QuarterRollUp = {
  label: string;
  /** Open deals whose close date is in this quarter now. */
  inNowUsd: number;
  inNowCount: number;
  /** Money that arrived in the quarter during the window, and money that left. */
  pulledInUsd: number;
  pushedOutUsd: number;
  wonUsd: number;
  lostUsd: number;
};

// The quarter, as it stands and as it moved.
//
// `inNow` comes from the deals table because that is the truth; the four
// movement figures come from the same folded change_log rows the list above
// renders, so the page never shows a total that disagrees with the rows under
// it. Deliberately not "what the quarter was worth a week ago": reconstructing
// that means replaying every deal backwards, and a number nobody can check is
// worse than one they can.
export function quarterRollUp(
  sinceMs: number,
  quarter: FiscalQuarter,
  opts: MovementOptions = {},
  // The page has already run this to render the rows; running it a second
  // time here would guarantee the two agree by coincidence rather than by
  // construction, which is the property the comment above is claiming.
  moves: Movement[] = listMovement(sinceMs, opts),
): QuarterRollUp {
  const conn = db();
  const scope = opts.accountId ? " AND d.account_id = ?" : "";
  const owner = ownerClause(opts.scope);
  const args: Array<string | number> = [...(opts.accountId ? [opts.accountId] : []), ...owner.args];
  const open = conn
    .prepare(
      `SELECT d.close_date, d.tcv_usd FROM deals d JOIN accounts a ON a.id = d.account_id
       WHERE d.status = 'open' AND d.archived_at IS NULL AND a.archived_at IS NULL AND d.merged_into IS NULL
         AND d.close_date IS NOT NULL${scope}${owner.sql}`,
    )
    .all(...args) as Array<{ close_date: string; tcv_usd: number | null }>;

  let inNowUsd = 0;
  let inNowCount = 0;
  for (const d of open) {
    const q = fiscalQuarter(d.close_date);
    if (q && q.key === quarter.key) {
      inNowUsd += d.tcv_usd ?? 0;
      inNowCount += 1;
    }
  }

  const sum = (pick: (m: Movement) => boolean) => moves.filter(pick).reduce((s, m) => s + (m.tcvUsd ?? 0), 0);
  return {
    label: quarter.label,
    inNowUsd,
    inNowCount,
    pulledInUsd: sum((m) => m.kind === "pulled_in" && m.toQuarter === quarter.label),
    pushedOutUsd: sum((m) => m.kind === "pushed_out" && m.fromQuarter === quarter.label),
    wonUsd: sum((m) => m.kind === "won"),
    lostUsd: sum((m) => m.kind === "lost"),
  };
}
