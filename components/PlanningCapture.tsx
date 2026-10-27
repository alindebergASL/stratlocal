import { captureTask, planMeeting } from "@/app/actions";
import { listAccountChoices } from "@/lib/queries/accounts";
import { listUsers } from "@/lib/auth";
import { OWN_WORK_ACCOUNT_ID } from "@/lib/db";
import { ActionForm } from "./ActionForm";
import { control, Field } from "./ui";

// One inexpensive capture surface: only title is required, nothing invokes AI.
export function PlanningCapture({ accountId, meetingId, me, taskOpen = false }: { accountId?: string; meetingId?: string; me: string; taskOpen?: boolean }) {
  const accounts = listAccountChoices();
  return <div className="mb-4 flex flex-wrap items-start gap-2" data-testid="planning-capture">
    <ActionForm action={captureTask} trigger="Add task" submitLabel="Add task" testId="task-capture" open={taskOpen}>
      <Field label="Task title" wide><input name="text" required maxLength={4000} placeholder="A thought, a question, or something to do" className={control} /></Field>
      {meetingId && <input name="meeting_id" type="hidden" value={meetingId} />}
      <details className="basis-full"><summary className="cursor-pointer py-2 text-label text-accent">Optional details · assigned to you by default</summary>
        <div className="flex flex-wrap gap-3 py-2">
          <Field label="Task assignee"><select name="owner_user_id" defaultValue={me} className={control}><option value="">Unassigned</option>{listUsers().map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}</select></Field>
          <Field label="Due date"><input name="due" type="date" className={control} /></Field>
          {accountId ? <input name="account_id" type="hidden" value={accountId} /> : <Field label="Account"><select name="account_id" defaultValue={OWN_WORK_ACCOUNT_ID} className={control}><option value={OWN_WORK_ACCOUNT_ID}>Own work · no account needed</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>}
          <Field label="Notes" wide><textarea name="notes" maxLength={4000} rows={3} className={control} /></Field>
          <p className="basis-full text-micro text-ink-muted">Dates are never inferred. Connect a meeting later from task details. Adding a task does not run AI.</p>
        </div>
      </details>
    </ActionForm>
    <ActionForm action={planMeeting} trigger="Add meeting" submitLabel="Create meeting" testId="planning-meeting">
      {accountId ? <input name="account_id" type="hidden" value={accountId} /> : <Field label="Meeting account"><select name="account_id" required defaultValue="" className={control}><option value="" disabled>Choose an account</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>}
      <Field label="Meeting title" wide><input name="title" required className={control} /></Field>
      <Field label="Meeting date"><input name="held_at" type="date" required className={control} /></Field>
      <Field label="Time (optional)"><input name="held_time" type="time" className={control} /></Field>
      <p className="basis-full text-micro text-ink-muted">You can add attendees and prepare the meeting after saving.</p>
    </ActionForm>
  </div>;
}
