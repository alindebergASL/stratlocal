// Turns an exported HTML report into bounded plain text the model can read.
// Tables become one line per row with " | " between cells, label/value
// pairs become "label: value", headings are marked, everything else is
// flattened. No readability heuristics: they strip the tables we need most.
import { parseHTML } from "linkedom";

export const HTML_TEXT_CAP = 60_000;

const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "HEAD"]);
const BLOCK = new Set(["P", "DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER", "MAIN", "UL", "OL", "LI", "BR", "TR", "TABLE", "H1", "H2", "H3", "H4", "H5", "H6", "DL", "DT", "DD"]);

type Node = { nodeType: number; nodeName: string; textContent: string | null; childNodes: Node[]; getAttribute?: (n: string) => string | null; classList?: { contains: (c: string) => boolean } };

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function hasBlockDescendant(n: Node): boolean {
  for (const c of n.childNodes) {
    if (c.nodeType !== 1) continue;
    if (BLOCK.has(c.nodeName) || c.nodeName === "TABLE") return true;
    if (hasBlockDescendant(c)) return true;
  }
  return false;
}

function cellText(cell: Node): string {
  // <br> and nested blocks inside a cell become " / " so multi-line cells stay one row.
  const parts: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3) {
      parts.push(n.textContent ?? "");
      return;
    }
    if (n.nodeType !== 1 || SKIP.has(n.nodeName)) return;
    if (n.nodeName === "BR") {
      parts.push(" / ");
      return;
    }
    for (const c of n.childNodes) walk(c);
    if (BLOCK.has(n.nodeName)) parts.push(" / ");
  };
  walk(cell);
  return clean(parts.join("")).replace(/(?:\s*\/\s*)+$/, "").replace(/(?:\s*\/\s*){2,}/g, " / ");
}

export function htmlToText(html: string, cap = HTML_TEXT_CAP): string {
  const { document } = parseHTML(html);
  const out: string[] = [];
  const push = (line: string) => {
    const t = clean(line);
    if (t) out.push(t);
  };

  const walk = (n: Node) => {
    if (n.nodeType === 3) {
      push(n.textContent ?? "");
      return;
    }
    if (n.nodeType !== 1 || SKIP.has(n.nodeName)) return;
    const name = n.nodeName;

    if (name === "TABLE") {
      const rows = (n as unknown as { querySelectorAll: (s: string) => Node[] }).querySelectorAll("tr");
      for (const tr of rows) {
        const cells = (tr as unknown as { querySelectorAll: (s: string) => Node[] }).querySelectorAll("th, td");
        const ownCells = cells.filter((c) => {
          // Only direct cells of this row (nested tables are rare but real).
          let p = (c as unknown as { parentNode: Node | null }).parentNode;
          while (p && p.nodeName !== "TR") p = (p as unknown as { parentNode: Node | null }).parentNode;
          return p === tr;
        });
        push(ownCells.map(cellText).join(" | "));
      }
      out.push("");
      return;
    }

    if (/^H[1-6]$/.test(name)) {
      push(`## ${cellText(n)}`);
      return;
    }

    // Header metadata: a label element followed by its value.
    const cls = n.classList;
    if (cls && (cls.contains("meta-item") || cls.contains("kpi-card"))) {
      const label = (n as unknown as { querySelector: (s: string) => Node | null }).querySelector(".meta-label, .kpi-label");
      const value = (n as unknown as { querySelector: (s: string) => Node | null }).querySelector(".meta-value, .kpi-val");
      if (label && value) {
        const sub = (n as unknown as { querySelector: (s: string) => Node | null }).querySelector(".kpi-sub");
        push(`${cellText(label)}: ${cellText(value)}${sub ? ` (${cellText(sub)})` : ""}`);
        return;
      }
    }

    if (name === "LI") {
      push(`- ${cellText(n)}`);
      return;
    }

    // A block with only inline content is one line; inline markup like
    // <strong> or <em> must not split a sentence across lines.
    if (BLOCK.has(name) && !hasBlockDescendant(n)) {
      push(cellText(n));
      return;
    }

    for (const c of n.childNodes) walk(c);
    if (BLOCK.has(name)) out.push("");
  };

  walk(document.documentElement as unknown as Node);

  // Collapse runs of blank lines, then cap.
  const text = out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > cap ? text.slice(0, cap) + "\n…[truncated]" : text;
}

export function looksLikeHtml(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 2048).toString("utf8").toLowerCase();
  return head.includes("<html") || head.includes("<!doctype html") || head.includes("<body");
}
