// Scheduled reports: each report template on a schedule (lib/ask/schedules.ts)
// is run when it is due, on this assistant's own budget, and the report is
// left on that person's Today. A schedule whose records have not changed
// since its last report is skipped. It writes reports; it changes no record.
import { findUserById } from "../auth";
import { db } from "../db";
import { BudgetError } from "../ai/guard";
import { todayISO } from "../clock";
import { startAsk } from "../ask/run";
import { getTemplate } from "../ask/templates";
import { getReport } from "../ask/report";
import { canAttemptSchedule, changedSince, claimScheduleAttempt, isDue, listSchedules, markRan } from "../ask/schedules";
import { beginAssistantRun, endAssistantRun, type RunTrigger } from "./runs";
import { postReady } from "./ready";

function finishAttempts(runId: string): void {
  const rows = db().prepare(`SELECT status FROM ask_schedule_attempts WHERE assistant_run_id = ?`).all(runId) as Array<{ status: string }>;
  if (!rows.length || rows.some((r) => r.status === "running")) return;
  const done = rows.filter((r) => r.status === "done").length;
  endAssistantRun(runId, { status: done === rows.length ? "done" : "failed", summary: `${done} of ${rows.length} scheduled reports saved.` });
}

// Detached exceptions never call onDone. The next check reconciles their run
// rows; boot already fails orphaned AI/assistant runs after a process restart.
function reconcileAttempts(): void {
  const rows = db().prepare(`SELECT a.id, a.assistant_run_id FROM ask_schedule_attempts a
    LEFT JOIN ai_runs ai ON ai.id = a.ai_run_id
    LEFT JOIN assistant_runs ar ON ar.id = a.assistant_run_id
    WHERE a.status = 'running' AND (ar.status IS NULL OR ar.status != 'running' OR (a.ai_run_id IS NOT NULL AND (ai.status IS NULL OR ai.status != 'running')))`)
    .all() as Array<{ id: string; assistant_run_id: string }>;
  for (const a of rows) {
    db().prepare(`UPDATE ask_schedule_attempts SET status = 'failed' WHERE id = ? AND status = 'running'`).run(a.id);
    finishAttempts(a.assistant_run_id);
  }
}

export function runScheduledReports(trigger: RunTrigger, pressedBy: string | null, now = new Date()): { runId: string | null; started: number; reason: string } | null {
  reconcileAttempts();
  const schedules = listSchedules().filter((s) => (trigger === "manual" || isDue(s, now)) && canAttemptSchedule(s.templateId, now));
  // Nothing due is not a run: no row every few minutes saying so.
  if (schedules.length === 0) return trigger === "manual" ? { runId: null, started: 0, reason: "No schedule is ready to start (it may be running or waiting to retry)." } : null;
  const runId = beginAssistantRun("scheduled_reports", trigger, pressedBy);
  const today = todayISO(now);
  let started = 0;
  const notes: string[] = [];
  for (const s of schedules) {
    const template = getTemplate(s.templateId);
    const person = findUserById(s.forUserId);
    if (!template || !person) {
      notes.push("a schedule whose template or person is gone was passed over");
      continue;
    }
    if (trigger === "schedule" && !changedSince(s.lastRunAt)) {
      notes.push(`${template.name}: nothing changed since the last one`);
      continue;
    }
    const attemptId = claimScheduleAttempt(s.templateId, runId, now);
    if (!attemptId) continue;
    try {
      const launched = startAsk({
        userId: person.id,
        question: template.question,
        templateId: template.id,
        assistant: "scheduled_reports",
        save: true,
        onDone: ({ threadId, reportDocId }) => {
          const report = reportDocId ? getReport(reportDocId) : null;
          const saved = report && report.report.threadId === threadId;
          const completed = db().transaction(() => {
            const updated = db().prepare(`UPDATE ask_schedule_attempts SET status = ?, report_doc_id = ? WHERE id = ? AND status = 'running'`)
              .run(saved ? "done" : "failed", saved ? reportDocId : null, attemptId);
            // The baseline is the attempt's start, not its finish: records
            // changed while the provider was away still need a later report.
            if (saved && updated.changes) markRan(s.templateId, now.getTime());
            return updated.changes > 0;
          }).immediate();
          finishAttempts(runId);
          if (!saved || !completed) return;
          postReady({
            assistant: "scheduled_reports",
            forUserId: person.id,
            title: `${template.name} is ready`,
            why: "on its schedule",
            href: `/reports/${reportDocId}`,
            action: "Read it",
            subjectId: reportDocId!,
            dedupeKey: `scheduled_reports:${template.id}:${person.id}:${today}:${trigger}:${now.getTime()}`,
            runId,
          });
        },
      });
      db().prepare(`UPDATE ask_schedule_attempts SET ai_run_id = ? WHERE id = ?`).run(launched.runId, attemptId);
      started += 1;
    } catch (e) {
      db().prepare(`UPDATE ask_schedule_attempts SET status = 'failed' WHERE id = ? AND status = 'running'`).run(attemptId);
      if (!(e instanceof BudgetError)) {
        finishAttempts(runId);
        throw e;
      }
      notes.push(`${template.name}: ${e.message}`);
    }
  }
  const said = notes.join("; ");
  const reason = started ? `Writing ${started} report${started === 1 ? "" : "s"}.${said ? ` Also: ${said}.` : ""}` : `${said ? `${said[0]!.toUpperCase()}${said.slice(1)}` : "Nothing to run"}.`;
  finishAttempts(runId);
  if (!started) endAssistantRun(runId, { status: "skipped", summary: reason });
  return { runId, started, reason };
}
