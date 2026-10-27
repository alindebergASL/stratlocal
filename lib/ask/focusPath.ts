// The pure half of lib/ask/focus.ts: reading a focus from a link or a page's
// path, with no database, so ⌘K can use it in the browser.
export type FocusKind = "deal" | "play" | "meeting" | "contact" | "action_item" | "page";
export type AskFocus = { kind: FocusKind; id: string };
const KINDS = new Set<string>(["deal", "play", "meeting", "contact", "action_item", "page"]);

/** "deal:ID" or "page:/pipeline?fq=…", from a link or a form. */
export function parseFocus(raw: string | null | undefined): AskFocus | null {
  if (!raw) return null;
  const at = raw.indexOf(":");
  if (at < 1) return null;
  const kind = raw.slice(0, at);
  const id = raw.slice(at + 1).trim();
  if (!KINDS.has(kind) || !id || id.length > 600) return null;
  if (kind === "page" && (!id.startsWith("/") || id.startsWith("//"))) return null;
  return { kind: kind as FocusKind, id };
}

export const focusParam = (f: AskFocus) => `${f.kind}:${f.id}`;

// A record page's path is the record, not a page about it.
const RECORD_PATHS: Array<[RegExp, Exclude<FocusKind, "page">]> = [
  [/^\/accounts\/[^/]+\/deals\/([^/?#]+)$/, "deal"],
  [/^\/accounts\/[^/]+\/plays\/([^/?#]+)$/, "play"],
  [/^\/accounts\/[^/]+\/meetings\/([^/?#]+)$/, "meeting"],
  [/^\/accounts\/[^/]+\/contacts\/([^/?#]+)$/, "contact"],
  [/^\/follow-ups\/([0-9a-f-]{36})$/, "action_item"],
];

/** What ⌘K asks about from a given page: its record, the page, or nothing. */
export function focusForPath(pathAndQuery: string): AskFocus | null {
  const path = pathAndQuery.split(/[?#]/)[0]!;
  for (const [re, kind] of RECORD_PATHS) {
    const m = re.exec(path);
    if (m) return { kind, id: decodeURIComponent(m[1]!) };
  }
  // Pages where "this page" means nothing beyond the question itself.
  if (path === "/" || path.startsWith("/ask") || path.startsWith("/login") || path.startsWith("/s/") || path.startsWith("/settings")) return null;
  return { kind: "page", id: pathAndQuery.slice(0, 600) };
}

