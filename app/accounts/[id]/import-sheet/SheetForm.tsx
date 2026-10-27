"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Button, ButtonLink, Callout, controlSm } from "@/components/ui";
import { fieldsFor, guessMapping, KIND_LABELS, type SheetField, type SheetKind, type SheetMapping } from "@/lib/sheet/columns";

type Preview = {
  documentId: string;
  filename: string;
  headers: string[];
  rows: number;
  sample: string[][];
  kind: SheetKind;
  mapping: SheetMapping;
  problems: string[];
};

type ApplyResult = { batchId: string; proposals: number; skipped: Array<{ row: number; why: string }>; rows: number; kind: SheetKind; warning?: string };

// Two steps, and the second one is the point.
//
// The first POST keeps the file and returns a guess at which column is which.
// Nothing is proposed until the mapping comes back confirmed, because the way
// this goes wrong is not "it fails" — it is a plausible wrong guess writing a
// date into the value column across a whole pipeline, one card at a time, each
// one looking individually reasonable on the review screen.
export function SheetForm({ accountId }: { accountId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [kind, setKind] = useState<SheetKind>("deal");
  // The date the snapshot describes, for the one kind that has one. Defaults
  // to today and is bounded by it, exactly as the report import's field is —
  // and for the same reason (DECISIONS #19): filed under the wrong date, a
  // snapshot invents a movement that never happened.
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [mapping, setMapping] = useState<SheetMapping>({});
  const [result, setResult] = useState<ApplyResult | null>(null);

  async function post(url: string, body: FormData | object): Promise<unknown> {
    const res = await fetch(url, {
      method: "POST",
      ...(body instanceof FormData ? { body } : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  }

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const p = (await post(`/api/accounts/${accountId}/import-sheet`, fd)) as Preview;
      setPreview(p);
      setKind(p.kind);
      setMapping(p.mapping);
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      setResult((await post(`/api/accounts/${accountId}/import-sheet/apply`, { documentId: preview.documentId, mapping, kind, asOf })) as ApplyResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Changing what the file is changes which fields exist, so the mapping is
  // guessed again from scratch. Keeping the old one would leave Close Date
  // pointing at a column on a screen that no longer shows it, and the apply
  // route reads only the fields of the kind it was given — so the leftover
  // would vanish silently rather than be refused.
  function changeKind(next: SheetKind) {
    setKind(next);
    setMapping(preview ? guessMapping(preview.headers, next) : {});
  }

  const fields = fieldsFor(kind);

  // Which column each field is set to, and what is wrong with that — computed
  // here rather than taken from the upload response, because the person is
  // about to change it.
  const chosen = new Map<number, SheetField[]>();
  for (const spec of fields) {
    const i = mapping[spec.field];
    if (typeof i === "number") chosen.set(i, [...(chosen.get(i) ?? []), spec.field]);
  }
  // Every kind has one field a row cannot do without; which one it is comes
  // from the field table rather than being named here a second time.
  const requiredField = fields.find((f) => f.required);
  const missingRequired = !requiredField || mapping[requiredField.field] === null || mapping[requiredField.field] === undefined;
  const doubled = [...chosen.entries()].filter(([, f]) => f.length > 1);
  const ready = preview !== null && !missingRequired && doubled.length === 0 && (kind !== "install_base" || asOf !== "");

  return (
    <div>
      <form onSubmit={upload} className="flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          required
          aria-label="Spreadsheet file"
          data-testid="sheet-file"
          className="min-w-0 flex-1 text-label file:mr-3 file:rounded-md file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-label file:font-semibold file:text-ink-invert hover:file:bg-ink-strong"
        />
        <Button type="submit" disabled={busy} aria-busy={busy} data-testid="sheet-upload">
          {busy && !preview ? "Reading…" : "Read the columns"}
        </Button>
      </form>

      <div role="status" aria-live="polite">
        {error && (
          <Callout tone="danger" className="mt-3" testId="sheet-error">
            {error}
          </Callout>
        )}
      </div>

      {preview && !result && (
        <div className="mt-5" data-testid="sheet-mapping">
          <p className="text-label text-ink-muted">
            <strong className="text-ink">{preview.filename}</strong> · {preview.rows} row{preview.rows === 1 ? "" : "s"} ·{" "}
            {preview.headers.length} column{preview.headers.length === 1 ? "" : "s"}. Check each one before anything is proposed.
          </p>

          {/* What the file is, guessed from the headers and confirmed here for
              the same reason the mapping is: read as the wrong kind it does not
              fail, it proposes the wrong records, and each card reads plausibly
              on its own. */}
          <fieldset className="mt-3">
            <legend className="text-label font-medium text-ink">This file is a list of</legend>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {(["deal", "contact", "install_base"] as const).map((k) => (
                <label key={k} className="flex items-center gap-2 text-label">
                  <input
                    type="radio"
                    name="sheet-kind"
                    value={k}
                    checked={kind === k}
                    onChange={() => changeKind(k)}
                    data-testid={`sheet-kind-${k}`}
                    className="size-4 accent-accent"
                  />
                  {KIND_LABELS[k]}
                </label>
              ))}
              <span className="text-micro text-ink-faint">
                {kind === "contact"
                  ? "People are matched by email, then by name. Anyone with no match becomes a new person at the customer."
                  : kind === "install_base"
                    ? "A snapshot holds one line per product family, on the date you give below."
                    : "Deals are matched on the CRM id and nothing else."}
              </span>
            </div>
          </fieldset>

          {kind === "install_base" && (
            // Not a column, on purpose. A file whose rows each claimed their
            // own date would be several snapshots wearing one upload, and the
            // trend is read off exactly this date.
            <label className="mt-3 flex flex-wrap items-baseline gap-2">
              <span className="w-28 shrink-0 text-label font-medium text-ink">
                Snapshot date<span className="text-danger"> *</span>
              </span>
              <input
                type="date"
                value={asOf}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setAsOf(e.target.value)}
                data-testid="sheet-as-of"
                className={controlSm}
              />
              <span className="text-micro text-ink-faint">The date this describes, not the date you are importing it.</span>
            </label>
          )}

          <div className="mt-3 space-y-2">
            {fields.map((spec) => {
              const value = mapping[spec.field];
              const clash = typeof value === "number" && (chosen.get(value)?.length ?? 0) > 1;
              return (
                <div key={spec.field} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <label className="flex items-baseline gap-2">
                    <span className="w-28 shrink-0 text-label font-medium text-ink">
                      {spec.label}
                      {spec.required && <span className="text-danger"> *</span>}
                    </span>
                    <select
                      name={spec.field}
                      data-testid={`map-${spec.field}`}
                      value={value === null || value === undefined ? "" : String(value)}
                      onChange={(e) => setMapping((m) => ({ ...m, [spec.field]: e.target.value === "" ? null : Number(e.target.value) }))}
                      className={`${controlSm} ${clash ? "border-danger-line" : ""}`}
                    >
                      <option value="">— not in this file —</option>
                      {preview.headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h || `(column ${i + 1})`}
                        </option>
                      ))}
                    </select>
                  </label>
                  {typeof value === "number" && preview.sample.length > 0 && (
                    // What that column actually holds. A label can be wrong and
                    // still look right; the first values cannot.
                    <span className="min-w-0 truncate text-micro text-ink-muted">
                      {preview.sample
                        .map((r) => r[value])
                        .filter((v) => v)
                        .slice(0, 3)
                        .join(" · ") || "every sampled row is blank here"}
                    </span>
                  )}
                  {spec.hint && value === null && <span className="text-micro text-ink-faint">{spec.hint}</span>}
                </div>
              );
            })}
          </div>

          {(missingRequired || doubled.length > 0) && (
            <Callout tone="warning" className="mt-3" testId="sheet-mapping-problem">
              {missingRequired && <p>Nothing is mapped to {requiredField?.label ?? "the required column"}, and a row needs one.</p>}
              {doubled.map(([i, clashing]) => (
                <p key={i}>
                  “{preview.headers[i]}” is mapped to {clashing.map((f) => fields.find((s) => s.field === f)?.label ?? f).join(" and ")}. Pick one.
                </p>
              ))}
            </Callout>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={apply} disabled={busy || !ready} aria-busy={busy} data-testid="sheet-apply">
              {busy ? "Reading the rows…" : "Propose the changes"}
            </Button>
            <span className="text-micro text-ink-muted">Nothing is written until you accept them on the review screen.</span>
          </div>
        </div>
      )}

      {result && (
        <Callout tone={result.proposals > 0 ? "positive" : "neutral"} className="mt-4" testId="sheet-result">
          {result.proposals > 0 ? (
            <>
              <p>
                <strong className="tabular-nums">{result.proposals}</strong> proposed change{result.proposals === 1 ? "" : "s"} from{" "}
                {result.rows} row{result.rows === 1 ? "" : "s"}
              </p>
              <ButtonLink href={`/inbox?kind=changes&account=${accountId}`} variant="positive" className="mt-2">
                Review them
              </ButtonLink>
            </>
          ) : (
            <p>
              Nothing to propose: every row in this file already matches what is on file.{" "}
              <Link href={`/accounts/${accountId}`} className="underline">
                Back to the account.
              </Link>
            </p>
          )}
          {/* What a partial file is about to do to the trend. Said here rather
              than discovered on the account page, because every review card
              for it is a perfectly ordinary create and nothing on the review
              screen could tell you. */}
          {result.warning && (
            <p className="mt-2 border-l-2 border-warning-line pl-2 text-micro" data-testid="sheet-warning">
              {result.warning}
            </p>
          )}
          {/* Every row that could not be read, by row number and reason. A
              count on its own is not something anyone can act on, and a row
              silently missing from an import is exactly the failure this
              screen exists to avoid. */}
          {result.skipped.length > 0 && (
            <details className="mt-2" data-testid="sheet-skipped">
              <summary className="cursor-pointer text-micro">
                {result.skipped.length} row{result.skipped.length === 1 ? "" : "s"} could not be read
              </summary>
              <ul className="mt-1 list-disc pl-5 text-micro">
                {result.skipped.map((s) => (
                  <li key={s.row}>
                    Row {s.row}: {s.why}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Callout>
      )}
    </div>
  );
}
