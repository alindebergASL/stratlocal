// A synthetic playbook document only; the neutral starter stands in for the
// model's answer under AI_FAKE.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { tinyPdf, USER } from "./helpers";
import { documentText, PlaybookFileError } from "@/lib/playbook/text";
import { startPlaybookImport } from "@/lib/playbook/import";
import { getRun } from "@/lib/ai/guard";

beforeEach(() => {
  vi.stubEnv("AI_FAKE", "1");
  vi.stubEnv("AI_DAILY_CAP_CENTS", "10000");
});
afterEach(() => vi.unstubAllEnvs());


it("reads a playbook's text from a PDF, HTML or plain text, in this process", async () => {
  expect(await documentText("p.pdf", tinyPdf("Synthetic outcome playbook"))).toContain("Synthetic outcome playbook");
  expect(await documentText("p.html", Buffer.from("<html><body><h1>Synthetic steps</h1><p>One.</p></body></html>"))).toContain("Synthetic steps");
  expect(await documentText("p.txt", Buffer.from("Line one\r\n\r\n\r\n\r\nLine two"))).toBe("Line one\n\nLine two");
  await expect(documentText("p.xlsx", Buffer.from("x"))).rejects.toBeInstanceOf(PlaybookFileError);
  await expect(documentText("p.txt", Buffer.alloc(0))).rejects.toThrow(/empty/);
});

it("reads a document into a draft for review, and saves nothing on its own", async () => {
  const text = `Synthetic Region Outcome Playbook\n\n${"A step, an archetype and a question. ".repeat(20)}`;
  const runId = startPlaybookImport({ text, filename: "synthetic.txt", userId: USER });
  await vi.waitFor(() => expect(getRun(runId)?.status).toBe("done"));
  const result = JSON.parse(getRun(runId)!.result_json!);
  expect(result.draft.name).toBe("Synthetic Region Outcome Playbook");
  expect(result.problems).toBeNull();
  expect(result.filename).toBe("synthetic.txt");
  const { currentPlaybook } = await import("@/lib/playbook/store");
  expect(currentPlaybook()).toBeNull();
  expect(() => startPlaybookImport({ text: "Too short", filename: null, userId: USER })).toThrow(/too short/);
});
