"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Callout, control } from "@/components/ui";
import { MEDDPICC, MEDDPICC_LABELS, type Playbook } from "@/lib/playbook/schema";
import { savePlaybookAction } from "./actions";

// The playbook, edited in place: every section is a list you can add to,
// reorder, change and remove from, and nothing is saved until Save. A file
// exported from here (or from another team) loads into the editor to be read
// before it is saved, the same as an imported document.

type Kind = "text" | "textarea" | "number" | "select" | "lines" | "multi" | "scores";
type FieldSpec<T> = { key: keyof T & string; label: string; kind: Kind; options?: Array<{ value: string; label: string }>; wide?: boolean };

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36) || "item";
function freshId(name: string, taken: Array<{ id: string }>): string {
  const base = slugify(name);
  let id = base;
  for (let i = 2; taken.some((t) => t.id === id); i++) id = `${base}-${i}`;
  return id;
}

function FieldInput<T>({ spec, value, onChange }: { spec: FieldSpec<T>; value: unknown; onChange: (v: unknown) => void }) {
  const common = `${control} mt-0.5`;
  switch (spec.kind) {
    case "textarea":
      return <textarea rows={3} className={common} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "number":
      return <input type="number" min={1} className={common} value={(value as number) ?? 0} onChange={(e) => onChange(Number(e.target.value))} />;
    case "select":
      return (
        <select className={common} value={(value as string | null) ?? ""} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">—</option>
          {spec.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "lines":
      return <textarea rows={3} className={common} value={((value as string[]) ?? []).join("\n")} onChange={(e) => onChange(e.target.value.split("\n").map((l) => l.trim()).filter(Boolean))} placeholder="One per line" />;
    case "multi": {
      const chosen = new Set((value as string[]) ?? []);
      return (
        <span className="mt-1 flex flex-wrap gap-1.5">
          {spec.options?.map((o) => (
            <label key={o.value} className={`inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-micro ring-1 ${chosen.has(o.value) ? "bg-accent-soft text-ink ring-accent-line" : "text-ink-muted ring-line"}`}>
              <input type="checkbox" className="sr-only" checked={chosen.has(o.value)} onChange={() => onChange(chosen.has(o.value) ? [...chosen].filter((x) => x !== o.value) : [...chosen, o.value])} />
              {o.label}
            </label>
          ))}
        </span>
      );
    }
    case "scores": {
      // How each place to run scores on this criterion, -2 (counts against
      // it) to +2 (counts for it).
      const scores = (value as Record<string, number>) ?? {};
      return (
        <span className="mt-1 grid gap-1.5 sm:grid-cols-3" data-testid="pe-scores">
          {spec.options?.map((o) => (
            <span key={o.value} className="block">
              <span className="block truncate">{o.label}</span>
              <select className={common} value={scores[o.value] ?? 0} onChange={(e) => onChange({ ...scores, [o.value]: Number(e.target.value) })} data-testid={`pe-score-${o.value}`}>
                {[2, 1, 0, -1, -2].map((n) => (
                  <option key={n} value={n}>
                    {n > 0 ? `+${n}` : n} {n === 2 ? "strongly for" : n === 1 ? "for" : n === 0 ? "neutral" : n === -1 ? "against" : "strongly against"}
                  </option>
                ))}
              </select>
            </span>
          ))}
        </span>
      );
    }
    default:
      return <input className={common} value={(value as string | null) ?? ""} onChange={(e) => onChange(e.target.value)} />;
  }
}

function ListEditor<T extends { id: string }>({ title, items, fields, titleOf, make, onChange, testId }: { title: string; items: T[]; fields: Array<FieldSpec<T>>; titleOf: (t: T) => string; make: (taken: T[]) => T; onChange: (items: T[]) => void; testId: string }) {
  const set = (i: number, patch: Partial<T>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <fieldset className="mt-4" data-testid={testId}>
      <legend className="text-micro font-semibold uppercase tracking-[0.06em] text-ink-muted">
        {title} · {items.length}
      </legend>
      <ol className="mt-1 space-y-1.5">
        {items.map((item, i) => (
          <li key={item.id}>
            <details className="rounded-lg border border-line px-3 py-2" data-testid={`${testId}-item`}>
              <summary className="flex cursor-pointer items-center justify-between gap-2 text-label">
                <span className="min-w-0 truncate font-semibold text-ink-strong">{titleOf(item) || "Untitled"}</span>
                <span className="flex shrink-0 gap-1">
                  <button type="button" aria-label="Move up" className="rounded px-1.5 text-ink-muted hover:bg-surface-sunk" onClick={(e) => { e.preventDefault(); move(i, -1); }}>↑</button>
                  <button type="button" aria-label="Move down" className="rounded px-1.5 text-ink-muted hover:bg-surface-sunk" onClick={(e) => { e.preventDefault(); move(i, 1); }}>↓</button>
                  <button type="button" aria-label={`Remove ${titleOf(item)}`} className="rounded px-1.5 text-danger hover:bg-danger-soft" data-testid={`${testId}-remove`} onClick={(e) => { e.preventDefault(); onChange(items.filter((_, j) => j !== i)); }}>✕</button>
                </span>
              </summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {fields.map((f) => (
                  <label key={f.key} className={`block text-micro text-ink-muted ${f.wide || f.kind === "textarea" || f.kind === "lines" || f.kind === "multi" || f.kind === "scores" ? "sm:col-span-2" : ""}`}>
                    {f.label}
                    <FieldInput spec={f} value={item[f.key]} onChange={(v) => set(i, { [f.key]: v } as Partial<T>)} />
                  </label>
                ))}
              </div>
            </details>
          </li>
        ))}
      </ol>
      <Button type="button" variant="quiet" size="sm" className="mt-1.5" data-testid={`${testId}-add`} onClick={() => onChange([...items, make(items)])}>
        Add {title.toLowerCase().replace(/s$/, "")}
      </Button>
    </fieldset>
  );
}

export function PlaybookEditor({ initial, basisId, slug = null }: { initial: Playbook; basisId: string | null; slug?: string | null }) {
  const router = useRouter();
  const [p, setP] = useState<Playbook>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const put = <K extends keyof Playbook>(key: K, value: Playbook[K]) => {
    setSaved(null);
    setP((cur) => ({ ...cur, [key]: value }));
  };
  const roles = p.roles.map((r) => ({ value: r.id, label: r.name }));
  const movements = p.movements.map((m) => ({ value: m.id, label: m.name }));
  const archetypes = p.archetypes.map((a) => ({ value: a.id, label: a.name }));
  const meddpicc = MEDDPICC.map((m) => ({ value: m, label: `${m} · ${MEDDPICC_LABELS[m]}` }));

  function save() {
    setError(null);
    start(async () => {
      const r = await savePlaybookAction(JSON.stringify(p), basisId);
      if (r.ok) {
        setSaved("Saved as a new version.");
        router.refresh();
      } else setError(r.error);
    });
  }

  async function loadFile(file: File) {
    try {
      const data = JSON.parse(await file.text()) as { playbook?: unknown };
      setP((data.playbook ?? data) as Playbook);
      setSaved(null);
      setError(null);
    } catch {
      setError("That file is not a playbook exported from here.");
    }
  }

  return (
    <div className="text-label" data-testid="playbook-editor">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-micro text-ink-muted">
          Name
          <input className={`${control} mt-0.5`} value={p.name} onChange={(e) => put("name", e.target.value)} data-testid="playbook-edit-name" />
        </label>
        <label className="block text-micro text-ink-muted sm:col-span-2">
          The story: how you position, in a few sentences
          <textarea rows={3} className={`${control} mt-0.5`} value={p.summary} onChange={(e) => put("summary", e.target.value)} />
        </label>
      </div>

      <ListEditor title="Roles" testId="pe-roles" items={p.roles} onChange={(v) => put("roles", v)} titleOf={(r) => r.name}
        make={(t) => ({ id: freshId("role", t), name: "New role", responsibilities: "", owns: "" })}
        fields={[{ key: "name", label: "Name", kind: "text" }, { key: "responsibilities", label: "Responsibilities", kind: "textarea" }, { key: "owns", label: "Owns in meetings", kind: "textarea" }]} />

      <ListEditor title="Steps" testId="pe-steps" items={p.steps} onChange={(v) => put("steps", v)} titleOf={(s) => s.name}
        make={(t) => ({ id: freshId("step", t), name: "New step", timebox: null, output: null, owner_role: null, detail: "", checklist: [] })}
        fields={[{ key: "name", label: "Name", kind: "text" }, { key: "timebox", label: "Timebox", kind: "text" }, { key: "output", label: "What it produces", kind: "text" }, { key: "owner_role", label: "Owner", kind: "select", options: roles }, { key: "detail", label: "What happens", kind: "textarea" }, { key: "checklist", label: "Checklist", kind: "lines" }]} />

      <ListEditor title="Archetypes" testId="pe-archetypes" items={p.archetypes} onChange={(v) => put("archetypes", v)} titleOf={(a) => a.name}
        make={(t) => ({ id: freshId("archetype", t), name: "New archetype", posture: "", pain: "", entry_point: "", messaging: "" })}
        fields={[{ key: "name", label: "Name", kind: "text" }, { key: "posture", label: "Posture", kind: "textarea" }, { key: "pain", label: "Pain", kind: "textarea" }, { key: "entry_point", label: "Where to start", kind: "textarea" }, { key: "messaging", label: "Messaging", kind: "textarea" }]} />

      <ListEditor title="Movements" testId="pe-movements" items={p.movements} onChange={(v) => put("movements", v)} titleOf={(m) => m.name}
        make={(t) => ({ id: freshId("movement", t), name: "New movement", purpose: "" })}
        fields={[{ key: "name", label: "Name", kind: "text" }, { key: "purpose", label: "Purpose", kind: "textarea" }]} />

      <ListEditor title="Questions" testId="pe-questions" items={p.questions} onChange={(v) => put("questions", v)} titleOf={(q) => `${q.meddpicc ? `[${q.meddpicc}] ` : ""}${q.text}`}
        make={(t) => ({ id: freshId("q", t), text: "New question?", movement_id: null, meddpicc: null, personas: [], archetypes: [] })}
        fields={[{ key: "text", label: "Question", kind: "textarea" }, { key: "movement_id", label: "Movement", kind: "select", options: movements }, { key: "meddpicc", label: "MEDDPICC", kind: "select", options: meddpicc }, { key: "personas", label: "For (one role per line: CIO, CISO…)", kind: "lines" }, { key: "archetypes", label: "Suits", kind: "multi", options: archetypes }]} />

      <ListEditor title="Workshop" testId="pe-workshop" items={p.workshop} onChange={(v) => put("workshop", v)} titleOf={(s) => `${s.name} · ${s.minutes} min`}
        make={(t) => ({ id: freshId("segment", t), name: "New segment", minutes: 10, focus: "", lead_role: null })}
        fields={[{ key: "name", label: "Name", kind: "text" }, { key: "minutes", label: "Minutes", kind: "number" }, { key: "lead_role", label: "Led by", kind: "select", options: roles }, { key: "focus", label: "Focus", kind: "textarea" }]} />

      {p.placement ? (
        <>
          <ListEditor title="Places to run" testId="pe-options" items={p.placement.options}
            // A place removed takes its scores with it, so no criterion scores somewhere that no longer exists.
            onChange={(v) => {
              const keep = new Set(v.map((o) => o.id));
              put("placement", { options: v, criteria: p.placement!.criteria.map((c) => ({ ...c, scores: Object.fromEntries(Object.entries(c.scores).filter(([k]) => keep.has(k))) })) });
            }}
            titleOf={(o) => o.name}
            make={(t) => ({ id: freshId("place", t), name: "New place to run" })}
            fields={[{ key: "name", label: "Name", kind: "text" }]} />
          <ListEditor title="Placement criteria" testId="pe-placement" items={p.placement.criteria} onChange={(v) => put("placement", { ...p.placement!, criteria: v })} titleOf={(c) => `${c.name} ×${c.weight}`}
            make={(t) => ({ id: freshId("criterion", t), name: "New criterion", weight: 3, scores: {} })}
            fields={[
              { key: "name", label: "What decides it", kind: "text" },
              { key: "weight", label: "Weight (1–5)", kind: "number" },
              { key: "scores", label: "How each place scores on it", kind: "scores", options: p.placement.options.map((o) => ({ value: o.id, label: o.name })) },
            ]} />
        </>
      ) : (
        <Button type="button" variant="quiet" size="sm" className="mt-4" data-testid="pe-placement-start"
          onClick={() => put("placement", { options: [{ id: "place-a", name: "First place to run" }, { id: "place-b", name: "Second place to run" }], criteria: [] })}>
          Add a workload placement rubric
        </Button>
      )}

      <label className="mt-4 block text-micro text-ink-muted">
        Budget calendar
        <textarea rows={2} className={`${control} mt-0.5`} value={p.budget_hints ?? ""} onChange={(e) => put("budget_hints", e.target.value || null)} />
      </label>

      <div className="sticky bottom-0 mt-4 flex flex-wrap items-center gap-3 border-t border-line bg-surface/95 py-3 backdrop-blur">
        <Button onClick={save} disabled={pending} aria-busy={pending} data-testid="playbook-edit-save">
          {pending ? "Saving…" : "Save as a new version"}
        </Button>
        <label className="cursor-pointer text-label text-accent hover:underline">
          Load from a file…
          <input type="file" accept=".json,application/json" className="sr-only" data-testid="playbook-edit-load" onChange={(e) => e.target.files?.[0] && void loadFile(e.target.files[0])} />
        </label>
        <a href={`/api/playbook/export${slug ? `?pb=${slug}` : ""}`} className="text-label text-accent hover:underline" data-testid="playbook-export">
          Download as a file
        </a>
        <span role="status" className="text-micro text-positive">{saved}</span>
      </div>
      {error && (
        <Callout tone="danger" className="mt-2" testId="playbook-edit-error">
          {error}
        </Callout>
      )}
    </div>
  );
}
