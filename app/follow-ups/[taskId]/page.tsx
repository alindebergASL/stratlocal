import { AskAboutThis } from "@/components/AskAboutThis";
import { BackLink } from "@/components/BackLink";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listUsers, requirePageUser } from "@/lib/auth";
import { getTask } from "@/lib/planning";
import { ResultButton } from "@/components/ResultButton";
import { mailSource } from "@/lib/mail/sync";
import { listContacts } from "@/lib/queries/accounts";
import { draftChaserAction } from "@/app/outbound/actions";
import { OWN_WORK_ACCOUNT_ID } from "@/lib/db";
import { entityHistory, getAccount, listAccountChoices } from "@/lib/queries/accounts";
import { listMeetings } from "@/lib/queries/meetings";
import { followUpSources } from "@/lib/queries/followUpSources";
import { saveActionItem, setActionItemStatus } from "@/app/actions";
import { Page } from "@/components/Nav";
import { ActionForm } from "@/components/ActionForm";
import { BaseVersion, Button, buttonClass, control, Field, PageHeader, Section } from "@/components/ui";

export const dynamic = "force-dynamic";
export default async function TaskPage({ params, searchParams }: { params: Promise<{ taskId: string }>; searchParams: Promise<{ context?: string }> }) {
  const user = await requirePageUser();
  const task = getTask((await params).taskId);
  if (!task) notFound();
  const account = getAccount(task.account_id);
  if (!account) notFound();
  const locked = !!task.archived_at || !!account.archived_at;
  const standalone = task.account_id === OWN_WORK_ACCOUNT_ID && !task.meeting_id && !task.play_id && !task.source_ref_json;
  const requested = (await searchParams).context;
  const choices = listAccountChoices();
  const context = standalone && requested && choices.some(a => a.id === requested) ? requested : task.account_id;
  const meetings = context === OWN_WORK_ACCOUNT_ID ? [] : listMeetings(context).filter(m => !m.merged_into);
  const sources = followUpSources([task]).get(task.id) ?? [];
  const save = saveActionItem.bind(null, task.account_id, task.id);
  const history = entityHistory("action_item", task.id, 30);
  const owedBy = (task.owner ?? "").trim().toLowerCase();
  const chaseable =
    task.status === "open" && !!mailSource(user.id)?.canSend && !!owedBy &&
    listContacts(task.account_id).some((c) => c.org === "customer" && !!c.email && (c.name.trim().toLowerCase() === owedBy || c.name.trim().toLowerCase().split(/\s+/)[0] === owedBy));
  return <Page user={user}>
    <BackLink fallback="/follow-ups?who=all" fallbackLabel="All tasks" />
    <PageHeader
      title={task.text}
      sub={`${account.name} · ${task.status}${task.due ? ` · due ${task.due}` : " · no date"}${locked ? " · archived" : ""}`}
      actions={
        locked ? undefined : (
          <span className="flex flex-wrap items-center gap-2">
            {task.due && task.status === "open" && (
              <a href={`/follow-ups/${task.id}/ics`} download className={buttonClass("quiet", "sm")} data-testid="task-ics">
                Add to calendar
              </a>
            )}
            <AskAboutThis accountId={account.kind === "customer" ? account.id : null} kind="action_item" id={task.id} />
            {/* Something a customer owes: a polite chaser, drafted to send from your mailbox (DECISIONS #103). */}
            {chaseable && <ResultButton run={draftChaserAction.bind(null, task.id)} testId="task-chaser">Draft a chaser…</ResultButton>}
          </span>
        )
      }
    />
    {!locked && <Section title="Make it actionable">
      <ActionForm action={save} trigger="Edit task" testId="task-edit" open>
        <BaseVersion of={task.updated_at} />
        <Field label="Task title" wide><input name="text" defaultValue={task.text} required className={control} /></Field>
        <Field label="Task assignee"><select name="owner_user_id" defaultValue={task.owner_user_id ?? ""} className={control}><option value="">Unassigned</option>{listUsers().map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}</select></Field>
        <Field label="Due date"><input name="due" type="date" defaultValue={task.due ?? ""} className={control} /></Field>
        <Field label="Notes" wide><textarea name="notes" rows={4} maxLength={4000} defaultValue={task.notes ?? ""} className={control} /></Field>
      </ActionForm>
      <ActionForm action={async () => { "use server"; return setActionItemStatus(task.account_id, task.id, task.status === "open" ? "done" : "open", task.updated_at); }} trigger={task.status === "open" ? "Complete task" : "Reopen task"} submitLabel="Confirm" testId="task-status"><p>Mark this task {task.status === "open" ? "done" : "open"}?</p></ActionForm>
    </Section>}
    {task.notes && <p className="mb-5 whitespace-pre-wrap text-ink" data-testid="task-notes">{task.notes}</p>}
    {!locked && <Section title="Connections">
      <p className="mb-3 text-label text-ink-muted">{standalone ? "This task stands alone. Add account context or a meeting whenever useful." : "Account context is separate from the task assignee. Source-backed work keeps its original evidence."}</p>
      {standalone && <form method="get" className="mb-3 flex flex-wrap items-end gap-2">
        <Field label="Choose account context"><select name="context" defaultValue={context} className={control}><option value={OWN_WORK_ACCOUNT_ID}>Own work · no account</option>{choices.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Button type="submit" variant="quiet">Choose context</Button>
      </form>}
      {!task.source_ref_json && <ActionForm key={context} action={save} trigger="Connect task" submitLabel="Save connection" testId="task-connect" open>
        <BaseVersion of={task.updated_at} /><input name="text" type="hidden" value={task.text} /><input name="account_id" type="hidden" value={context} />
        <p className="basis-full text-label">Account: {context === OWN_WORK_ACCOUNT_ID ? "Own work" : choices.find(a => a.id === context)?.name ?? account.name}</p>
        <Field label="Meeting (optional)"><select name="meeting_id" defaultValue={task.meeting_id ?? ""} className={control}><option value="">No meeting</option>{meetings.map(m => <option key={m.id} value={m.id}>{m.title} · {m.held_at}</option>)}</select></Field>
      </ActionForm>}
      {sources.map((s, i) => <p key={i} className="mt-2 text-label text-ink-muted">{s.href ? <Link href={s.href} className="text-accent hover:underline">{s.label} →</Link> : s.label}</p>)}
    </Section>}
    <details className="border-t border-line py-3"><summary className="cursor-pointer text-label font-semibold">Task history · latest 30 field changes</summary><ul className="mt-2 space-y-2">{history.map(h => <li key={h.id} className="text-micro text-ink-muted">{h.field.replaceAll("_", " ")} · {h.old_value ?? "empty"} → {h.new_value ?? "empty"}</li>)}</ul><Link href={`/activity?account=${task.account_id}`} className="text-label text-accent">Account history →</Link></details>
  </Page>;
}
