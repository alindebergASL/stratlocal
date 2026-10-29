import Link from "next/link";
import type { Artifact } from "@/lib/local/store";
import type { Segment } from "@/lib/local/evidence";

const text = (value: unknown): string =>
  value == null || value === "" ? "Not supplied" :
    typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
const label = (key: string) => key.replaceAll("_", " ");
function Fields({ value }: { value: Record<string, unknown> }) {
  return <dl className="grid gap-2 sm:grid-cols-2">
    {Object.entries(value).map(([key, v]) => <div key={key}>
      <dt className="font-semibold capitalize">{label(key)}</dt>
      <dd className="whitespace-pre-wrap break-words">{text(v)}</dd>
    </div>)}
  </dl>;
}

export function ImportReportDetails({ report }: { report: Record<string, unknown> }) {
  const groups: [string, string][] = [
    ["deals", "Opportunities"], ["team", "Seller team"],
    ["install_base", "Installed base"], ["plays", "Proposed plays"],
  ];
  return <div className="space-y-4">
    <p className="text-label">Reported information for review; not customer-confirmed or accepted account changes. Counts reflect this package, not verified CRM totals. Customer contacts, activity history, and additional research may be in the source previews below.</p>
    {report.account && typeof report.account === "object" && !Array.isArray(report.account) ?
      <Fields value={report.account as Record<string, unknown>} /> : null}
    {groups.map(([key, heading]) => {
      const rows = Array.isArray(report[key]) ? report[key] as unknown[] : [];
      return <section key={key} className="space-y-2">
        <h3 className="font-semibold">{heading} ({rows.length})</h3>
        {!rows.length && <p className="text-label">Not supplied as structured records. This does not establish that none exist.</p>}
        {rows.map((row, i) => {
          const record = row && typeof row === "object" && !Array.isArray(row) ? row as Record<string, unknown> : { value: row };
          return <details key={i} className="rounded border border-line p-3">
            <summary className="cursor-pointer">{text(record.name ?? record.title ?? record.product_family ?? `Record ${i + 1}`)}
              {key === "deals" && <> · {text(record.stage_label)} · Close: {text(record.close_date)} · Owner: {text(record.owner)}</>}
            </summary>
            <div className="mt-3"><Fields value={record} /></div>
          </details>;
        })}
      </section>;
    })}
  </div>;
}

export function ImportSourcePreview({ name, source }: { name: string; source: Artifact }) {
  const segments = JSON.parse(source.segments_json) as Segment[];
  const full = segments.map(s => `${s.label} (${s.locator})\n${s.text}`).join("\n\n");
  const limit = 12000;
  return <details className="rounded border border-line p-3">
    <summary className="cursor-pointer">{name} · {segments.length} extracted sections · {source.byte_size.toLocaleString()} bytes</summary>
    <p className="my-2"><Link className="underline" href={`/evidence/${source.id}`}>Open source and all extracted sections</Link>{" · "}
      <a className="underline" href={`/api/local/files/${source.id}`}>Download original</a></p>
    <pre className="whitespace-pre-wrap break-words text-label">{full.slice(0, limit) || "No text extracted; inspect the original."}</pre>
    {full.length > limit && <p>Preview limited to {limit.toLocaleString()} characters. Open the source for the remaining extracted text.</p>}
  </details>;
}
