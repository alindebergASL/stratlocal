// A report as a 16:9 PowerPoint deck: a title slide, a slide per section
// with its points on the slide and its full text as speaker notes, charts as
// native charts, and the sources last. Built in this process; nothing is
// sent anywhere. Colours come from the caller (the team's own, step 14), so
// the code carries no one's branding.
import PptxGenJS from "pptxgenjs";
import { parseBlocks } from "./markdown";
import { chartToText, markdownToText } from "./plainText";
import type { ChartData } from "./charts";

type Section = { heading: string; body: string; chart?: ChartData };
export type DeckInput = {
  title: string;
  summary: string | null;
  sections: Section[];
  accountName: string | null;
  generatedBy: string;
  generatedAt: string;
  sources: Array<{ n: number; label: string; account?: string | null }>;
};
export type DeckStyle = { accent: string; ink: string; muted: string; font: string; footer: string | null };

export const DEFAULT_DECK_STYLE: DeckStyle = { accent: "0F5F6E", ink: "1F2328", muted: "5B636B", font: "Calibri", footer: null };

const MAX_POINTS = 6;
const MAX_POINT = 160;

const plain = (s: string) =>
  s
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    // Citation markers belong in the notes and the sources slide, not the slide.
    .replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, "")
    .trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** What a section's slide says: its list items, else its sentences, at most six. */
export function slidePoints(body: string): string[] {
  const points: string[] = [];
  for (const b of parseBlocks(body)) {
    if (b.kind === "list") points.push(...b.items.map(plain));
    else if (b.kind === "paragraph") points.push(...plain(b.text).split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/));
    else if (b.kind === "heading") points.push(plain(b.text));
    else points.push(...b.rows.map((r) => r.map(plain).join(" · ")));
  }
  return points.map((p) => p.trim()).filter(Boolean).slice(0, MAX_POINTS).map((p) => clip(p, MAX_POINT));
}

export async function reportDeck(input: DeckInput, style: DeckStyle = DEFAULT_DECK_STYLE): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9"; // 10 x 5.625 in
  pptx.title = input.title;
  pptx.author = input.generatedBy;
  const font = style.font;
  const footer = [style.footer, input.accountName, input.generatedAt.slice(0, 10)].filter(Boolean).join(" · ");
  const frame = (s: PptxGenJS.Slide) => {
    s.background = { color: "FFFFFF" };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: 5.625, fill: { color: style.accent }, line: { color: style.accent } });
    s.addText(footer, { x: 0.5, y: 5.2, w: 9, h: 0.3, fontFace: font, fontSize: 9, color: style.muted });
  };

  const cover = pptx.addSlide();
  frame(cover);
  cover.addText(input.title, { x: 0.5, y: 1.4, w: 9, h: 1.2, fontFace: font, fontSize: 32, bold: true, color: style.ink, valign: "bottom" });
  if (input.summary) cover.addText(clip(plain(markdownToText(input.summary)), 400), { x: 0.5, y: 2.75, w: 9, h: 1.6, fontFace: font, fontSize: 16, color: style.muted, valign: "top" });
  cover.addNotes(`${input.title}\n\n${input.summary ? markdownToText(input.summary) : ""}\n\nPrepared by ${input.generatedBy} on ${input.generatedAt.slice(0, 10)}, from the records on file that day.`);

  for (const section of input.sections) {
    const s = pptx.addSlide();
    frame(s);
    s.addText(section.heading, { x: 0.5, y: 0.3, w: 9, h: 0.8, fontFace: font, fontSize: 24, bold: true, color: style.ink, valign: "middle" });
    const points = slidePoints(section.body);
    const chart = section.chart && section.chart.rows.length ? section.chart : null;
    const textW = chart ? 4.6 : 9;
    if (points.length) {
      s.addText(
        points.map((p) => ({ text: p, options: { bullet: { indent: 18 }, breakLine: true } })),
        { x: 0.5, y: 1.2, w: textW, h: 3.8, fontFace: font, fontSize: points.length > 4 ? 14 : 16, color: style.ink, valign: "top", paraSpaceAfter: 6 },
      );
    }
    if (chart) {
      s.addChart(pptx.ChartType.bar, [{ name: chart.title, labels: chart.rows.map((r) => r.label), values: chart.rows.map((r) => r.value) }], {
        x: 5.3, y: 1.2, w: 4.3, h: 3.8,
        barDir: "bar",
        chartColors: [style.accent],
        showTitle: true, title: chart.title, titleFontSize: 11, titleColor: style.ink, titleFontFace: font,
        catAxisLabelFontSize: 9, valAxisLabelFontSize: 9, catAxisLabelColor: style.muted, valAxisLabelColor: style.muted,
        valGridLine: { style: "none" },
        showValue: true, dataLabelFontSize: 9, dataLabelColor: style.ink,
        valAxisLabelFormatCode: chart.unit === "usd" ? "$#,##0" : "0",
        dataLabelFormatCode: chart.unit === "usd" ? "$#,##0" : "0",
      });
    }
    s.addNotes([markdownToText(section.body), chart ? chartToText(chart) : null].filter(Boolean).join("\n\n"));
  }

  if (input.sources.length) {
    const s = pptx.addSlide();
    frame(s);
    s.addText("Sources", { x: 0.5, y: 0.3, w: 9, h: 0.8, fontFace: font, fontSize: 24, bold: true, color: style.ink });
    const lines = [...input.sources].sort((a, b) => a.n - b.n).slice(0, 18).map((x) => `[${x.n}] ${clip(x.label, 90)}${x.account ? ` (${x.account})` : ""}`);
    s.addText(lines.join("\n"), { x: 0.5, y: 1.2, w: 9, h: 3.8, fontFace: font, fontSize: 11, color: style.muted, valign: "top" });
    s.addNotes("Every point in this deck is drawn from these records, as they stood on the day it was prepared.");
  }

  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}
