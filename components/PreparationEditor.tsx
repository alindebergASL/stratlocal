import { savePreparation } from "@/app/actions";
import type { MeetingBrief } from "@/lib/meetings/briefSchema";
import { conversationView } from "@/lib/meetings/briefView";
import { ActionForm } from "./ActionForm";
import { BaseVersion, control, Field } from "./ui";

export function PreparationEditor({ accountId, meetingId, version, brief }: { accountId: string; meetingId: string; version: number; brief: MeetingBrief }) {
  const view = conversationView(brief);
  return <div className="my-4" data-testid="preparation-editor">
    <ActionForm action={savePreparation.bind(null, accountId, meetingId)} trigger="Edit preparation" submitLabel="Save preparation" testId="preparation-edit">
      <BaseVersion of={version} />
      <p className="basis-full text-label text-ink-muted">Edit your purpose, questions and proposed next step. These will be labelled as human edits, not source-verified facts. The original brief and all citations stay available. Saving does not create a task or agree an owner or date.</p>
      <Field label="Why this meeting" wide><textarea name="purpose" rows={2} required maxLength={300} defaultValue={view.purpose ?? ""} className={control} /></Field>
      <Field label="Questions to ask (one per line, up to 3)" wide><textarea name="questions" rows={4} defaultValue={view.questions.slice(0, 3).map(q => q.text).join("\n")} className={control} /></Field>
      <Field label="Proposed next step" wide><textarea name="action" rows={2} required maxLength={500} defaultValue={brief.proposed_next_step.action} className={control} /></Field>
      <Field label="Concern to address" wide><textarea name="concern" rows={2} required maxLength={500} defaultValue={brief.proposed_next_step.concern} className={control} /></Field>
    </ActionForm>
  </div>;
}
