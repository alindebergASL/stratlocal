// The text of an uploaded document, read in this process: PDF, Word, HTML,
// Markdown, plain text or JSON. Nothing is uploaded anywhere to read it. Used
// by the playbook import, the account report import and customer documents.
import { htmlToText, looksLikeHtml } from "../import/htmlToText";

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
/** Enough for any report or plan; a JSON export longer than this is clipped. */
const MAX_JSON_CHARS = 400_000;

export class DocumentFileError extends Error {}

export { DOCUMENT_ACCEPT } from "./accept";

export type DocumentFormat = "pdf" | "docx" | "html" | "markdown" | "text" | "json";

export function documentFormat(filename: string, bytes: Buffer): DocumentFormat | null {
  const name = filename.toLowerCase();
  if (name.endsWith(".pdf") || bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".json")) return "json";
  if (name.endsWith(".html") || name.endsWith(".htm") || looksLikeHtml(bytes)) return "html";
  if (name.endsWith(".md") || name.endsWith(".markdown")) return "markdown";
  if (name.endsWith(".txt") || !name.includes(".")) return "text";
  return null;
}

export const MIME: Record<DocumentFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  html: "text/html",
  markdown: "text/markdown",
  text: "text/plain",
  json: "application/json",
};

export async function documentText(filename: string, bytes: Buffer, maxBytes = MAX_DOCUMENT_BYTES): Promise<string> {
  if (bytes.length === 0) throw new DocumentFileError("The file is empty.");
  if (bytes.length > maxBytes) throw new DocumentFileError(`The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  switch (documentFormat(filename, bytes)) {
    case "pdf": {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { text } = await extractText(pdf, { mergePages: true });
      return clean(Array.isArray(text) ? text.join("\n") : text);
    }
    case "docx": {
      const mammoth = await import("mammoth");
      const { value } = await mammoth.extractRawText({ buffer: bytes });
      return clean(value);
    }
    case "html":
      return clean(htmlToText(bytes.toString("utf8")));
    case "json": {
      // Pretty-printed, so a model reads it as easily as a table, and parsed
      // first so a file that is not JSON says so rather than reading as text.
      let parsed: unknown;
      try {
        parsed = JSON.parse(bytes.toString("utf8").replace(/^﻿/, ""));
      } catch {
        throw new DocumentFileError("That file is not valid JSON.");
      }
      const text = JSON.stringify(parsed, null, 2);
      return text.length > MAX_JSON_CHARS ? text.slice(0, MAX_JSON_CHARS) : text;
    }
    case "markdown":
    case "text":
      return clean(bytes.toString("utf8"));
    case null:
      throw new DocumentFileError("Upload a PDF, a Word document (.docx), HTML, Markdown, plain text or JSON.");
  }
}

function clean(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
