// What kind of source a finding came from, and how old it is.
//
// Both are worked out in code from what the finding already carries: its URL
// and its date. Neither is a judgement of whether the sentence is true. They
// answer the two questions a seller asks before repeating a fact to a
// customer: "who said this?" and "is it still current?" The model's own
// confidence answered neither, and now sits behind the evidence disclosure.

export type SourceKind = "Filing" | "Company" | "Public record" | "Press" | "Trade" | "Other";

// Registers of company filings: the account's own sworn statements.
const FILING = ["sec.gov", "sedarplus.ca", "sedar.com", "companieshouse.gov.uk", "company-information.service.gov.uk", "annualreports.com", "emma.msrb.org", "irs.gov", "propublica.org"];
// Wires carry releases the company wrote, so they are its own words.
const WIRES = ["businesswire.com", "prnewswire.com", "globenewswire.com", "accesswire.com", "newswire.com", "einpresswire.com"];
const PRESS = [
  "reuters.com", "bloomberg.com", "wsj.com", "ft.com", "nytimes.com", "washingtonpost.com", "apnews.com", "cnbc.com", "bbc.co.uk", "bbc.com",
  "theguardian.com", "economist.com", "forbes.com", "fortune.com", "axios.com", "businessinsider.com", "latimes.com", "bostonglobe.com",
  "bizjournals.com", "usatoday.com", "npr.org", "politico.com", "barrons.com", "marketwatch.com", "theatlantic.com", "statnews.com",
];
const TRADE = [
  "datacenterdynamics.com", "datacenterknowledge.com", "datacenterfrontier.com", "theregister.com", "computerweekly.com", "techtarget.com",
  "zdnet.com", "cio.com", "ciodive.com", "informationweek.com", "networkworld.com", "fiercehealthcare.com", "fiercebiotech.com",
  "healthcareitnews.com", "beckershospitalreview.com", "modernhealthcare.com", "healthcaredive.com", "edtechmagazine.com", "insidehighered.com",
  "chronicle.com", "edscoop.com", "govtech.com", "statescoop.com", "fedscoop.com", "siliconangle.com", "venturebeat.com", "techcrunch.com",
  "crn.com", "sdxcentral.com", "lightreading.com", "theinformation.com", "arstechnica.com", "wired.com", "darkreading.com", "securityweek.com",
  "bankingdive.com", "americanbanker.com", "utilitydive.com", "supplychaindive.com", "retaildive.com", "constructiondive.com",
];
// Words too common in organisation names to identify one from a host name.
const GENERIC = new Set(["health", "healthcare", "university", "college", "group", "systems", "system", "global", "international", "holdings", "company", "services", "medical", "center", "centre", "network", "bank", "energy", "technologies", "technology", "the", "and", "inc", "corp", "corporation", "limited"]);

function under(host: string, domains: string[]): boolean {
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/** The source's kind, from its address and the account's name. */
// `owner` is the account's name, or its name and its confirmed web domain.
export function sourceKind(url: string, owner?: string | string[]): SourceKind {
  const names = (Array.isArray(owner) ? owner : owner ? [owner] : []).filter((o) => !o.includes("."));
  const domains = (Array.isArray(owner) ? owner : []).filter((o) => o.includes(".")).map((d) => d.toLowerCase().replace(/^www\./, ""));
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "Other";
  }
  if (under(host, FILING)) return "Filing";
  if (under(host, WIRES)) return "Company";
  if (under(host, PRESS)) return "Press";
  if (under(host, TRADE)) return "Trade";
  if (under(host, domains) || names.some((n) => ownedBy(host, n))) return "Company";
  if (/(^|\.)(gov|mil)(\.[a-z]{2})?$/.test(host) || /\.gov\.[a-z]{2}$/.test(host) || host.endsWith(".europa.eu") || host.endsWith(".gc.ca")) return "Public record";
  if (/^(investors?|ir|newsroom|press|media)\./.test(host)) return "Company";
  return "Other";
}

// "examplehealth.org" for "Example Health", or "example.com" for "Example
// Systems": the whole name run together, or one distinctive word of it, as
// the host's own label rather than a path somewhere else.
function ownedBy(host: string, name: string): boolean {
  const labels = host.split(".").slice(0, -1);
  const words = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const joined = words.join("");
  const acronym = words.length > 1 ? words.map((w) => w[0]).join("") : "";
  return labels.some((label) =>
    label === joined || label.includes(joined) || (acronym.length >= 3 && label === acronym) ||
    words.some((w) => w.length >= 4 && !GENERIC.has(w) && (label === w || label.startsWith(w))),
  );
}

/** How old a dated finding is, in words, and whether that is old enough to say so. */
export function findingAge(date: string | null | undefined, today: string): { label: string; stale: boolean; months: number } | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  let months = (ty - y) * 12 + (tm - m) - (td < d ? 1 : 0);
  if (date > today) return { label: "dated ahead", stale: false, months: 0 };
  if (months < 0) months = 0;
  const label =
    months < 1 ? "this month" : months < 24 ? `${months} month${months === 1 ? "" : "s"} old` : `${Math.floor(months / 12)} years old`;
  return { label, stale: months >= 12, months };
}

/** Newest first: a finding's own date, then the run that found it. */
export function newestFirst<T extends { date: string | null; asOf: string }>(a: T, b: T): number {
  return (b.date ?? b.asOf.slice(0, 10)).localeCompare(a.date ?? a.asOf.slice(0, 10)) || b.asOf.localeCompare(a.asOf);
}
