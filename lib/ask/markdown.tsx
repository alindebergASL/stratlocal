// The little markdown Ask writes in, drawn as React elements.
//
// The text comes from a model that has read notes and research written by
// other people, so it is never handed to the browser as HTML: this reads a
// small set of block and inline forms and makes elements of them, and
// anything else is shown as the characters it is. No links, no images, no
// raw HTML — a source is a numbered marker, and the marker is drawn by the
// caller from the checked citation list, never from the text.
import { Fragment, type ReactNode } from "react";

export type Block =
  | { kind: "heading"; level: 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] };

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
const isRule = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const bullet = /^\s*[-*•]\s+(.*)$/;
const numbered = /^\s*\d+[.)]\s+(.*)$/;

/** Splits text into the few blocks the renderer knows. Pure, so it is tested on its own. */
export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "paragraph", text: para.join(" ") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push({ kind: "heading", level: h[1]!.length <= 2 ? 2 : 3, text: h[2]!.replace(/#+\s*$/, "").trim() });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isRule(lines[i + 1]!)) {
      flush();
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim()) rows.push(cells(lines[i++]!));
      i--;
      blocks.push({ kind: "table", head, rows: rows.map((r) => head.map((_, c) => r[c] ?? "")) });
      continue;
    }
    const b = bullet.exec(line) ?? numbered.exec(line);
    if (b) {
      flush();
      const ordered = !bullet.test(line);
      const items: string[] = [b[1]!];
      while (i + 1 < lines.length) {
        const next = lines[i + 1]!;
        const m = ordered ? numbered.exec(next) : bullet.exec(next);
        if (m) items.push(m[1]!);
        // A wrapped item: an indented line that is not a new item.
        else if (/^\s{2,}\S/.test(next) && !bullet.test(next) && !numbered.test(next)) items[items.length - 1] += ` ${next.trim()}`;
        else break;
        i++;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return blocks;
}

export type Marker = (n: number) => ReactNode;

/** Bold, inline code and [n] markers; everything else is text. */
export function inline(text: string, marker: Marker): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[(\d{1,3})\]/g;
  let last = 0;
  let k = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={k++} className="font-semibold text-ink-strong">{m[1]}</strong>);
    else if (m[2] !== undefined) out.push(<code key={k++} className="rounded bg-surface-sunk px-1 text-[0.92em]">{m[2]}</code>);
    else out.push(<Fragment key={k++}>{marker(Number(m[3]))}</Fragment>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function AskMarkdown({ text, marker }: { text: string; marker: Marker }) {
  return (
    <div className="space-y-3 text-body leading-relaxed text-ink [overflow-wrap:anywhere]" data-testid="ask-markdown">
      {parseBlocks(text).map((b, i) => {
        switch (b.kind) {
          case "heading":
            return b.level === 2 ? (
              <h2 key={i} className="pt-1 font-display text-lead font-bold text-ink-strong">{inline(b.text, marker)}</h2>
            ) : (
              <h3 key={i} className="pt-1 text-body font-semibold text-ink-strong">{inline(b.text, marker)}</h3>
            );
          case "paragraph":
            return <p key={i}>{inline(b.text, marker)}</p>;
          case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag key={i} className={`space-y-1 pl-5 ${b.ordered ? "list-decimal" : "list-disc"}`}>
                {b.items.map((item, j) => <li key={j}>{inline(item, marker)}</li>)}
              </Tag>
            );
          }
          case "table":
            return (
              // Cells never break a word: on a phone the table scrolls sideways
              // inside its own box, with the first column held in place.
              <div key={i} className="overflow-x-auto overscroll-x-contain rounded-lg border border-line" data-testid="ask-table">
                <table className="min-w-full text-label">
                  <thead className="bg-surface-sunk text-left text-ink-muted">
                    <tr>
                      {b.head.map((h, j) => (
                        <th key={j} className={`whitespace-nowrap px-3 py-1.5 font-semibold ${j === 0 ? "sticky left-0 bg-surface-sunk" : ""}`}>{inline(h, marker)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {b.rows.map((r, j) => (
                      <tr key={j}>
                        {r.map((c, n) => (
                          <td key={n} className={`whitespace-nowrap px-3 py-1.5 align-top tabular-nums ${n === 0 ? "sticky left-0 bg-surface font-medium text-ink-strong" : ""}`}>{inline(c, marker)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}
