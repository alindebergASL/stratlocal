"use client";

import { useState } from "react";
import { field } from "@/lib/local/styles";
import { LocalForm } from "./Forms";

type AccountChoice = { id: string; name: string };
type MeetingChoice = { id: string; account_id: string; title: string; held_at: string };

export function EvidenceLinkForm({ artifactId, accounts, meetings }: {
  artifactId: string;
  accounts: AccountChoice[];
  meetings: MeetingChoice[];
}) {
  const [accountId, setAccountId] = useState("");
  const [meetingId, setMeetingId] = useState("");
  const available = meetings.filter(meeting => meeting.account_id === accountId);
  const selectedMeeting = available.some(meeting => meeting.id === meetingId) ? meetingId : "";

  return (
    <LocalForm operation="link_evidence" label="Link original">
      <input type="hidden" name="artifactId" value={artifactId} />
      <label className="block">
        Target account
        <select className={field} name="accountId" required value={accountId} onChange={event => {
          setAccountId(event.target.value);
          setMeetingId("");
        }}>
          <option value="">Choose account</option>
          {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select>
      </label>
      <label className="block">
        Meeting (optional)
        <select className={field} name="meetingId" value={selectedMeeting} disabled={!accountId || !available.length} onChange={event => setMeetingId(event.target.value)}>
          <option value="">Account evidence only</option>
          {available.map(meeting => <option key={meeting.id} value={meeting.id}>{meeting.title} · {meeting.held_at}</option>)}
        </select>
      </label>
      {!accounts.length ? <p className="text-label">Create an account before linking this original.</p> : !accountId ? <p className="text-label">Choose an account to see its meetings.</p> : !available.length ? <p className="text-label">No active meetings for this account. You can link the original as account evidence.</p> : <p className="text-label">Choose a meeting to attach this original to its preparation and follow-up.</p>}
    </LocalForm>
  );
}
