import type { ResearchFinding } from "@/lib/research/schema";
import { sourceTitle } from "@/lib/research/sourceTitle";
import { safeSourceUrl } from "./SourceLink";

// A readable destination label, not a publisher assertion or trust upgrade.
export function findingSourceIdentity(finding: ResearchFinding): { label: string; href?: string } {
  if (!safeSourceUrl(finding.url)) return { label: "Source unavailable" };
  const url = new URL(finding.url);
  const evidence = finding.evidence;
  const citation = evidence?.citation;
  const bound = evidence?.kind === "source_excerpt" && evidence.url === finding.url
    && (citation?.url === undefined || citation.url === finding.url);
  const title = bound ? sourceTitle(citation?.title) : undefined;
  const destination = `${url.host}${url.pathname === "/" ? "" : url.pathname}${url.search}${url.hash}`;
  return { label: title ? `${title} — ${url.host}` : destination, href: finding.url };
}
