// Reading what is already kept for why now and fit.
//
// New runs tag their findings as they are extracted. Notes kept before that
// carry no read, so the brief would be empty on exactly the accounts that
// have the most research. This is one model pass over the kept findings'
// own words — no searching, nothing sent but the findings and the team's
// focus areas — and what it writes is an annotation beside each finding,
// never a change to it (DECISIONS #58).
import { z } from "zod";
import { db } from "../db";
import { BudgetError, runDetached, startRun } from "../ai/guard";
import { runStructured } from "../ai/runStructured";
import { UNTRUSTED_RULES, wrapUntrusted } from "../ai/prompts";
import { getAccount } from "../queries/accounts";
import { focusForResearch } from "../teamDirection";
import { listNotes, type ParsedNote } from "./notes";
import { keptFindings, ResearchMeta, Signal, type FindingRead } from "./schema";
import { readFromModel } from "./extract";

// A pass reads at most this many findings; the rest wait for the next one.
export const READ_BATCH = 120;

const ModelReads = z.object({
  reads: z.array(
    z.object({
      id: z.string(),
      signal: Signal.nullable(),
      owner: z.string().trim().max(120).nullable().optional(),
      fits: z.array(z.string().trim().max(120)).max(4).default([]),
      so_what: z.string().trim().max(240).nullable().optional(),
    }),
  ),
});

/** Kept findings that no read has looked at yet, by note. */
export function unreadKept(accountId: string): Array<{ note: ParsedNote; index: number; id: string }> {
  return listNotes(accountId, "accepted").flatMap((note) => {
    if (note.meta.read_at) return [];
    const kept = new Set(keptFindings(note.meta));
    return note.meta.findings.flatMap((f, index) => (kept.has(f) && !Object.hasOwn(note.meta.reads ?? {}, String(index)) ? [{ note, index, id: `${note.doc.id}#${index}` }] : []));
  });
}

const SYSTEM = `You read findings already kept about one account and mark, for each: whether it is a reason to act now, and which of the seller's focus areas it gives a reason to discuss.

${UNTRUSTED_RULES}

For every finding id you are given, return one entry:
- signal: "compelling_event" when the finding is a dated event at the account that forces a decision whether or not anyone sells to them (a deadline, a contract or support end, a mandate, a funded programme with a start date, a facility opening); "trigger" when something changed recently that makes now a good time to talk (a new leader, an announcement, an award, a reorganisation, a breach) but forces nothing; null otherwise. Most findings are null. Use the finding's date: something years old is rarely a trigger now.
- owner: for a compelling event, the role or named person at the account who owns it when the finding says so; otherwise null.
- fits: which of the focus areas the finding gives a reason to discuss, copied exactly as listed. Empty when none clearly applies; never stretch.
- so_what: when fits is not empty, one plain sentence on why this finding matters to that conversation, under 30 words, written for the seller; otherwise null.
Use only what each finding says. Invent nothing.`;

export function startResearchReads(accountId: string, userId: string): string {
  const account = getAccount(accountId);
  if (!account || account.archived_at) throw new BudgetError("Account missing or archived");
  const pending = unreadKept(accountId);
  if (pending.length === 0) throw new BudgetError("Everything kept has already been read.");
  const batch = pending.slice(0, READ_BATCH);
  const focusAreas = focusForResearch();
  const run = startRun({ role: "plan_draft", kind: "research_reads", accountId, userId, inputSummary: `why now and fit over ${batch.length} kept findings` });
  runDetached(run.id, async (stages) => {
    const items = batch.map(({ note, index, id }) => {
      const f = note.meta.findings[index]!;
      return { id, text: f.text, date: f.date, topic: f.topic };
    });
    const { data } = await runStructured({
      role: "plan_draft",
      stageName: "research_reads",
      schema: ModelReads,
      stages,
      maxTokens: 8000,
      system: SYSTEM,
      user: `${focusAreas.length ? `The seller's focus areas: ${focusAreas.map((a) => JSON.stringify(a)).join(", ")}.` : "The seller has set no focus areas: leave every fits empty."}\n\n${wrapUntrusted("kept findings", JSON.stringify(items))}`,
      fakeContext: { researchReads: { ids: items.map((i) => i.id), focusAreas } },
      check: (d) => {
        const expected = new Set(items.map((it) => it.id));
        const seen = new Set<string>();
        const problems: Array<{ path: string; message: string }> = [];
        d.reads.forEach((r, i) => {
          if (!expected.has(r.id) || seen.has(r.id)) problems.push({ path: `reads.${i}.id`, message: "Use each supplied id exactly once" });
          seen.add(r.id);
        });
        for (const id of expected) if (!seen.has(id)) problems.push({ path: "reads", message: `Missing supplied id: ${id}` });
        return problems;
      },
    });
    const byId = new Map(data.reads.map((r) => [r.id, readFromModel(r, focusAreas)]));
    const conn = db();
    let read = 0;
    conn.transaction(() => {
      for (const note of new Set(batch.map((b) => b.note))) {
        // Read the row again: a re-review may have saved since the pass began.
        const row = conn.prepare("SELECT meta_json FROM documents WHERE id = ?").get(note.doc.id) as { meta_json: string } | undefined;
        if (!row) continue;
        const rawMeta = JSON.parse(row.meta_json) as Record<string, unknown>;
        const meta = ResearchMeta.parse(rawMeta);
        const reads: Record<string, FindingRead> = { ...(meta.reads ?? {}) };
        for (const b of batch.filter((x) => x.note === note)) {
          const r = byId.get(b.id);
          // A null classification is still a completed read. Store its empty
          // annotation so the next paid batch never selects it again.
          reads[String(b.index)] = r ?? { signal: null, owner: null, fits: [], so_what: null };
          read += 1;
        }
        // Re-review may have kept additional findings while the model was away.
        const kept = new Set(keptFindings(meta));
        const whole = meta.findings.every((f, i) => !kept.has(f) || Object.hasOwn(reads, String(i)));
        conn.prepare("UPDATE documents SET meta_json = ? WHERE id = ?").run(JSON.stringify({ ...rawMeta, reads, ...(whole ? { read_at: new Date().toISOString() } : {}) }), note.doc.id);
      }
    })();
    return { read, remaining: pending.length - batch.length, signals: [...byId.values()].filter((r) => r?.signal).length };
  });
  return run.id;
}
