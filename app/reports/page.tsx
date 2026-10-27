// Every report Ask has written, newest first, for both of you.
import Link from "next/link";
import { listUsers, requirePageUser } from "@/lib/auth";
import { listTemplates } from "@/lib/ask/templates";
import { archiveTemplateAction, clearScheduleAction, setScheduleAction } from "./actions";
import { DAY_NAMES, describeSchedule, listSchedules, scheduleFor, type AskSchedule } from "@/lib/ask/schedules";
import { assistantMode } from "@/lib/assistants/settings";
import { ActionForm } from "@/components/ActionForm";
import { control, Field } from "@/components/ui";
import { fmtWhen } from "@/lib/format";
import { listReports } from "@/lib/ask/report";
import { shareState } from "@/lib/handoff/store";
import { Page } from "@/components/Nav";
import { Button, ButtonLink, Chip, Empty, PageHeader, Section } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const user = await requirePageUser();
  const reports = listReports();
  const templates = listTemplates();
  const users = listUsers();
  const names = new Map(users.map((u) => [u.id, u.display_name]));
  const scheduling = assistantMode("scheduled_reports");
  return (
    <Page user={user} main="max-w-3xl">
      <PageHeader title="Reports" sub="Written by Ask. Print, save as PDF or share." actions={<ButtonLink href="/ask" variant="quiet" size="sm">Ask for one</ButtonLink>} />
      <Section title="New from a template">
        {scheduling === "off" && listSchedules().length > 0 && (
          <p className="mb-2 text-label text-warning" data-testid="schedules-off">
            Scheduled reports is off, so nothing below runs on its schedule. <Link href="/assistants" className="font-semibold underline">Turn it on</Link>.
          </p>
        )}
        <ul className="divide-y divide-line" data-testid="templates">
          {templates.map((t) => (
            <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2">
              <span className="min-w-0">
                {t.scope === "all" ? (
                  <Link href={`/ask?template=${t.id}`} className="font-medium text-ink hover:text-accent">{t.name}</Link>
                ) : (
                  <span className="font-medium text-ink">{t.name}</span>
                )}
                <span className="block text-micro text-ink-muted">
                  {t.scope === "account" ? "On one account: start it from the account's Ask. " : ""}
                  {t.sections.join(" · ")}
                  {!t.builtIn && ` · saved by ${names.get(t.createdBy ?? "") ?? "someone"}`}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {t.scope === "all" && <TemplateSchedule templateId={t.id} schedule={scheduleFor(t.id)} users={users} me={user.id} names={names} />}
                {!t.builtIn && (
                  <form action={archiveTemplateAction.bind(null, t.id)}>
                    <Button type="submit" variant="ghost" size="sm">Delete</Button>
                  </form>
                )}
              </span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="All reports">
        {reports.length === 0 ? (
          <Empty>No reports yet. Ask for one: “Write a one-page report on where the pipeline stands this quarter.”</Empty>
        ) : (
          <ul className="divide-y divide-line" data-testid="reports">
            {reports.map(({ doc, report }) => (
              <li key={doc.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5">
                <span className="min-w-0">
                  <Link href={`/reports/${doc.id}`} className="font-medium text-ink hover:text-accent [overflow-wrap:anywhere]">{report.title}</Link>
                  <span className="block text-micro text-ink-muted">
                    {report.accountName ?? "All accounts"} · {report.generatedBy} · {report.generatedAt.slice(0, 10)}
                  </span>
                </span>
                {shareState(doc) === "live" && <Chip tone="info">Shared</Chip>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Page>
  );
}

// A template's schedule: when it runs and for whom, and the form to change it.
function TemplateSchedule({ templateId, schedule, users, me, names }: { templateId: string; schedule: AskSchedule | null; users: Array<{ id: string; display_name: string }>; me: string; names: Map<string, string> }) {
  return (
    <span className="flex flex-wrap items-center gap-2" data-testid={`schedule-${templateId}`}>
      {schedule && (
        <span className="text-micro text-ink-muted">
          {describeSchedule(schedule)} for {names.get(schedule.forUserId) ?? "someone"}
          {schedule.lastRunAt ? ` · last ${fmtWhen(schedule.lastRunAt)}` : ""}
        </span>
      )}
      <ActionForm action={setScheduleAction.bind(null, templateId)} trigger={schedule ? "Change" : "Schedule"} submitLabel="Save the schedule" testId={`schedule-form-${templateId}`}>
        <fieldset className="flex flex-wrap gap-x-3 gap-y-1">
          <legend className="mb-1 text-label font-semibold text-ink">Days</legend>
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <label key={d} className="flex items-center gap-1.5 text-label text-ink">
              <input type="checkbox" name="days" value={d} defaultChecked={schedule ? schedule.days.includes(d) : d === 1} />
              {DAY_NAMES[d]!.slice(0, 3)}
            </label>
          ))}
        </fieldset>
        <Field label="At">
          <input type="time" name="at" required defaultValue={schedule?.at ?? "07:00"} className={control} />
        </Field>
        <Field label="For">
          <select name="for" defaultValue={schedule?.forUserId ?? me} className={control}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.display_name}</option>
            ))}
          </select>
        </Field>
      </ActionForm>
      {schedule && (
        <form action={clearScheduleAction.bind(null, templateId)}>
          <Button type="submit" variant="ghost" size="sm">Stop</Button>
        </form>
      )}
    </span>
  );
}
