import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { DOMParser, parseHTML } from "linkedom";
import { db, DOCS_DIR } from "../db";
import { newId } from "../ids";
import { documentFormat, documentText, MIME } from "../documents/text";
import { readZip } from "./zip";
import { artifact, type Artifact } from "./store";

export type Segment = { locator: string; label: string; text: string };
export type EvidenceText = {
  mime: string;
  segments: Segment[];
  warnings: string[];
};
const MAX_TEXT = 2_000_000;
function xmlText(xml: string, tag: string) {
  // Office text is XML; never render the source markup in the application.
  const document = new DOMParser().parseFromString(xml, "text/xml");
  return Array.from(document.getElementsByTagName(tag))
    .map((n) => n.textContent ?? "")
    .join("\n");
}
export async function extractEvidence(
  filename: string,
  bytes: Buffer,
  signal?: AbortSignal,
): Promise<EvidenceText> {
  const segments: Segment[] = [],
    warnings: string[] = [];
  let mime = "application/octet-stream";
  if (/\.pptx$/i.test(filename)) {
    mime =
      "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    const entries = await readZip(bytes, signal);
    const slides = [...entries.keys()]
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort(
        (a, b) =>
          Number(a.match(/slide(\d+)/)![1]) - Number(b.match(/slide(\d+)/)![1]),
      );
    // Presentation order follows relationship IDs, not numeric filenames.
    const rels =
      entries.get("ppt/_rels/presentation.xml.rels")?.toString() ?? "";
    const presentation = entries.get("ppt/presentation.xml")?.toString() ?? "";
    const relation = new DOMParser().parseFromString(rels, "text/xml");
    const order = Array.from(
      new DOMParser()
        .parseFromString(presentation, "text/xml")
        .getElementsByTagName("p:sldId"),
    )
      .map((n) => {
        const rel = Array.from(
          relation.getElementsByTagName("Relationship"),
        ).find((r) => r.getAttribute("Id") === n.getAttribute("r:id"));
        const target = rel?.getAttribute("Target");
        return target
          ? path.posix.normalize(path.posix.join("ppt", target))
          : "";
      })
      .filter((n) => slides.includes(n));
    if (order.length !== slides.length)
      warnings.push(
        "Slide ordering metadata was incomplete; numbered slide order was used.",
      );
    for (const [index, name] of (order.length === slides.length
      ? order
      : slides
    ).entries()) {
      segments.push({
        locator: `slide:${index + 1}`,
        label: `Slide ${index + 1}`,
        text: xmlText(entries.get(name)!.toString(), "a:t"),
      });
      const slideRel = entries.get(
        `ppt/slides/_rels/${path.posix.basename(name)}.rels`,
      );
      if (slideRel) {
        const notesRel = Array.from(
          new DOMParser()
            .parseFromString(slideRel.toString(), "text/xml")
            .getElementsByTagName("Relationship"),
        ).find((n) => n.getAttribute("Type")?.endsWith("/notesSlide"));
        const target = notesRel?.getAttribute("Target");
        if (target) {
          const notes = entries.get(
            path.posix.normalize(path.posix.join("ppt/slides", target)),
          );
          if (notes)
            segments.push({
              locator: `slide:${index + 1}:notes`,
              label: `Slide ${index + 1} speaker notes`,
              text: xmlText(notes.toString(), "a:t"),
            });
        }
      }
    }
    if (!slides.length) warnings.push("No readable slides found.");
  } else {
    const format = documentFormat(filename, bytes);
    if (!format)
      return {
        mime,
        segments: [],
        warnings: ["Original preserved; this file type has no text extractor."],
      };
    mime = MIME[format];
    if (format === "pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      try {
        const { text } = await extractText(pdf, { mergePages: false });
        (Array.isArray(text) ? text : [text]).forEach((t, i) => {
          segments.push({
            locator: `page:${i + 1}`,
            label: `Page ${i + 1}`,
            text: t,
          });
          if (!t.trim())
            warnings.push(
              `Page ${i + 1} has no readable text; OCR is not enabled.`,
            );
        });
      } finally {
        await pdf.loadingTask.destroy();
      }
    } else if (format === "html") {
      const { document } = parseHTML(bytes.toString("utf8"));
      document
        .querySelectorAll("script,style,iframe,object,noscript")
        .forEach((n) => n.remove());
      let section = "Document",
        i = 0;
      for (const n of Array.from(
        document.querySelectorAll("h1,h2,h3,h4,p,li,table"),
      )) {
        if (n.parentElement?.closest("table,li")) continue;
        if (/^H[1-4]$/.test(n.tagName))
          section = n.textContent?.trim() || section;
        const text =
          n.tagName === "TABLE"
            ? Array.from(n.querySelectorAll("tr"))
                .map((r) =>
                  Array.from(r.querySelectorAll("th,td"))
                    .map((c) => c.textContent?.trim())
                    .join(" | "),
                )
                .join("\n")
            : (n.textContent ?? "");
        if (text.trim())
          segments.push({
            locator: `section:${++i}`,
            label: section,
            text: text.trim(),
          });
      }
      if (!segments.length && document.textContent)
        segments.push({
          locator: "section:1",
          label: "Document",
          text: document.textContent,
        });
    } else if (format === "markdown") {
      const chunks = bytes.toString("utf8").split(/(?=^#{1,6}\s)/m);
      chunks.forEach((text, i) => {
        if (text.trim())
          segments.push({
            locator: `section:${i + 1}`,
            label: text.match(/^#{1,6}\s+(.+)/)?.[1] ?? "Introduction",
            text: text.trim(),
          });
      });
    } else {
      const text =
        format === "json"
          ? JSON.stringify(JSON.parse(bytes.toString("utf8")), null, 2)
          : await documentText(filename, bytes, 20 * 1024 * 1024);
      segments.push({ locator: "section:1", label: "Document", text });
    }
  }
  let remaining = MAX_TEXT;
  for (const segment of segments) {
    if (segment.text.length > remaining)
      warnings.push(`${segment.label} was truncated; consult the original.`);
    segment.text = segment.text.slice(0, remaining);
    remaining -= segment.text.length;
  }
  if (!segments.some((s) => s.text.trim()))
    warnings.push("No readable text. The original is preserved.");
  return { mime, segments, warnings };
}
export async function preserveArtifact(
  filename: string,
  bytes: Buffer,
  signal?: AbortSignal,
): Promise<Artifact> {
  const hash = createHash("sha256").update(bytes).digest("hex");
  const existing = db()
    .prepare("SELECT * FROM local_artifacts WHERE sha256=?")
    .get(hash) as Artifact | undefined;
  if (existing) return existing;
  let parsed: EvidenceText;
  try {
    parsed = await extractEvidence(filename, bytes, signal);
  } catch (e) {
    if (signal?.aborted) throw e;
    parsed = {
      mime: "application/octet-stream",
      segments: [],
      warnings: [
        `Text extraction failed: ${e instanceof Error ? e.message : "unreadable file"}`,
      ],
    };
  }
  const id = hash,
    storage = path.join(DOCS_DIR, `evidence-${hash}.bin`);
  fs.mkdirSync(DOCS_DIR, { recursive: true });
  fs.writeFileSync(storage, bytes, { mode: 0o600 });
  db()
    .prepare("INSERT OR IGNORE INTO local_artifacts VALUES(?,?,?,?,?,?,?,?,?)")
    .run(
      id,
      hash,
      path.basename(filename),
      parsed.mime,
      storage,
      bytes.length,
      JSON.stringify(parsed.segments),
      JSON.stringify(parsed.warnings),
      Date.now(),
    );
  return artifact(id)!;
}
export function linkArtifact(
  artifactId: string,
  accountId: string,
  userId: string,
  meetingId = "",
  audience = "unspecified",
  labels: string[] = [],
) {
  return db().transaction(() => {
    if (
      meetingId &&
      !db()
        .prepare("SELECT 1 FROM meetings WHERE id=? AND account_id=?")
        .get(meetingId, accountId)
    )
      throw new Error("Meeting does not belong to this account");
    const existing = db()
      .prepare(
        "SELECT document_id FROM local_artifact_links WHERE artifact_id=? AND account_id=? AND meeting_id=?",
      )
      .get(artifactId, accountId, meetingId) as
      | { document_id: string }
      | undefined;
    if (existing) return existing.document_id;
    const a = artifact(artifactId);
    if (!a) throw new Error("Evidence not found");
    const sourceText = (JSON.parse(a.segments_json) as Segment[])
      .map((s) => s.text)
      .join("\n");
    // Explicit content markings take precedence over filenames and supplied audience.
    if (/\binternal (?:account strategy|use only|only)\b/i.test(sourceText))
      audience = "internal";
    labels = [
      ...new Set([
        ...labels,
        ...Array.from(sourceText.matchAll(/\[([RCSI])\]/g), (m) => m[1]!),
      ]),
    ];
    const documentId = newId();
    db()
      .prepare(
        "INSERT INTO documents(id,account_id,kind,filename,mime,byte_size,sha256,storage_path,content_text,meta_json,status,created_by,created_at) VALUES(?,?,'other',?,?,?,?,?,?,?,'accepted',?,?)",
      )
      .run(
        documentId,
        accountId,
        a.filename,
        a.mime,
        a.byte_size,
        a.sha256,
        a.storage_path,
        (JSON.parse(a.segments_json) as Segment[])
          .map((s) => `[${s.locator}] ${s.text}`)
          .join("\n\n"),
        JSON.stringify({
          type: "customer_doc",
          artifact_id: artifactId,
          audience,
          author_labels: labels,
        }),
        userId,
        Date.now(),
      );
    db()
      .prepare("INSERT INTO local_artifact_links VALUES(?,?,?,?,?,?)")
      .run(
        artifactId,
        accountId,
        meetingId,
        documentId,
        audience,
        JSON.stringify(labels),
      );
    return documentId;
  })();
}
