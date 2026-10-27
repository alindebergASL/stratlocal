"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { followUpMetadata } from "@/lib/followUpMetadata";
import { ArchiveButton } from "./ArchiveButton";
import { archiveRecord } from "@/app/actions";
import { attempt, type ActionResult } from "./attempt";
import { Button, controlSm } from "./ui";
import { useRefreshHold } from "./AccountFreshness";

type Result = ActionResult;

export type Owner = { id: string; name: string };

export type ActionItemView = {
  id: string;
  text: string;
  owner: string | null;
  ownerUserId: string | null;
  due: string | null;
  status: "open" | "done";
  quote: string | null;
  meetingTitle: string | null;
  version: number | null;
  /** Which play it belongs to, where the surface offers a play picker. */
  playId?: string | null;
  /** Optional exact landing in the assignee-scoped work list. */
  workHref?: string;
  sources?: { label: string; href?: string }[];
};

export type PlayOption = { id: string; title: string; archived: boolean };

// Declared here, not inside ActionItems.
//
// It used to be a function in the component body, which makes a new component
// type on every render: React cannot match the old element to the new one, so
// it threw the form away and built another. Every re-render of the list —
// ticking any other follow-up, and any re-render from the server — silently
// wiped what was half typed into an open editor, because uncontrolled fields
// live in DOM that had just been discarded. One editor, one identity, and what
// is typed into it survives the page being re-rendered underneath it.
function FollowUpEditor({
  item,
  owners,
  plays,
  me,
  saving,
  formError,
  baseVersion,
  onSubmit,
  onCancel,
}: {
  item?: ActionItemView;
  owners: Owner[];
  plays?: PlayOption[];
  me?: string;
  saving: boolean;
  formError: string | null;
  baseVersion: number | null;
  onSubmit: (itemId: string | null, form: HTMLFormElement) => void;
  onCancel: () => void;
}) {
  // "The customer" is an owner too: a promise they made is still a follow-up
  // worth tracking, and Promise keeper reads it as theirs by the name here.
  const [whose, setWhose] = useState(item ? (item.ownerUserId ?? (item.owner?.trim() && !owners.some((o) => o.name === item.owner) ? "theirs" : "")) : (me ?? ""));
  return (
    <form
      data-testid="follow-up-form"
      className="animate-rise mt-1 flex flex-wrap items-end gap-2 rounded-lg bg-surface-sunk p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(item?.id ?? null, e.currentTarget);
      }}
    >
      {item && baseVersion !== null && <input type="hidden" name="base_version" value={String(baseVersion)} readOnly />}
      <label className="min-w-0 flex-1 basis-full sm:basis-64">
        <span className="mb-0.5 block text-micro text-ink-muted">What needs doing</span>
        <input
          name="text"
          defaultValue={item?.text ?? ""}
          required
          autoFocus
          placeholder="Send the storage sizing document"
          className={controlSm}
        />
      </label>
      <label>
        <span className="mb-0.5 block text-micro text-ink-muted">Owner</span>
        <select value={whose} onChange={(e) => setWhose(e.target.value)} className={controlSm} data-testid="follow-up-owner">
          {/* Blank is a real answer: nobody has taken it yet. */}
          <option value="">unassigned</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
          <option value="theirs">the customer</option>
        </select>
        <input type="hidden" name="owner_user_id" value={whose === "theirs" ? "" : whose} readOnly />
      </label>
      {whose === "theirs" && (
        <label>
          <span className="mb-0.5 block text-micro text-ink-muted">Who promised it</span>
          <input name="owner" required maxLength={120} defaultValue={item?.owner ?? ""} placeholder="Customer name" className={`${controlSm} w-40`} data-testid="follow-up-their-name" />
        </label>
      )}
      <label>
        <span className="mb-0.5 block text-micro text-ink-muted">Due</span>
        <input type="date" name="due" defaultValue={item?.due ?? ""} className={controlSm} />
      </label>
      {plays && plays.length > 0 && (
        <label>
          <span className="mb-0.5 block text-micro text-ink-muted">Play</span>
          <select name="play_id" defaultValue={item?.playId ?? ""} className={controlSm} data-testid="follow-up-play">
            <option value="">not part of a play</option>
            {plays.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
                {p.archived ? " (archived)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {formError && (
        <p role="alert" className="basis-full text-micro font-medium text-danger">
          {formError}
        </p>
      )}
      <div className="flex gap-1.5">
        <Button type="submit" size="sm" disabled={saving} aria-busy={saving} data-testid="follow-up-save">
          {saving ? "Saving…" : item ? "Save" : "Add"}
        </Button>
        <Button type="button" variant="quiet" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function ActionItems({
  items,
  setStatus,
  setMany,
  save,
  owners = [],
  plays,
  me,
  emptyText,
  today,
  startOpen = false,
  compactEmpty = false,
}: {
  items: ActionItemView[];
  setStatus: (id: string, status: "open" | "done", baseVersion?: number | null) => Promise<Result>;
  // Clearing several at once is how this actually gets used: you come out of a
  // call and four things are done.
  setMany?: (ids: string[], status: "open" | "done", baseVersions?: Record<string, number>) => Promise<Result>;
  // Writing one down, and correcting one. Absent on the read-only surfaces.
  save?: (itemId: string | null, fd: FormData) => Promise<Result>;
  owners?: Owner[];
  /**
   * The plays this account has, where the surface offers the picker.
   *
   * Optional, and absent means the control is not rendered at all — which
   * matters because `saveActionItem` reads play_id through `present()`, so a
   * form that does not render the field leaves the link untouched rather than
   * clearing it. Built by `playOptionsFor`, which is also what keeps a play
   * that has since been archived in the list when an item still points at it.
   *
   * Not passed on /follow-ups: that page groups by account, so this would
   * carry every account's plays onto a page you go to in order to triage
   * rather than to file.
   */
  plays?: PlayOption[];
  // Who is looking. A follow-up you type on an account is almost always one
  // you are taking on, so that is the default — leaving it blank made the
  // commonest case land unowned, which is exactly the state that kept these
  // off every list worth having.
  me?: string;
  emptyText: string;
  // What day it is, decided on the server in the app's timezone. Asking the
  // browser would use whatever zone the laptop is in and, worse, disagree with
  // the server's answer on the first render.
  today: string;
  /** Open the add editor on mount. The page above owns the primary Add
   *  control, and it says which list that control writes into by rendering
   *  that one list open — rather than reaching across two components for a
   *  piece of state that lives in this one. */
  startOpen?: boolean;
  /** Only changes the zero-item framing; the editor still uses the full row. */
  compactEmpty?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  // Ticks apply on screen immediately and are undone only if the server
  // refuses. The whole list used to share one useTransition, so ticking one
  // follow-up disabled every other checkbox until the round trip came back —
  // clearing eight was eight sequential, mutually blocking waits.
  const [optimistic, setOptimistic] = useState<Record<string, "open" | "done">>({});
  const [bulkPending, startBulk] = useTransition();
  const [written, setWritten] = useState<Record<string, number>>({});
  const [inFlight, setInFlight] = useState<Record<string, boolean>>({});
  // null = closed, "" = adding a new one, an id = editing that one.
  const [editing, setEditing] = useState<string | null>(startOpen ? "" : null);
  // The row's version as the editor opened on it, not as the list renders it now.
  const [editBasis, setEditBasis] = useState<number | null>(null);
  const [saving, startSave] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  function submit(itemId: string | null, form: HTMLFormElement) {
    if (!save) return;
    const fd = new FormData(form);
    startSave(async () => {
      setFormError(null);
      const r = await attempt(() => save(itemId, fd));
      if (!r.ok) setFormError(r.error);
      else closeEditor();
    });
  }

  // Editing one of these is work in progress, and an RSC refresh can take the
  // row it belongs to away entirely — the other person archives it, or it
  // moves off the list being rendered — which would delete what is half typed
  // with no notice at all. So an open editor defers the refresh and says so,
  // rather than the refresh quietly winning.
  useRefreshHold("action-item-editor", editing === null ? null : editing === "" ? "A new follow-up is part-written here." : "A follow-up is open for editing here.");

  // The basis stays on `editing` rather than being read from the row on save:
  // props move under an open editor whenever the page re-renders from the
  // server, and a hidden field that follows them submits a base version for a
  // record nobody at this keyboard has read.
  function openEditor(id: string | null, version: number | null) {
    setEditing(id ?? "");
    setEditBasis(version);
    setFormError(null);
  }

  function closeEditor() {
    setEditing(null);
    setEditBasis(null);
    setFormError(null);
  }

  const editorProps = {
    owners,
    plays,
    me,
    saving,
    formError,
    baseVersion: editBasis,
    onSubmit: submit,
    onCancel: closeEditor,
  };

  const addRow = save ? (
    <div className={compactEmpty && items.length === 0 ? (editing === "" ? "basis-full" : "") : "mt-2"}>
      {editing === "" ? (
        <FollowUpEditor {...editorProps} />
      ) : (
        <Button variant="quiet" size="sm" onClick={() => openEditor(null, null)} data-testid="follow-up-add">
          Add a follow-up
        </Button>
      )}
    </div>
  ) : null;

  if (items.length === 0)
    return (
      <div className={compactEmpty ? "flex flex-wrap items-center gap-x-4 gap-y-2" : undefined}>
        <p className={`${compactEmpty ? "py-1" : "py-3"} text-label text-ink-muted`}>{emptyText}</p>
        {addRow}
      </div>
    );

  const statusOf = (a: ActionItemView) => optimistic[a.id] ?? a.status;
  const open = items.filter((a) => statusOf(a) === "open");
  // The newest version known for a row: the render's, or the one a write of
  // ours returned since. Versions only grow, so the larger is the later.
  const versionOf = (a: ActionItemView): number | null => {
    const mine = written[a.id];
    return mine !== undefined && (a.version === null || mine > a.version) ? mine : a.version;
  };
  const learn = (r: Result) => {
    if (!r.ok) return;
    const got = r.versions ?? {};
    setWritten((w) => ({ ...w, ...got }));
  };

  function toggle(a: ActionItemView, next: "open" | "done") {
    // One write per row at a time: a second click sent before the first
    // answered would carry a version the first is about to make old.
    if (inFlight[a.id]) return;
    const before = statusOf(a);
    setError(null);
    setOptimistic((o) => ({ ...o, [a.id]: next }));
    setInFlight((f) => ({ ...f, [a.id]: true }));
    void (async () => {
      const r = await attempt(() => setStatus(a.id, next, versionOf(a)));
      setInFlight((f) => {
        const rest = { ...f };
        delete rest[a.id];
        return rest;
      });
      if (r.ok) {
        if (typeof r.version === "number") setWritten((w) => ({ ...w, [a.id]: r.version! }));
      } else {
        setOptimistic((o) => ({ ...o, [a.id]: before }));
        setError(r.error);
      }
    })();
  }

  function clearAll() {
    if (!setMany) return;
    const ids = open.map((a) => a.id);
    setError(null);
    setOptimistic((o) => ({ ...o, ...Object.fromEntries(ids.map((id) => [id, "done" as const])) }));
    startBulk(async () => {
      const basis = Object.fromEntries(open.map((a) => [a.id, versionOf(a)]).filter((e): e is [string, number] => typeof e[1] === "number"));
      const r = await attempt(() => setMany(ids, "done", basis));
      learn(r);
      if (!r.ok) {
        setOptimistic((o) => {
          const next = { ...o };
          for (const id of ids) delete next[id];
          return next;
        });
        setError(r.error);
      }
    });
  }

  return (
    <div>
      {error && (
        <p role="alert" className="mb-2 text-micro font-medium text-danger">
          {error}
        </p>
      )}
      <ul className="divide-y divide-line">
        {items.map((a) => {
          const status = statusOf(a);
          const overdue = status === "open" && a.due !== null && a.due < today;
          // The label wraps the text as well as the box: this is the app's
          // most-used control and its whole hit target used to be 13 pixels.
          return (
            <li key={a.id} id={`action-${a.id}`} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2 [&_button]:min-h-11 sm:[&_button]:min-h-0">
              <label className="flex min-w-0 basis-full cursor-pointer items-start gap-3 sm:flex-1 sm:basis-auto">
                <input
                  type="checkbox"
                  checked={status === "done"}
                  disabled={!!inFlight[a.id]}
                  onChange={(e) => toggle(a, e.target.checked ? "done" : "open")}
                  className="mt-1 size-4 shrink-0 accent-accent"
                />
                <span className="min-w-0 flex-1">
                  <span className={`block ${status === "done" ? "text-ink-muted line-through" : "text-ink"}`}>{a.text}</span>
                  <span className="block text-micro text-ink-muted">
                    {followUpMetadata(a, owners)}
                    {overdue && <span className="ml-2 font-semibold text-danger">overdue</span>}
                  </span>
                  {a.quote && <span className="mt-1 block border-l-2 border-line pl-2 text-micro text-ink-muted">“{a.quote}”</span>}
                </span>
              </label>
              {a.sources?.map((source, index) => <div key={index} className="basis-full pl-7 text-micro text-ink-muted">{source.href ? <Link href={source.href} className="inline-flex min-h-9 items-center text-accent hover:underline">{source.label} →</Link> : source.label}</div>)}
              {a.workHref && status === "open" && <Link href={a.workHref} className="inline-flex min-h-11 items-center text-label text-accent hover:underline sm:min-h-9">Open in Follow-ups →</Link>}
              {save && editing !== a.id && (
                <Button variant="quiet" size="sm" onClick={() => openEditor(a.id, a.version)}>
                  Edit
                </Button>
              )}
              <Link href={`/follow-ups/${a.id}`} className="inline-flex min-h-11 items-center text-label text-accent hover:underline sm:min-h-9">Task details →</Link>
              <ArchiveButton what={a.text.slice(0, 60)} action={archiveRecord.bind(null, "action_item", a.id)} />
              {editing === a.id && (
                <div className="basis-full">
                  <FollowUpEditor {...editorProps} item={a} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {setMany && open.length > 1 && (
          <Button variant="quiet" size="sm" onClick={clearAll} disabled={bulkPending} aria-busy={bulkPending}>
            {bulkPending ? "Marking…" : `Mark all ${open.length} done`}
          </Button>
        )}
      </div>
      {addRow}
    </div>
  );
}
