import Link from "next/link";
import { getMeeting } from "@/lib/queries/meetings";
import { latestBriefRun } from "@/lib/planning";
import { providerProblem } from "@/lib/ai/client";
import { runningRunFor } from "@/lib/ai/guard";
import { briefReadiness } from "@/lib/ai/readiness";
import { ROLES } from "@/lib/ai/models";
import { RunButton } from "./RunButton";

export function PrepareMeeting({ accountId, meetingId }: { accountId: string; meetingId: string }) {
  const meeting = getMeeting(meetingId);
  if (!meeting || meeting.account_id !== accountId || meeting.archived_at || meeting.merged_into) return null;
  const initialRun = latestBriefRun(accountId, meetingId);
  const active = runningRunFor(accountId);
  return <div className="mt-2 space-y-1" data-testid="prepare-meeting">
    {!meeting.brief_json && <RunButton key={initialRun?.id ?? "new"} url={`/api/meetings/${meetingId}/brief`} label="Prepare this meeting" busyLabel="Preparing…" kind="brief" initialRun={initialRun}
      body={{ baseVersion: meeting.updated_at, replaceHumanEdits: false }}
      disabledReason={providerProblem(ROLES.brief.provider) ?? briefReadiness(meeting) ?? (active && active.id !== initialRun?.id ? "Another AI run is working on this account." : null)} />}
    {meeting.brief_json && <Link href={`/accounts/${accountId}/meetings/${meetingId}#brief`} className="inline-flex min-h-11 items-center font-semibold text-accent hover:underline" data-testid="prepared-brief-link">Read &amp; edit preparation →</Link>}
  </div>;
}
