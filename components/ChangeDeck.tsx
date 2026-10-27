"use client";

// The changes a meeting's notes proposed, one card at a time.
//
// Each decision is the same request the review list makes
// (`POST /api/proposals/:id`), read with the same helpers, so every guarantee
// the list gives holds here too: only an explicit status counts as an
// outcome, an unreadable reply is "unknown" rather than a refusal, and an
// unknown outcome locks the deck until a read of the server settles it
// (DECISIONS #34). The deck only changes the order in which you meet them.
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { evidenceSummary, httpFailureOutcome, outcomeOf, reconcile, type Outcome, type ProposalView } from "./ProposalReview";
import { useRefreshHold } from "./AccountFreshness";
import { Button } from "./ui";
import { Icon } from "./icons";
import { promiseDirection } from "@/lib/promises";
import { buildDeck, changedFields, showValue, type DeckCard } from "@/lib/changeDeck";
import { fieldLabel } from "@/lib/fieldLabels";
import { useToast } from "./kit/Toaster";
import { quickMoney } from "./kit/InlineField";

// Where a change came from, when one deck holds changes from several places.
const ORIGIN: Record<string, string> = { mail: "Email", import: "Report", meeting: "Meeting notes", plan_draft: "Plan draft", ask: "Ask", salesforce: "Salesforce", playbook: "Playbook", quarterly_refresh: "Quarterly refresh" };

// A thesis or a summary can run to paragraphs. Two lines say what changed;
// the rest is one press away.
const LONG = 180;
function Value({ text, strong = false }: { text: string; strong?: boolean }) {
  const [open, setOpen] = useState(false);
  const cls = strong ? "font-semibold text-ink-strong" : "text-ink-faint line-through";
  if (text.length <= LONG) return <span className={cls}>{text}</span>;
  return (
    <span className="block">
      <span className={`${cls} block whitespace-pre-wrap ${open ? "" : "line-clamp-2"}`}>{text}</span>
      <button type="button" onClick={() => setOpen((o) => !o)} className="mt-0.5 text-micro font-semibold text-accent hover:underline" data-testid="change-value-toggle">
        {open ? "Show less" : "Show all"}
      </button>
    </span>
  );
}

const ENTITY: Record<string, string> = { account: "Account", contact: "Person", deal: "Deal", install_base: "Install base", meeting: "Meeting", play: "Play", action_item: "Follow-up" };

type Owner = { id: string; name: string };

async function decideOne(id: string, action: "accept" | "reject", ack: boolean, edits?: Record<string, unknown>): Promise<Outcome> {
  try {
    const res = await fetch(`/api/proposals/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...(ack && action === "accept" ? { ackEvidence: true } : {}), ...(edits && action === "accept" ? { edits } : {}) }),
    });
    const body = (await res.json().catch(() => null)) as { status?: unknown; message?: unknown } | null;
    if (!res.ok) return httpFailureOutcome(res.status, body, action);
    return outcomeOf(body?.status, body?.message, action);
  } catch {
    return { kind: "unknown", action, message: "The reply never arrived, so whether this was applied is not known from here. Check the record rather than deciding again." };
  }
}

async function undoOne(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/proposals/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "undo" }) });
    return res.ok;
  } catch {
    return false;
  }
}

// A value a person can correct before accepting: text, a number or a date.
// A list of linked records is not edited here; it is accepted or turned down.
export function editableFields(p: ProposalView): string[] {
  return changedFields(p).filter((f) => {
    const v = p.payload[f];
    return v === null || typeof v === "string" || typeof v === "number";
  });
}

// What was typed, in the shape the proposal had: a number stays a number
// (money shorthand like 1.2m included), empty clears it.
export function editedValue(original: unknown, typed: string): unknown {
  const t = typed.trim();
  if (t === "") return null;
  if (typeof original === "number") {
    const plain = Number(t.replace(/[$,]/g, ""));
    return Number.isFinite(plain) ? plain : (quickMoney(t) ?? t);
  }
  return t;
}

function headline(card: DeckCard): string {
  if (card.kind === "people") return card.rows.length === 1 ? "Add a new person" : `Add ${card.rows.length} new people`;
  if (card.kind === "follow-ups") return card.rows.length === 1 ? "Add a follow-up" : `Add ${card.rows.length} follow-ups`;
  const p = card.rows[0]!;
  if (p.op === "create") return `New ${(ENTITY[p.entity_type] ?? p.entity_type).toLowerCase()}: ${showValue(p.payload.name ?? p.payload.title ?? p.payload.text)}`;
  return p.entity_label ?? ENTITY[p.entity_type] ?? p.entity_type;
}

function eyebrow(card: DeckCard, withOrigin: boolean): string {
  const from = withOrigin ? ORIGIN[card.rows[0]!.origin_kind] : undefined;
  const prefix = from ? `${from} · ` : "";
  if (card.kind === "people") return `${prefix}People`;
  if (card.kind === "follow-ups") return `${prefix}Promises`;
  const p = card.rows[0]!;
  return `${prefix}${ENTITY[p.entity_type] ?? p.entity_type} · ${p.op === "create" ? "new" : "change"}`;
}

// Who a follow-up belongs to, said the way the promise was made.
function whose(p: ProposalView, owners: Owner[], me: string, customers: string[]): string {
  const uid = typeof p.payload.owner_user_id === "string" ? p.payload.owner_user_id : null;
  if (uid) return uid === me ? "You owe them" : `${owners.find((o) => o.id === uid)?.name ?? "One of you"} owes them`;
  const name = typeof p.payload.owner === "string" ? p.payload.owner.trim() : "";
  const way = promiseDirection({ owner: name, ownerUserId: null }, owners, customers);
  return way === "theirs" ? `They owe you · ${name}` : way === "ours" ? `You owe them · ${name}` : "No owner yet";
}

export function ChangeDeck({
  proposals,
  owners,
  customers = [],
  me,
  accountName,
  done,
}: {
  proposals: ProposalView[];
  owners: Owner[];
  customers?: string[];
  me: string;
  accountName: string;
  /** Where "done" leads, when that is not the meeting the deck sits on. */
  done?: { href: string; label: string };
}) {
  const router = useRouter();
  // The deck is dealt once. A refresh changes what the server says is
  // pending; it must not reshuffle the cards under someone mid-decision.
  const [cards] = useState(() => buildDeck(proposals));
  const [queue, setQueue] = useState<string[]>(() => cards.map((c) => c.key));
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [later, setLater] = useState<string[]>([]);
  const [ack, setAck] = useState<Record<string, boolean>>({});
  const [checking, setChecking] = useState<string | null>(null);
  // The card being corrected before it is accepted, and what was typed.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const toast = useToast();
  const [pending, start] = useTransition();
  const byKey = useMemo(() => new Map(cards.map((c) => [c.key, c])), [cards]);
  const current = queue[0] ? byKey.get(queue[0]) : undefined;
  const unknownIds = Object.entries(outcomes).filter(([, o]) => o.kind === "unknown").map(([id]) => id);
  const locked = unknownIds.length > 0;
  const finished = !current && !locked;

  useRefreshHold("change-deck", pending ? "A decision is being saved. Wait for its result." : locked ? "A decision's outcome is unknown. Check it first." : null);

  function decide(keys: string[], action: "accept" | "reject") {
    start(async () => {
      const next: Record<string, Outcome> = {};
      for (const key of keys) {
        const card = byKey.get(key)!;
        const edits = editing === key && card.kind === "change" ? editsFor(card.rows[0]!) : undefined;
        // Only rows with no known outcome: after a lost reply a card can hold
        // a row already saved, and sending it again reads as a failure.
        for (const row of card.rows) if (!outcomes[row.id]) next[row.id] = await decideOne(row.id, action, !!ack[key], edits);
      }
      setOutcomes((o) => ({ ...o, ...next }));
      setEditing(null);
      // An unknown outcome keeps its card where it is: nothing moves on until
      // a read says what happened.
      const settled = keys.filter((k) => byKey.get(k)!.rows.every((r) => next[r.id]?.kind !== "unknown"));
      setQueue((q) => q.filter((k) => !settled.includes(k)));
      const accepted = Object.entries(next).filter(([, o]) => o.kind === "accepted").map(([id]) => id);
      if (action === "accept" && accepted.length > 0) {
        const back = keys.filter((k) => byKey.get(k)!.rows.some((r) => accepted.includes(r.id)));
        toast({
          text: accepted.length === 1 ? "Saved" : `${accepted.length} saved`,
          tone: "positive",
          // Undo puts the change back as undecided and the card back in front.
          undo: async () => {
            const undone: string[] = [];
            for (const id of accepted) if (await undoOne(id)) undone.push(id);
            setOutcomes((o) => Object.fromEntries(Object.entries(o).filter(([id]) => !undone.includes(id))));
            setQueue((q) => [...back.filter((k) => byKey.get(k)!.rows.some((r) => undone.includes(r.id))), ...q]);
          },
        });
      }
    });
  }

  function editsFor(p: ProposalView): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of editableFields(p)) {
      if (!(f in draft)) continue;
      const v = editedValue(p.payload[f], draft[f]!);
      if (JSON.stringify(v) !== JSON.stringify(p.payload[f] ?? null)) out[f] = v;
    }
    return out;
  }

  function startEdit(p: ProposalView, key: string) {
    setDraft(Object.fromEntries(editableFields(p).map((f) => [f, p.payload[f] == null ? "" : String(p.payload[f])])));
    setEditing(key);
  }

  // Deciding from the keyboard (DECISIONS #98): a accepts, x turns it down,
  // l leaves it for later, e corrects it first. Never while typing.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  function recheck() {
    start(async () => {
      const updated = { ...outcomes };
      for (const id of unknownIds) {
        setChecking(id);
        try {
          const res = await fetch(`/api/proposals/${id}`, { headers: { accept: "application/json" } });
          const body = (await res.json().catch(() => null)) as { status?: unknown } | null;
          const settled = res.ok ? reconcile(body?.status) : "unknown";
          // A status the read cannot place leaves the row where it was.
          if (settled === "unknown") continue;
          // Pending means nothing was written: the decision is yours again.
          if (settled === "pending") delete updated[id];
          else if (settled === "conflict") updated[id] = { kind: "conflict", fields: "" };
          else updated[id] = settled === "accepted" ? { kind: "accepted" } : { kind: "rejected" };
        } catch {
          // Still unknown; the button stays.
        }
      }
      setChecking(null);
      setOutcomes(updated);
      // A card leaves the queue only when every row in it has a known outcome.
      setQueue((q) => q.filter((k) => !byKey.get(k)!.rows.every((r) => updated[r.id] && updated[r.id]!.kind !== "unknown")));
    });
  }

  const restKeys = queue.filter((k) => {
    const c = byKey.get(k)!;
    return c.lowRisk && !c.needsAck;
  });
  const restCount = restKeys.reduce((n, k) => n + byKey.get(k)!.rows.length, 0);

  if (finished) {
    const all = Object.entries(outcomes);
    const accepted = all.filter(([, o]) => o.kind === "accepted").length;
    const rejected = all.filter(([, o]) => o.kind === "rejected").length;
    const trouble = all.filter(([, o]) => o.kind === "conflict" || o.kind === "error");
    const left = later.reduce((n, k) => n + byKey.get(k)!.rows.length, 0);
    return (
      <section className="animate-card-in rounded-3xl border border-line bg-surface p-6 text-center shadow-raised sm:p-8" data-testid="change-done">
        <svg aria-hidden viewBox="0 0 52 52" className="draw-check mx-auto size-14 text-positive">
          <circle cx="26" cy="26" r="24" className="fill-positive-soft stroke-positive-line" strokeWidth="2" />
          <path d="M15 27l7 7 15-16" className="fill-none stroke-current" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h3 className="mt-4 font-display text-title font-extrabold tracking-tight text-ink-strong">{left > 0 || trouble.length > 0 ? "Done for now." : accepted > 0 ? `${accountName} is up to date.` : "All decided."}</h3>
        <p className="mt-2 text-label text-ink">
          {[accepted && `${accepted} change${accepted === 1 ? "" : "s"} saved`, rejected && `${rejected} turned down`, left && `${left} left for later`].filter(Boolean).join(", ") || "Nothing changed."}
        </p>
        {/* The rest of the page (follow-ups, counts) catches up when you
            ask, not on its own: refreshing here would replace this summary
            the moment it appeared. */}
        {done ? (
          <Link href={done.href} className="mt-5 inline-flex min-h-11 items-center rounded-xl px-4 text-label font-semibold text-accent hover:bg-accent-soft" data-testid="change-done-link">
            {done.label}
          </Link>
        ) : (
          <Button className="mt-5 rounded-xl" variant="quiet" onClick={() => router.refresh()} data-testid="change-show-updated">Show the updated meeting</Button>
        )}
        {trouble.length > 0 && (
          <ul className="mx-auto mt-4 max-w-md space-y-1 text-left text-label text-warning">
            {trouble.map(([id, o]) => (
              <li key={id}>{o.kind === "conflict" ? `Not applied: the record changed since this was proposed${o.fields ? ` (${o.fields})` : ""}.` : o.kind === "error" ? o.message : null}</li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  // An unknown outcome keeps its card at the front of the queue, so there is
  // always a current card while the deck is not finished.
  const card = current!;
  const position = cards.length - queue.length + 1;
  const isGroup = card.kind !== "change";
  const single = card.rows[0]!;
  const mixed = new Set(cards.map((c) => c.rows[0]!.origin_kind)).size > 1;
  const refs = single.source_ref ? [single.source_ref, ...(single.source_ref.refs ?? [])].filter((r) => r.kind && r.kind !== "meeting") : [];
  const canEdit = !isGroup && editableFields(single).length > 0;
  const isEditing = editing === card.key;
  keys.current = (e) => {
    const el = e.target as HTMLElement | null;
    if (e.metaKey || e.ctrlKey || e.altKey || el?.closest("input, textarea, select, [contenteditable=true]") || pending || locked) return;
    if (document.querySelector('[role="dialog"]')) return;
    if (e.key === "a" && !(card.needsAck && !ack[card.key])) decide([card.key], "accept");
    else if (e.key === "x") decide([card.key], "reject");
    else if (e.key === "l") { setLater((l) => [...l, card.key]); setQueue((q) => q.slice(1)); }
    else if (e.key === "e" && canEdit) startEdit(single, card.key);
    else return;
    e.preventDefault();
  };

  return (
    <section aria-label="Proposed changes, one at a time" data-testid="change-deck">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex flex-1 gap-1" aria-hidden>
          {cards.map((c) => (
            <span
              key={c.key}
              className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                c.key === card.key ? "bg-accent" : !queue.includes(c.key) ? (c.rows.every((r) => outcomes[r.id]?.kind === "accepted") ? "bg-positive" : "bg-line-strong") : "bg-surface-sunk"
              }`}
            />
          ))}
        </div>
        <span className="text-micro text-ink-muted" aria-live="polite">{Math.min(position, cards.length)} of {cards.length}</span>
      </div>

      <article key={card.key} className="animate-card-in rounded-3xl border border-line bg-surface p-5 shadow-raised sm:p-7" data-testid="change-card">
        <p className="text-micro font-semibold uppercase tracking-[0.08em] text-accent">{eyebrow(card, mixed)}</p>
        <h3 className="mt-1.5 font-display text-heading font-bold text-ink-strong [overflow-wrap:anywhere] sm:text-title">{headline(card)}</h3>

        {isEditing && (
          <div className="mt-4 space-y-3" data-testid="change-edit">
            {editableFields(single).map((f) => (
              <label key={f} className="grid gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center sm:gap-3">
                <span className="text-micro text-ink-muted">{fieldLabel(f)}</span>
                <input
                  className="min-h-10 rounded-lg border border-line-strong bg-surface px-3 text-label text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  type={/(_date|^due)$/.test(f) && /^\d{4}-\d{2}-\d{2}$/.test(draft[f] ?? "") ? "date" : "text"}
                  value={draft[f] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); decide([card.key], "accept"); } else if (e.key === "Escape") setEditing(null); }}
                  data-testid={`change-edit-${f}`}
                />
              </label>
            ))}
          </div>
        )}
        {!isEditing && !isGroup && single.op === "update" && (
          <dl className="mt-4 space-y-2">
            {changedFields(single).map((f) => (
              <div key={f} className="grid gap-0.5 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-baseline sm:gap-3">
                <dt className="text-micro text-ink-muted">{fieldLabel(f)}</dt>
                <dd className="min-w-0 text-label [overflow-wrap:anywhere]">
                  <Value text={showValue(single.before?.[f], single.names)} />
                  <Icon name="arrow" className="mx-2 inline size-3.5 align-[-0.15em] text-ink-faint" />
                  <Value text={showValue(single.payload[f], single.names)} strong />
                </dd>
              </div>
            ))}
          </dl>
        )}
        {!isEditing && !isGroup && single.op === "create" && (
          <dl className="mt-4 space-y-1.5">
            {changedFields(single).filter((f) => f !== "name" && f !== "title" && f !== "text").map((f) => (
              <div key={f} className="flex gap-3 text-label"><dt className="w-32 shrink-0 text-micro text-ink-muted">{fieldLabel(f)}</dt><dd className="min-w-0 [overflow-wrap:anywhere]"><Value text={showValue(single.payload[f], single.names)} strong /></dd></div>
            ))}
          </dl>
        )}
        {!isGroup && (single.rationale || refs.length > 0) && (
          <p className="mt-4 text-label text-ink-muted" data-testid="change-why">
            {single.rationale && <span className="text-ink">{single.rationale}</span>}
            {single.rationale && refs.length > 0 && " · "}
            {refs.length > 0 && <>Evidence: {evidenceSummary(refs)}</>}
          </p>
        )}
        {!isGroup && single.source_ref?.quote && (
          <blockquote className="mt-4 rounded-2xl bg-surface-sunk px-4 py-3 text-label text-ink">
            <span className="mb-0.5 block text-micro font-semibold text-ink-muted">{single.source_ref.kind === "mail" ? "From the email" : "You wrote"}</span>“{single.source_ref.quote}”
          </blockquote>
        )}

        {isGroup && (
          <ul className="mt-4 divide-y divide-line">
            {card.rows.map((p) => (
              <li key={p.id} className="py-3">
                <p className="font-medium text-ink-strong [overflow-wrap:anywhere]">{showValue(card.kind === "people" ? p.payload.name : p.payload.text)}</p>
                <p className="text-micro text-ink-muted">
                  {card.kind === "people"
                    ? [p.payload.title, p.payload.org].filter(Boolean).map((v) => showValue(v)).join(" · ") || "Details from the notes"
                    : [whose(p, owners, me, customers), p.payload.due ? `by ${showValue(p.payload.due)}` : "no date"].join(" · ")}
                </p>
                {p.source_ref?.quote && <p className="mt-1 text-micro italic text-ink-muted">“{p.source_ref.quote}”</p>}
              </li>
            ))}
          </ul>
        )}

        {card.needsAck && (
          <label className="mt-4 flex items-start gap-2 text-label text-ink">
            <input type="checkbox" className="mt-1 size-4 accent-accent" checked={!!ack[card.key]} onChange={(e) => setAck((a) => ({ ...a, [card.key]: e.target.checked }))} />
            I have read the source excerpt this rests on.
          </label>
        )}

        {locked ? (
          <div className="mt-6 rounded-2xl bg-warning-soft p-4 text-label text-warning ring-1 ring-warning-line" role="status" data-testid="change-unknown">
            <p className="font-semibold">Whether this was saved is not known from here.</p>
            <p className="mt-1">The reply did not arrive. Check the record before deciding again.</p>
            <Button className="mt-3" variant="quiet" disabled={pending} onClick={recheck} data-testid="change-recheck">{checking ? "Checking…" : "Check what happened"}</Button>
          </div>
        ) : (
          <div className="mt-6 flex flex-wrap gap-2.5">
            <Button className="min-h-12 flex-1 whitespace-nowrap rounded-xl sm:flex-none sm:px-6" disabled={pending || (card.needsAck && !ack[card.key])} onClick={() => decide([card.key], "accept")} data-testid="change-accept">
              <Icon name="check" />{isGroup && card.rows.length > 1 ? `Accept all ${card.rows.length}` : isEditing ? "Accept as edited" : "Accept"}
            </Button>
            {canEdit && !isEditing && (
              <Button className="min-h-12 rounded-xl" variant="quiet" disabled={pending} onClick={() => startEdit(single, card.key)} data-testid="change-edit-open">Edit</Button>
            )}
            <Button className="min-h-12 flex-1 whitespace-nowrap rounded-xl sm:flex-none" variant="quiet" disabled={pending} onClick={() => decide([card.key], "reject")} data-testid="change-reject">Not this</Button>
            <Button className="min-h-12 rounded-xl" variant="ghost" disabled={pending} onClick={() => { setLater((l) => [...l, card.key]); setQueue((q) => q.slice(1)); }} data-testid="change-later">Decide later</Button>
          </div>
        )}
        <p className="mt-4 hidden text-micro text-ink-faint sm:block" data-testid="change-keys">
          <kbd>a</kbd> accept · <kbd>x</kbd> not this · <kbd>l</kbd> later{canEdit ? <> · <kbd>e</kbd> edit</> : null}
        </p>
      </article>

      {!locked && restCount > 0 && (
        <button
          type="button"
          disabled={pending}
          onClick={() => decide(restKeys, "accept")}
          className="mt-3 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl text-label font-semibold text-accent transition hover:bg-accent-soft disabled:opacity-50"
          data-testid="change-accept-rest"
        >
          <Icon name="stack" className="size-4" />Accept the rest ({restCount}) · people, follow-ups and dates only
        </button>
      )}
    </section>
  );
}
