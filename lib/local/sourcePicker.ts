import { db } from "../db";
import { HttpError } from "../auth";
import type { Segment } from "./evidence";

export type SourceSelection = {
  artifactId: string;
  filename: string;
  locations: { locator: string; label: string }[];
  page: number;
  pages: number;
  totalLocations: number;
  preview: { locator: string; label: string; text: string; fullLength: number; truncated: boolean } | null;
  warnings: string[];
  warningCount: number;
};

/** Only account-linked evidence can be inspected; originals remain untouched. */
export function sourceSelection(accountId: string, artifactId: string, requestedPage = 1, locator = ""): SourceSelection {
  const conn = db();
  const missing = () => new HttpError(404, { error: "Source not found for this account" });
  if (!conn.prepare("SELECT 1 FROM local_artifact_links WHERE account_id=? AND artifact_id=?").get(accountId, artifactId)) throw missing();
  const source = conn.prepare("SELECT filename,segments_json,warnings_json FROM local_artifacts WHERE id=?").get(artifactId) as {
    filename: string; segments_json: string; warnings_json: string;
  } | undefined;
  if (!source) throw missing();

  const locations = (JSON.parse(source.segments_json) as Segment[]).filter(segment => segment.text.trim().length > 0);
  const warnings = JSON.parse(source.warnings_json) as string[];
  const pages = Math.max(1, Math.ceil(locations.length / 100));
  const page = Number.isSafeInteger(requestedPage) ? Math.min(pages, Math.max(1, requestedPage)) : 1;
  const selected = locator ? locations.find(segment => segment.locator === locator) : undefined;
  if (locator && !selected) throw new HttpError(404, { error: "Source location not found" });

  return {
    artifactId,
    filename: source.filename,
    locations: locations.slice((page - 1) * 100, page * 100).map(segment => ({ locator: segment.locator, label: segment.label.slice(0, 200) })),
    page,
    pages,
    totalLocations: locations.length,
    preview: selected ? {
      locator: selected.locator,
      label: selected.label.slice(0, 200),
      text: selected.text.slice(0, 12_000),
      fullLength: selected.text.length,
      truncated: selected.text.length > 12_000,
    } : null,
    warnings: warnings.slice(0, 10),
    warningCount: warnings.length,
  };
}
