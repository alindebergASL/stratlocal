// Written summaries (DECISIONS #106). The model writes a few sentences about
// a place (Today, an account), and every sentence must cite the facts it rests
// on: keys from an index built in code from the records. Checked in code:
// a sentence citing a key it was not given fails the run (and is retried); a
// sentence stating a number that none of its cited facts contains is dropped.
// What survives is kept with the fingerprint of the facts it was written from,
// and shown only while the records still match; otherwise the counted text is.
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "../db";
import { runDetached, startRun } from "../ai/guard";
import { UNTRUSTED_RULES } from "../ai/prompts";
import { runStructured, type Finding } from "../ai/runStructured";

/** One citable fact: what the model may cite, and where its chip links. */
export type Fact = { key: string; label: string; href: string | null; facts: string };

export const CitedParagraph = z
  .object({
    sentences: z
      .array(z.object({ text: z.string().min(1).max(300), refs: z.array(z.string().min(1)).min(1).max(4) }).strict())
      .min(1)
      .max(5),
  })
  .strict();
export type CitedParagraph = z.infer<typeof CitedParagraph>;

/** What is kept and shown: each sentence with the facts it cites, as they were. */
export type Written = { sentences: Array<{ text: string; refs: Array<{ key: string; label: string; href: string | null }> }>; at: number };

export function factsHash(facts: Fact[]): string {
  const canonical = [...facts].sort((a, b) => a.key.localeCompare(b.key)).map((f) => `${f.key}\u0000${f.label}\u0000${f.facts}`);
  return createHash("sha256").update(canonical.join("\u0001")).digest("hex").slice(0, 24);
}

export function checkCited(p: CitedParagraph, index: Map<string, Fact>): Finding[] {
  const out: Finding[] = [];
  p.sentences.forEach((s, i) =>
    s.refs.forEach((r, j) => {
      if (!index.has(r)) out.push({ path: `sentences[${i}].refs[${j}]`, message: `"${r}" is not one of the facts you were given; cite only their keys` });
    }),
  );
  return out;
}

const NUMBER = /\d[\d,.]*\d|\d/g;
const norm = (s: string) => s.replace(/,/g, "");

/** Drops sentences that state a number none of their cited facts carries. */
export function sanitizeCited(p: CitedParagraph, index: Map<string, Fact>): { kept: Written["sentences"]; dropped: number } {
  const kept: Written["sentences"] = [];
  let dropped = 0;
  for (const s of p.sentences) {
    const cited = s.refs.map((r) => index.get(r)).filter((f): f is Fact => !!f);
    const source = norm(cited.map((f) => `${f.label} ${f.facts}`).join(" "));
    const numbers = (s.text.match(NUMBER) ?? []).map(norm).map((n) => n.replace(/\.$/, ""));
    if (cited.length === 0 || numbers.some((n) => !source.includes(n))) {
      dropped++;
      continue;
    }
    kept.push({ text: s.text.trim(), refs: cited.map((f) => ({ key: f.key, label: f.label, href: f.href })) });
  }
  return { kept, dropped };
}

/** The kept paragraph for `key`: only while it matches `hash`, or as written when `hash` is null. */
export function writtenFor(key: string, hash: string | null): Written | null {
  const row = db().prepare(`SELECT input_hash, json FROM written WHERE key = ?`).get(key) as { input_hash: string; json: string } | undefined;
  if (!row || (hash !== null && row.input_hash !== hash)) return null;
  try {
    return JSON.parse(row.json) as Written;
  } catch {
    return null;
  }
}

function keep(key: string, hash: string, runId: string, w: Written) {
  db()
    .prepare(`INSERT INTO written (key, input_hash, run_id, json, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET input_hash = excluded.input_hash, run_id = excluded.run_id, json = excluded.json, created_at = excluded.created_at`)
    .run(key, hash, runId, JSON.stringify(w), w.at);
}

export function writingNow(key: string): boolean {
  return !!db().prepare(`SELECT 1 FROM ai_runs WHERE kind = 'summary' AND status = 'running' AND input_summary = ?`).get(key);
}

const BASE_SYSTEM = `You write a short paragraph for two sellers from facts about their accounts, given as JSON with a key for each fact.

${UNTRUSTED_RULES}

Rules:
- Every sentence cites the keys of the facts it rests on, in "refs". Cite only keys you were given.
- State only what the facts say. Copy every number, date and amount exactly as a fact gives it; never compute or estimate one.
- Plain, direct sentences in the sellers' register. No advice beyond the next obvious step, no adjectives about how things are going, no "great news".`;

/**
 * Starts writing `key` from `facts`, unless what is kept already matches or a
 * run for it is going. Returns the run id, or null when nothing was started.
 */
export function startWriting(input: { key: string; facts: Fact[]; task: string; userId: string | null; assistant?: "writer"; once?: boolean }): string | null {
  if (input.facts.length === 0) return null;
  const hash = factsHash(input.facts);
  // `once`: one version per key (Today's morning and afternoon summaries),
  // however the counts move after it; otherwise a new one when the facts do.
  if (writtenFor(input.key, input.once ? null : hash) || writingNow(input.key)) return null;
  const run = startRun({ role: "summary", accountId: null, userId: input.userId, inputSummary: input.key, assistant: input.assistant ?? "writer" });
  const index = new Map(input.facts.map((f) => [f.key, f]));
  runDetached(run.id, async (stages) => {
    const { data } = await runStructured({
      role: "summary",
      stageName: "summary",
      system: `${BASE_SYSTEM}\n\n${input.task}`,
      user: JSON.stringify({ facts: input.facts.map((f) => ({ key: f.key, about: f.label, facts: f.facts })) }),
      schema: CitedParagraph,
      effort: "medium",
      maxTokens: 2000,
      check: (p) => checkCited(p, index),
      fakeContext: { facts: input.facts },
      stages,
    });
    const { kept, dropped } = sanitizeCited(data, index);
    if (kept.length > 0) keep(input.key, hash, run.id, { sentences: kept, at: Date.now() });
    return { sentences: kept.length, dropped };
  });
  return run.id;
}
