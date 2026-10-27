// What an answer's numbered sources point at *now*.
//
// The citations were checked against what the tools returned when the answer
// was written; records move after that. Each is resolved again on the account
// it came from, through the same resolver a meeting brief uses, so an archived
// or retracted record is said to be unavailable rather than linked to whatever
// holds that id today.
import { briefEvidenceResolver, type BriefEvidenceResolver } from "../meetings/briefEvidence";
import { getAccount } from "../queries/accounts";
import { db } from "../db";
import { fmtDay, fmtMoneyShort, relativeDays, stageText } from "../format";
import type { AskCitation } from "./threads";

export type AskSource = {
  n: number;
  label: string;
  href: string | null;
  account: string | null;
  unavailable: string | null;
  /** One line about the record as it is now, for the preview on the marker. */
  detail?: string | null;
};

const ROW: Record<string, string> = {
  deal: `SELECT stage, stage_label, tcv_usd, close_date, status, updated_at FROM deals WHERE deal_id = ?`,
  contact: `SELECT title, org FROM contacts WHERE id = ?`,
  meeting: `SELECT held_at, held_time FROM meetings WHERE id = ?`,
  action_item: `SELECT due, owner, status FROM action_items WHERE id = ?`,
  play: `SELECT status, next_step, next_step_due FROM plays WHERE id = ?`,
  account: `SELECT segment, region FROM accounts WHERE id = ?`,
};

/** A record's one-line preview: what someone hovering a marker wants to know first. */
export function sourceDetail(kind: string, id: string, now = Date.now()): string | null {
  const sql = ROW[kind];
  if (!sql) return null;
  const r = db().prepare(sql).get(id) as Record<string, string | number | null> | undefined;
  if (!r) return null;
  const parts: Array<string | null | false> =
    kind === "deal"
      ? [
          stageText((r.stage as number | null) ?? null, (r.stage_label as string | null) ?? null),
          r.tcv_usd != null && fmtMoneyShort(r.tcv_usd as number),
          r.close_date ? `closes ${fmtDay(r.close_date as string)}` : "no close date",
          r.status !== "open" && String(r.status),
          r.updated_at ? `changed ${relativeDays(r.updated_at as number, now)}` : null,
        ]
      : kind === "contact"
        ? [r.title as string | null, r.org as string | null]
        : kind === "meeting"
          ? [`${fmtDay(r.held_at as string)}${r.held_time ? ` at ${r.held_time}` : ""}`]
          : kind === "action_item"
            ? [r.status === "done" ? "done" : r.due ? `due ${fmtDay(r.due as string)}` : "no date", r.owner as string | null]
            : kind === "play"
              ? [r.status as string, r.next_step ? `next: ${String(r.next_step).slice(0, 60)}` : "no next step", r.next_step_due ? `by ${fmtDay(r.next_step_due as string)}` : null]
              : [r.segment as string | null, r.region as string | null];
  const line = parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(" · ");
  return line || null;
}

export function resolveSources(citations: AskCitation[]): AskSource[] {
  const resolvers = new Map<string, BriefEvidenceResolver>();
  const names = new Map<string, string | null>();
  return [...citations]
    .sort((a, b) => a.n - b.n)
    .map((c) => {
      if (!c.accountId) return { n: c.n, label: c.label, href: null, account: null, unavailable: "not on an account" };
      // An unreviewed web finding: its draft note, where it is kept or dropped.
      if (c.kind === "web") return { n: c.n, label: c.label, href: `/accounts/${c.accountId}/research#research-review`, account: null, unavailable: null, detail: "from the web, not yet reviewed" };
      let resolver = resolvers.get(c.accountId);
      if (!resolver) resolvers.set(c.accountId, (resolver = briefEvidenceResolver(c.accountId)));
      if (!names.has(c.accountId)) names.set(c.accountId, getAccount(c.accountId)?.name ?? null);
      const r = resolver.resolve({ kind: c.kind, id: c.id });
      const current = r.status === "current";
      return {
        n: c.n,
        label: current ? r.label : c.label,
        href: r.href,
        account: c.kind === "account" ? null : (names.get(c.accountId) ?? null),
        unavailable: current ? null : (r.reason ?? "evidence unavailable"),
        detail: current ? (r.asOf && c.kind === "research" ? `as of ${fmtDay(r.asOf)}` : sourceDetail(c.kind, c.id)) : null,
      };
    });
}
