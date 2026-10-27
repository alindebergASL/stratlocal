"use client";

import { useEffect, useLayoutEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { updateField } from "@/app/actions";
import { INLINE_FIELDS, type InlineEntity } from "@/lib/inlineFields";
import { fmtDay, fmtMoney, STAGE_LABELS } from "@/lib/format";
import { attempt, type Conflict } from "../attempt";
import { ConflictNotice } from "../ConflictNotice";
import { useRefreshHold } from "../AccountFreshness";
import { useToast } from "./Toaster";

type Value = string | number | null;

// A value you can click and change where it is (DECISIONS #96). It shows the
// new value at once, saves one field with the row's version, says Saved with
// Undo, and on a partner's newer edit explains it rather than overwriting.
// Enter saves, Esc cancels; in a long text, Enter saves and Shift+Enter is a
// new line.
export function InlineField({
  accountId,
  entity,
  id,
  field,
  value,
  version,
  format,
  placeholder = "Add",
  className = "",
  testId,
}: {
  accountId: string;
  entity: InlineEntity;
  id: string;
  field: string;
  value: Value;
  version: number | null;
  /** How the value reads when not editing. Named, so a server page can pass it. */
  format?: "money" | "day";
  placeholder?: string;
  className?: string;
  testId?: string;
}) {
  const spec = INLINE_FIELDS[entity][field]!;
  const toast = useToast();
  const [shown, setShown] = useOptimistic(value);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  // The version this editor last knew: the row's when opened, then whatever
  // each save or refusal reported, so a second edit is measured against the
  // first rather than against the page as it was rendered.
  const [known, setKnown] = useState<number | null>(version);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement>(null);
  useRefreshHold(`inline:${entity}:${id}:${field}`, editing ? "A field is open for editing here." : null);
  useEffect(() => {
    if (!editing) setKnown(version);
  }, [version, editing]);
  useLayoutEffect(() => {
    if (editing) input.current?.focus();
    if (editing && spec.kind === "longtext" && input.current) {
      input.current.style.height = "auto";
      input.current.style.height = `${input.current.scrollHeight + 2}px`;
    }
  }, [editing, spec.kind]);

  const asText = (v: Value) => (v === null || v === undefined ? "" : String(v));
  const read = (v: Value): string => {
    if (v === null || v === undefined || v === "") return "";
    if (format === "money") return fmtMoney(typeof v === "number" ? v : quickMoney(String(v)));
    if (format === "day") return fmtDay(String(v));
    if (spec.kind === "stage") return `${v} · ${STAGE_LABELS[Number(v)] ?? ""}`;
    return asText(v);
  };

  function save(next: string, base: number | null, previous: Value) {
    if (next.trim() === asText(previous).trim()) {
      setEditing(false);
      return;
    }
    start(async () => {
      setShown(next.trim() === "" ? null : next);
      setEditing(false);
      setError(null);
      setConflict(null);
      const r = await attempt(() => updateField(accountId, entity, id, field, next, base));
      if (!r.ok) {
        setDraft(next);
        if (r.conflict) {
          setConflict(r.conflict);
          setKnown(r.conflict.currentVersion);
        } else setError(r.error);
        setEditing(true);
        return;
      }
      const after = r.version ?? null;
      setKnown(after);
      toast({
        text: `${spec.label} saved`,
        undo: async () => {
          const back = await attempt(() => updateField(accountId, entity, id, field, asText(previous), after));
          if (!back.ok) toast({ text: back.conflict ? "Not undone: it has changed since" : back.error });
        },
      });
    });
  }

  if (!editing) {
    const text = read(shown);
    return (
      <span className={`group inline-flex min-w-0 items-baseline ${className}`}>
        <button
          type="button"
          data-testid={testId}
          aria-label={`${spec.label}: ${text || "empty"}. Edit`}
          onClick={() => {
            setDraft(asText(shown));
            setEditing(true);
          }}
          className={`-mx-1 min-w-0 rounded px-1 text-left hover:bg-surface-sunk focus-visible:outline-2 focus-visible:outline-accent ${pending ? "opacity-70" : ""} ${text ? "" : "text-ink-faint"}`}
        >
          <span className="[overflow-wrap:anywhere]">{text || placeholder}</span>
        </button>
      </span>
    );
  }

  const common = {
    ref: input,
    value: draft,
    "aria-label": spec.label,
    "data-testid": testId ? `${testId}-input` : undefined,
    className: "w-full min-w-0 rounded-md border border-accent bg-surface px-2 py-1 text-label text-ink focus:outline-none focus:ring-2 focus:ring-accent/30",
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement>) => setDraft(e.target.value),
    onBlur: () => {
      if (!conflict) save(draft, known, value);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setEditing(false);
        setError(null);
        setConflict(null);
      } else if (e.key === "Enter" && !(spec.kind === "longtext" && e.shiftKey)) {
        e.preventDefault();
        save(draft, known, value);
      }
    },
  };
  return (
    <span className={`inline-flex w-full min-w-0 flex-col gap-1 ${className}`}>
      {spec.kind === "longtext" ? (
        <textarea rows={1} {...common} />
      ) : spec.kind === "stage" ? (
        <select {...common}>
          <option value="">—</option>
          {[1, 2, 3, 4, 5, 6].map((s) => (
            <option key={s} value={s}>
              {s} · {STAGE_LABELS[s]}
            </option>
          ))}
        </select>
      ) : spec.kind === "status" ? (
        <select {...common}>
          {["open", "won", "lost"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      ) : (
        <input type={spec.kind === "date" ? "date" : "text"} inputMode={spec.kind === "money" ? "decimal" : undefined} {...common} />
      )}
      {error && (
        <span role="alert" className="text-micro text-danger" data-testid={testId ? `${testId}-error` : undefined}>
          {error}
        </span>
      )}
      {conflict && (
        <ConflictNotice conflict={conflict} busy={pending} onOverride={() => save(draft, conflict.currentVersion, value)}>
          <button type="button" className="text-label font-semibold text-accent hover:underline" onClick={() => { setConflict(null); setEditing(false); }}>
            Keep theirs
          </button>
        </ConflictNotice>
      )}
    </span>
  );
}

// What a typed amount reads as while it saves: "1.2M", "250k", "$40,000".
// Only for showing it at once; the server parses it properly and its value
// replaces this one when the save comes back.
export function quickMoney(raw: string): number | null {
  const m = /^\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*([kmb])?\s*$/i.exec(raw);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ""));
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? "").toLowerCase() as "k" | "m" | "b"] ?? 1;
  return Math.round(n * mult);
}
