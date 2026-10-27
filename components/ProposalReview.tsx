"use client";
import { fieldLabel } from "@/lib/fieldLabels";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useRefreshHold } from "./AccountFreshness";
import { buttonClass } from "./ui";
import { SourceLink } from "./SourceLink";

export type ProposalView = {
  id: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  op: "create" | "update";
  payload: Record<string, unknown>;
  before: Record<string, unknown> | null;
  rationale: string | null;
  source_ref: {
    kind: string;
    id?: string | null;
    quote?: string | null;
    url?: string | null;
    verification?: string;
    origin?: string;
    finding_index?: number;
    refs?: { kind: string; id?: string | null; finding_index?: number }[];
  } | null;
  origin_kind: string;
  /** Names for the record ids the payload mentions (lib/proposals/view.ts). */
  names?: Record<string, string>;
};

// What the origin line says above a card. A confirmed brief suggestion keeps
// `origin: "ai_generated"` and quotes the model's words, which is right — but
// the text it proposes may be the person's, rewritten in the form or in the
// edited preparation. "Not a user-authored statement" over a sentence a user
// wrote is false, so the label reads the two against each other.
export function originLabel(p: Pick<ProposalView, "payload" | "source_ref">): string | null {
  if (p.source_ref?.origin !== "ai_generated") return null;
  const quote = (p.source_ref.quote ?? "").trim();
  const text = typeof p.payload.text === "string" ? p.payload.text.trim() : typeof p.payload.name === "string" ? p.payload.name.trim() : "";
  if (quote && text && quote !== text) return "Confirmed from an AI suggestion — the wording here is the person's; the model's own words are quoted below";
  return "AI-generated suggestion — not a user-authored statement";
}

const LABEL: Record<string, string> = {
  account: "Account",
  contact: "Contact",
  deal: "Deal",
  install_base: "Install base",
  play: "Play",
  action_item: "Follow-up",
  meeting: "Meeting",
};

// Bookkeeping fields. The quote is shown under the card and the origin is in
// the heading, so repeating them is noise.
const HIDDEN_FIELDS = new Set(["document_id", "source_ref", "meeting_id"]);

function show(v: unknown, names: Record<string, string> = {}): string {
  if (v === null || v === undefined || v === "") return "—";
  // A linked record is shown by its name. An id with no name is a record
  // since removed; it reads as that rather than as a uuid.
  const named = (x: unknown) => (typeof x === "string" ? (names[x] ?? (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(x) ? "a removed record" : x)) : show(x, names));
  if (Array.isArray(v)) return v.map(named).join(", ") || "—";
  if (typeof v === "string" && names[v]) return names[v];
  if (typeof v === "number") return v.toLocaleString("en-US");
  // A qualification element (DECISIONS #72): its status, then its evidence.
  if (typeof v === "object" && "status" in v && "evidence" in v) {
    const q = v as { status: string; evidence: string };
    return `${q.status[0]!.toUpperCase()}${q.status.slice(1)}${q.evidence ? `: ${q.evidence}` : ""}`;
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// "3 deals, 2 plays, 9 research findings" — what the card rests on, counted,
// rather than "deal; play; play; research; …" one kind per citation.
const EVIDENCE_NOUN: Record<string, [string, string]> = {
  deal: ["deal", "deals"], play: ["play", "plays"], contact: ["person", "people"], meeting: ["meeting", "meetings"],
  research: ["research finding", "research findings"], action_item: ["follow-up", "follow-ups"], document: ["document", "documents"],
  account: ["account record", "account records"], user: ["note", "notes"],
};
export function evidenceSummary(refs: Array<{ kind: string }>): string {
  const counts = new Map<string, number>();
  for (const r of refs) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  return [...counts.entries()].map(([k, n]) => `${n} ${(EVIDENCE_NOUN[k] ?? [k, `${k}s`])[n === 1 ? 0 : 1]}`).join(", ");
}

function title(p: ProposalView): string {
  const kind = LABEL[p.entity_type] ?? p.entity_type;
  if (p.op === "create") {
    const name = p.payload.name ?? p.payload.title ?? p.payload.product_family ?? p.payload.text;
    return `New ${kind.toLowerCase()}: ${show(name)}`;
  }
  // Fall back to nothing rather than a raw id: an id is not a name.
  return `${kind}${p.entity_label ? `: ${p.entity_label}` : ""}`;
}

// An outcome is a state, not a string. A conflict in particular used to render
// as `conflict: changed since proposed: stage` in grey six-point type in the
// corner of the card — the one outcome that needs the most attention, styled
// as the least.
//
// `unknown` is the fourth state, and the one that was being told as a
// falsehood. When the reply to a decision is lost — the connection drops after
// the request left, the body does not parse — the write may well have
// happened: the server had already committed it in the case this was found in.
// Saying "Nothing was applied" there is a claim the screen cannot support, and
// it invites a second Accept that would either double-apply or look like a
// conflict for no reason. So: say it is unknown, and offer the one thing that
// settles it, which is a read of the server's own record.
export type Outcome =
  | { kind: "accepted" }
  | { kind: "rejected" }
  | { kind: "conflict"; fields: string }
  | { kind: "error"; message: string }
  | { kind: "unknown"; action: "accept" | "reject"; message: string; checking?: boolean; checkFailed?: string };

// The request did not get an answer we can read. That is not a refusal:
// "Nothing was applied" is only true when the server said so.
const UNKNOWN = "The reply never arrived, so whether this was applied is not known from here. It may have been written. Check the record rather than deciding again.";

// A reply arrived and did not say what happened — an empty body, `null`, a
// status the API does not have. The write may still have landed, so this is
// the same state as no reply at all.
const UNREADABLE = "The server answered, but not with an outcome this screen can read, so whether this was applied is not known from here. Check the record rather than deciding again.";

// The statuses `POST /api/proposals/:id` and the accept-all route actually
// return (lib/proposals/apply.ts `DecideResult`, plus the per-row "failed"
// the bulk route adds when apply throws). Anything outside this set is not a
// confirmation of anything.
const DECIDED = new Set(["accepted", "rejected", "conflict", "failed"]);

// What the server said happened, or the admission that it did not say.
//
// This used to take the action as a *fallback*: a 200 with `{}` — or `null`,
// or a status from some other version of the API — reported the decision the
// user had asked for, which is a claim about a write nobody confirmed. Only an
// explicit status decides anything now.
export function outcomeOf(status: unknown, message: unknown, action: "accept" | "reject"): Outcome {
  const text = typeof message === "string" ? message : undefined;
  if (status === "conflict")
    return {
      kind: "conflict",
      // Only a field list names fields. Other conflicts (archived or merged
      // since) read as the generic "this record changed" sentence rather
      // than as "Someone changed the record was archived…".
      fields: /^changed since proposed:/.test(text ?? "") ? (text ?? "").replace(/^changed since proposed:\s*/, "") : "",
    };
  if (status === "accepted") return { kind: "accepted" };
  if (status === "rejected") return { kind: "rejected" };
  // The bulk route reports a per-row apply failure as `failed` with the
  // reason: a confirmed refusal, because the server is telling us about it.
  if (status === "failed") return { kind: "error", message: text ?? "The server could not apply this one." };
  return { kind: "unknown", action, message: UNREADABLE };
}

// An HTTP status is not evidence of a no-write.
//
// A 500 or a 502 can land *after* the row was committed — the gateway gave up
// on a response the server had already earned — and a 408 says only that we
// stopped waiting. Those are unknown. A 4xx the application itself explained
// is a refusal we can report; a 4xx with no readable error envelope is not.
export function httpFailureOutcome(httpStatus: number, body: unknown, action: "accept" | "reject"): Outcome {
  const error = typeof (body as { error?: unknown } | null)?.error === "string" ? ((body as { error: string }).error ?? "").trim() : "";
  if (httpStatus >= 500 || httpStatus === 408)
    return {
      kind: "unknown",
      action,
      message: `The server answered ${httpStatus} without finishing the exchange, so whether this was applied is not known from here. Check the record rather than deciding again.`,
    };
  if (error) return { kind: "error", message: `${error} The server refused this; nothing was applied.` };
  return { kind: "unknown", action, message: UNREADABLE };
}

// Which outcomes still leave the decision with the person. None, obviously;
// and an explained refusal — the server read the request, wrote nothing and
// said why (an acknowledgement missing, a link no longer valid). The comment
// on decide() always said such a row "can be decided on again", but every
// outcome hid both buttons, so the only way back was a reload. Unknown stays
// shut: that is the case where deciding again is the double-apply.
export function retryable(outcome: Outcome | undefined): boolean {
  return !outcome || outcome.kind === "error";
}

// The read-only reconciliation, held to the statuses a proposal row can hold.
// `pending` is the one that gives the decision back: the POST never landed, so
// the row can be decided on again.
//
// `conflict` is a decided state too: the server read the row, found it had
// moved since the proposal was written, and recorded that nothing was
// applied. Leaving it out here meant a decide whose reply was lost *after*
// the server wrote `conflict` could never be settled by reading — every check
// said "did not say what state", the row stayed unknown, and the hold it
// placed on the account's Refresh was never released.
export function reconcile(status: unknown): "accepted" | "rejected" | "conflict" | "pending" | "unknown" {
  return status === "accepted" || status === "rejected" || status === "conflict" || status === "pending" ? status : "unknown";
}

export type BulkOutcome = { id: string; status: string; message?: string };

// Whether the batch reply accounts for exactly what was sent.
//
// A truncated or duplicated `outcomes` list is a partial answer, and a partial
// answer about writes is not an answer: the rows it names are settled, the
// rows it does not are uncertain — not refused.
export function checkBulk(submitted: string[], body: unknown): { ok: boolean; reason: string | null; valid: BulkOutcome[]; unresolved: string[] } {
  const sent = new Set(submitted);
  const rows = (body as { outcomes?: unknown } | null)?.outcomes;
  if (!Array.isArray(rows)) return { ok: false, reason: "the reply listed no outcomes", valid: [], unresolved: submitted };
  const valid: BulkOutcome[] = [];
  const seen = new Set<string>();
  let reason: string | null = null;
  for (const row of rows as unknown[]) {
    const r = row as { id?: unknown; status?: unknown; message?: unknown } | null;
    const id = typeof r?.id === "string" ? r.id : null;
    if (!id || !sent.has(id)) {
      reason ??= "the reply named a change that was not sent";
      continue;
    }
    if (seen.has(id)) {
      reason ??= "the reply named the same change twice";
      // Neither occurrence is authoritative once the answer contradicts or
      // repeats itself. Leave that row unknown until read-only reconciliation.
      const prior = valid.findIndex((v) => v.id === id);
      if (prior !== -1) valid.splice(prior, 1);
      continue;
    }
    seen.add(id);
    if (typeof r?.status !== "string" || !DECIDED.has(r.status)) {
      reason ??= "the reply carried an outcome this screen cannot read";
      continue;
    }
    valid.push({ id, status: r.status, message: typeof r.message === "string" ? r.message : undefined });
  }
  const unresolved = submitted.filter((id) => !valid.some((v) => v.id === id));
  if (unresolved.length > 0) reason ??= "the reply did not account for every change that was sent";
  return { ok: reason === null, reason, valid, unresolved };
}

// Where to go and look at the record this proposal wanted to change: every
// kind has a page of its own now, except an install-base line, which lives in
// one section of the account's Details.
function recordHref(accountId: string, p: ProposalView): string | null {
  if (!p.entity_id) return null;
  const base = `/accounts/${accountId}`;
  switch (p.entity_type) {
    case "deal":
      return `${base}/deals/${encodeURIComponent(p.entity_id)}`;
    case "meeting":
      return `${base}/meetings/${p.entity_id}`;
    case "contact":
      return `${base}/contacts/${p.entity_id}`;
    case "play":
      return `${base}/plays/${p.entity_id}`;
    case "action_item":
      return `/follow-ups/${p.entity_id}`;
    case "install_base":
      return `${base}/details#install-base`;
    default:
      return base;
  }
}

export function ProposalReview({
  accountId,
  proposals,
  batchId,
  // Whether deciding should refresh the page around this list.
  //
  // Embedded in the account or meeting page, it must: accepting a drafted
  // plan used to leave the plays, the rail counts and the "waiting on this
  // account" banner all showing the state from before. On /review the list is
  // the whole page, so there is nothing around it to update — and a refresh
  // there would collapse the page to its "nothing to review" empty state and
  // take the record of what you just decided with it.
  refresh = true,
}: {
  accountId: string;
  proposals: ProposalView[];
  batchId?: string | null;
  refresh?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<Record<string, Outcome>>({});
  const [allError, setAllError] = useState<string | null>(null);
  const [allUnknown, setAllUnknown] = useState<string | null>(null);
  const [ack, setAck] = useState<Record<string, boolean>>({});
  useRefreshHold("proposal-review", pending
    ? "A review decision is being saved. Wait for its result."
    : Object.values(done).some((o) => o.kind === "unknown")
      ? "A review outcome is unknown. Use its outcome check first."
      : Object.entries(ack).some(([id, selected]) => selected && !["accepted", "rejected"].includes(done[id]?.kind ?? ""))
        ? "A source acknowledgement is selected in a review here."
        : null);
  // What a read-only recheck found, for rows it handed back to be decided on.
  const [checked, setChecked] = useState<Record<string, string | null>>({});
  const needsAck = (p: ProposalView) => p.source_ref?.verification === "report_excerpt";

  // The rows are held here rather than read straight from the prop, because
  // deciding refreshes the page and a decided proposal is no longer pending —
  // it would vanish from the prop and take its own outcome off the screen.
  // Holding them keeps the record of what you just did while everything
  // *around* the list (the waiting-for-review banner, the rail counts, the
  // plays themselves) updates to match. Before this, accepting a drafted plan
  // from the account page left every one of those showing the old state.
  const [rows, setRows] = useState<ProposalView[]>(proposals);
  useEffect(() => {
    setRows((prev) => {
      const byId = new Map(prev.map((r) => [r.id, r]));
      let added = false;
      for (const p of proposals) {
        if (!byId.has(p.id)) {
          byId.set(p.id, p);
          added = true;
        }
      }
      return added ? [...byId.values()] : prev;
    });
  }, [proposals]);

  // Reconciliation: ask the server what the proposal's status actually is.
  // A read, never a resend — deciding again is what double-applies.
  async function recheck(id: string) {
    setDone((d) => {
      const o = d[id];
      return o?.kind === "unknown" ? { ...d, [id]: { ...o, checking: true, checkFailed: undefined } } : d;
    });
    try {
      // no-store: this read is the evidence that settles an unknown outcome,
      // so it must come from the server, never from a cached earlier answer.
      const res = await fetch(`/api/proposals/${id}`, { headers: { accept: "application/json" }, cache: "no-store" });
      const body = (await res.json().catch(() => null)) as { status?: unknown; error?: unknown } | null;
      if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : `The server answered ${res.status}.`);
      const settled = reconcile(body?.status);
      // A status the read cannot place leaves the row where it was: uncertain.
      if (settled === "unknown") throw new Error("The server did not say what state this proposal is in.");
      setDone((d) => {
        const next = { ...d };
        if (settled === "pending") {
          // Nothing was written, and the decision is the user's to make
          // again — so the row goes back to being undecided rather than
          // sitting behind a failure badge with no buttons. The evidence
          // acknowledgement is deliberately left ticked.
          delete next[id];
        } else if (settled === "conflict") {
          // The read carries no field list — the row keeps only the status —
          // so the conflict is reported without naming what changed.
          next[id] = { kind: "conflict", fields: "" };
        } else {
          next[id] = settled === "accepted" ? { kind: "accepted" } : { kind: "rejected" };
        }
        return next;
      });
      setChecked((c) => ({
        ...c,
        [id]: settled === "pending" ? "The server still has this waiting for a decision: nothing was applied. Decide on it again below." : null,
      }));
      if (refresh) router.refresh();
    } catch (e) {
      setDone((d) => {
        const o = d[id];
        return o?.kind === "unknown" ? { ...d, [id]: { ...o, checking: false, checkFailed: e instanceof Error ? e.message : "The check did not reach the server." } } : d;
      });
    }
  }

  async function decide(id: string, action: "accept" | "reject") {
    let body: { status?: unknown; message?: unknown; error?: unknown } | null;
    setChecked((c) => ({ ...c, [id]: null }));
    try {
      const res = await fetch(`/api/proposals/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          ...(action === "accept" && ack[id] ? { ackEvidence: true } : {}),
        }),
      });
      if (!res.ok) {
        // An explained 4xx is an answer: the server decided and said why, so
        // the acknowledgement tick and any selection stay exactly as they are
        // and the row can be decided on again. A 5xx, a gateway failure or a
        // timeout is not an answer — the write may already have happened.
        body = (await res.json().catch(() => null)) as typeof body;
        const outcome = httpFailureOutcome(res.status, body, action);
        setDone((d) => ({ ...d, [id]: outcome }));
        return;
      }
      // A 200 whose body cannot be read is not a success either: the write may
      // have happened and we cannot say which way it went.
      try {
        body = (await res.json()) as typeof body;
      } catch {
        setDone((d) => ({ ...d, [id]: { kind: "unknown", action, message: UNKNOWN } }));
        return;
      }
    } catch {
      // A dropped connection used to claim a no-write and invite a retry,
      // which was false where the server had already committed the change —
      // and an invitation to apply it twice.
      setDone((d) => ({ ...d, [id]: { kind: "unknown", action, message: UNKNOWN } }));
      return;
    }
    setDone((d) => ({
      ...d,
      [id]: outcomeOf(body?.status, body?.message, action),
    }));
    if (refresh) router.refresh();
  }

  // Every row the batch was sent for becomes uncertain, not refused, and every
  // way to write again is shut until a read settles it.
  function bulkUnknown(sent: ProposalView[], applied: BulkOutcome[], why: string) {
    setAllError(null);
    setDone((d) => {
      const next = { ...d };
      for (const o of applied) next[o.id] = outcomeOf(o.status, o.message, "accept");
      for (const p of sent) if (!next[p.id]) next[p.id] = { kind: "unknown", action: "accept", message: UNKNOWN };
      return next;
    });
    setAllUnknown(why);
  }

  function acceptAll() {
    start(async () => {
      const sent = remaining;
      if (sent.some(needsAck)) {
        for (const p of sent) await decide(p.id, "accept");
        return;
      }
      const lost = `${sent.length} change${sent.length === 1 ? " was" : "s were"} sent and the reply never arrived.`;
      let body: unknown;
      try {
        const res = await fetch(`/api/accounts/${accountId}/proposals/accept-all`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          // The rows on this screen, by id: what "all" means is what was
          // shown, not whatever is pending when the request lands.
          body: JSON.stringify({ ...(batchId ? { batchId } : {}), ids: sent.map((p) => p.id) }),
        });
        if (!res.ok) {
          const refused = (await res.json().catch(() => null)) as { error?: unknown } | null;
          const error = typeof refused?.error === "string" ? refused.error.trim() : "";
          // A 5xx or a timeout here can follow a batch the server had already
          // begun to commit, so it is not a refusal of anything.
          if (res.status >= 500 || res.status === 408 || !error) {
            bulkUnknown(sent, [], `${sent.length} change${sent.length === 1 ? " was" : "s were"} sent and the server answered ${res.status} without an outcome for them.`);
            return;
          }
          setAllUnknown(null);
          setAllError(`${error} The server refused the batch; nothing was applied.`);
          return;
        }
        try {
          body = await res.json();
        } catch {
          bulkUnknown(sent, [], lost);
          return;
        }
      } catch {
        // Same rule as a single decision, and it matters more here: this
        // request can have applied every one of them.
        bulkUnknown(sent, [], lost);
        return;
      }
      // A 200 is not the end of it: the list has to account for exactly the
      // changes that were sent, once each, with outcomes this screen knows.
      const checkedBatch = checkBulk(
        sent.map((p) => p.id),
        body,
      );
      if (!checkedBatch.ok) {
        bulkUnknown(
          sent,
          checkedBatch.valid,
          `${checkedBatch.unresolved.length} of ${sent.length} change${sent.length === 1 ? "" : "s"} came back without an outcome — ${checkedBatch.reason}.`,
        );
        return;
      }
      setAllError(null);
      setAllUnknown(null);
      // Each row is marked where it sits, and the page refreshes around it.
      setDone((d) => {
        const next = { ...d };
        for (const o of checkedBatch.valid) next[o.id] = outcomeOf(o.status, o.message, "accept");
        return next;
      });
      if (refresh) router.refresh();
    });
  }

  const remaining = rows.filter((p) => !done[p.id]);
  const outcomes = Object.values(done);
  const accepted = outcomes.filter((o) => o.kind === "accepted").length;
  const rejected = outcomes.filter((o) => o.kind === "rejected").length;
  const problems = outcomes.filter((o) => o.kind === "conflict" || o.kind === "error").length;
  const unknown = outcomes.filter((o) => o.kind === "unknown").length;
  // While a batch's fate is unknown, no button on this list may write: a
  // second Accept — one row or all of them — is the double-apply the unknown
  // state exists to prevent. Reading is still allowed, and reading is what
  // lifts the lock: once no row is uncertain, the batch is accounted for.
  const locked = allUnknown !== null && unknown > 0;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          data-testid="accept-all"
          onClick={acceptAll}
          disabled={pending || locked || remaining.length === 0 || remaining.some((p) => needsAck(p) && !ack[p.id])}
          aria-busy={pending}
          className={buttonClass("positive")}
        >
          {pending ? "Applying…" : locked ? "Locked until checked" : remaining.length === 0 ? "All decided" : `Accept all ${remaining.length}`}
        </button>
        <span className="text-label text-ink-muted">or take them one at a time.</span>
        <span role="status" aria-live="polite" className="text-label font-medium empty:hidden">
          {accepted > 0 && <span className="text-positive">{accepted} applied</span>}
          {rejected > 0 && (
            <span className="text-ink-muted">
              {accepted > 0 ? " · " : ""}
              {rejected} rejected
            </span>
          )}
          {problems > 0 && (
            <span className="text-warning">
              {accepted + rejected > 0 ? " · " : ""}
              {problems} needs a look
            </span>
          )}
          {unknown > 0 && (
            <span className="text-warning">
              {accepted + rejected + problems > 0 ? " · " : ""}
              {unknown} outcome{unknown === 1 ? "" : "s"} unknown
            </span>
          )}
        </span>
      </div>

      {allError && (
        <p role="alert" className="mb-3 rounded-lg border border-danger-line bg-danger-soft/50 p-2.5 text-label font-medium text-ink">
          {allError}
        </p>
      )}

      {/* The outer banner told the same falsehood the rows did, for every
          change in the batch at once. */}
      {locked && (
        <div role="alert" data-testid="accept-all-unknown" className="mb-3 rounded-lg border border-warning-line bg-warning-soft/60 p-2.5 text-label text-ink">
          <p>
            <span className="font-semibold">Outcome unknown.</span> {allUnknown} Some or all of them may have been applied. Accepting on this list is locked until that is
            settled: check a change against the server&rsquo;s own record below, or reload the page and decide only on what is still waiting.
          </p>
          <div className="mt-2">
            {/* A real reload, and it says so. `router.refresh()` re-runs the
                server render but leaves this component mounted with the rows
                it is holding — the ones whose fate is in question — so it
                cannot be the way out of a state that exists because the local
                copy is not to be trusted. */}
            <button type="button" data-testid="accept-all-reload" onClick={() => window.location.reload()} className={buttonClass("quiet", "sm")}>
              Reload the page and check what the server has
            </button>
          </div>
        </div>
      )}

      <ul className="space-y-2">
        {rows.map((p) => {
          const outcome = done[p.id];
          const settled = outcome?.kind === "accepted";
          const wrong = outcome?.kind === "conflict" || outcome?.kind === "error";
          return (
            <li
              key={p.id}
              // The row's own address. A test (and a reader) that finds a row
              // by "the one with an Accept button" is looking at a different
              // row the moment that button goes away.
              data-testid="proposal-row"
              data-proposal-id={p.id}
              className={`rounded-lg border p-3 transition-colors ${
                settled
                  ? "animate-settle border-positive-line bg-positive-soft/40"
                  : outcome?.kind === "conflict" || outcome?.kind === "unknown"
                    ? "border-warning-line bg-warning-soft/50"
                    : outcome?.kind === "error"
                      ? "border-danger-line bg-danger-soft/50"
                      : outcome
                        ? "border-line bg-surface-sunk opacity-70"
                        : "border-line bg-surface"
              }`}
            >
              <div className="flex min-w-0 flex-col items-stretch gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold text-ink-strong">{title(p)}</span>
                    {p.op === "update" && <span className="text-micro uppercase tracking-[0.06em] text-ink-faint">change</span>}
                  </div>
                  {p.rationale && <div className="text-micro text-ink-muted">{p.rationale}</div>}

                  <dl className="mt-2 space-y-0.5">
                    {Object.entries(p.payload)
                      .filter(([k]) => (k !== "deal_id" || p.op === "create") && !HIDDEN_FIELDS.has(k))
                      .map(([k, v]) => (
                        <FieldRow key={k} field={k} before={p.before ? p.before[k] : undefined} after={v} isUpdate={p.op === "update"} names={p.names} />
                      ))}
                  </dl>

                  {originLabel(p) && <p className="mt-2 text-micro font-semibold">{originLabel(p)}</p>}
                  {p.source_ref?.verification && (
                    <p className="text-micro text-ink-muted">
                      {p.source_ref.verification === "source_excerpt"
                        ? "Original-source excerpt; not independent verification"
                        : "Research-report excerpt; original support not verified"}
                    </p>
                  )}
                  {p.source_ref?.quote && <div className="mt-2 border-l-2 border-line pl-2 text-micro text-ink-muted">“{p.source_ref.quote}”</div>}
                  {/* Proposals built on research carry the page they came
                      from. Without it, accepting is a click rather than a
                      decision. */}
                  {p.source_ref?.url && (
                    <div className="mt-1 text-micro">
                      <SourceLink url={p.source_ref.url} />
                    </div>
                  )}
                  {p.source_ref?.refs && (
                    <p className="mt-1 text-micro text-ink-muted">
                      Evidence: {evidenceSummary(p.source_ref.refs)}
                    </p>
                  )}
                  {needsAck(p) && retryable(outcome) && (
                    <label className="mt-3 flex items-start gap-2 rounded border border-warning-line p-2 text-label">
                      <input type="checkbox" checked={!!ack[p.id]} onChange={(e) => setAck((a) => ({ ...a, [p.id]: e.target.checked }))} className="mt-1" />I understand this is an
                      unverified report excerpt and want to apply this selected change. This acknowledgement is not source verification.
                    </label>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {outcome ? (
                    <span
                      className={`text-micro font-semibold ${
                        settled
                          ? "text-positive"
                          : outcome.kind === "conflict" || outcome.kind === "unknown"
                            ? "text-warning"
                            : outcome.kind === "error"
                              ? "text-danger"
                              : "text-ink-muted"
                      }`}
                    >
                      {outcome.kind === "conflict" ? "not applied" : outcome.kind === "error" ? "failed" : outcome.kind === "unknown" ? "unknown" : outcome.kind}
                    </span>
                  ) : null}
                  {retryable(outcome) && (
                    <>
                      <button
                        type="button"
                        data-testid="row-accept"
                        onClick={() => start(() => decide(p.id, "accept"))}
                        disabled={pending || locked || (needsAck(p) && !ack[p.id])}
                        className={buttonClass("positive", "sm")}
                      >
                        Accept
                      </button>
                      <button type="button" data-testid="row-reject" onClick={() => start(() => decide(p.id, "reject"))} disabled={pending || locked} className={buttonClass("quiet", "sm")}>
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </div>
              {/* A conflict means someone edited the record between this being
                  proposed and you deciding on it, so the "before" above is
                  stale and nothing was written. The proposal cannot be
                  accepted again — say that, and offer the record. */}
              {outcome?.kind === "conflict" && (
                <p role="alert" className="mt-2 border-t border-warning-line pt-2 text-label text-ink">
                  <span className="font-semibold">Not applied.</span>{" "}
                  {outcome.fields ? (
                    <>Someone changed {outcome.fields} on this record after the change above was proposed, so the &ldquo;before&rdquo; here is out of date.</>
                  ) : (
                    <>This record changed after the change above was proposed.</>
                  )}{" "}
                  {recordHref(accountId, p) ? (
                    <a href={recordHref(accountId, p)!} className="font-medium text-accent underline underline-offset-2 hover:no-underline">
                      Look at it as it stands
                    </a>
                  ) : null}
                  {recordHref(accountId, p) ? " and make the change by hand if it is still wanted." : " Make the change by hand if it is still wanted."}
                </p>
              )}
              {/* The read found the row still waiting, so the decision is
                  back — said plainly, next to the buttons that returned. */}
              {!outcome && checked[p.id] && (
                <p role="status" data-testid="recheck-pending" className="mt-2 border-t border-warning-line pt-2 text-label text-ink">
                  {checked[p.id]}
                </p>
              )}
              {outcome?.kind === "error" && (
                <p role="alert" className="mt-2 border-t border-danger-line pt-2 text-label text-ink">
                  <span className="font-semibold">Nothing was applied.</span> {outcome.message}
                </p>
              )}
              {/* Unknown, and it says so: no claim either way, no resend, and
                  a read of the server's own record as the way out. */}
              {outcome?.kind === "unknown" && (
                <div role="alert" data-testid="unknown-outcome" className="mt-2 border-t border-warning-line pt-2 text-label text-ink">
                  <p>
                    <span className="font-semibold">Outcome unknown.</span> {outcome.message}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      data-testid="recheck-outcome"
                      onClick={() => recheck(p.id)}
                      disabled={outcome.checking}
                      aria-busy={outcome.checking}
                      className={buttonClass("quiet", "sm")}
                    >
                      {outcome.checking ? "Checking…" : "Check what the server has"}
                    </button>
                    {recordHref(accountId, p) && (
                      <a href={recordHref(accountId, p)!} className="font-medium text-accent underline underline-offset-2 hover:no-underline">
                        Open the record
                      </a>
                    )}
                  </div>
                  {outcome.checkFailed && <p className="mt-1 text-micro text-ink-muted">The check did not get through either: {outcome.checkFailed} Try again when you are back online.</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FieldRow({ field, before, after, isUpdate, names }: { field: string; before: unknown; after: unknown; isUpdate: boolean; names?: Record<string, string> }) {
  const changed = isUpdate && before !== undefined;
  return (
    <div className="min-w-0 py-1 text-label">
      <dt className="text-micro text-ink-muted">{fieldLabel(field)}</dt>
      <dd className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
        {changed && (
          <>
            <span className="text-ink-faint line-through">{show(before, names)}</span>
            <span aria-hidden className="mx-1.5 text-ink-faint">
              →
            </span>
          </>
        )}
        <span className="font-medium text-ink">{show(after, names)}</span>
      </dd>
    </div>
  );
}
