// The assistants, defined once. What each does, when it may run, and what it
// starts with. Settings a person changes live in the database; this is only
// the shape and the first values.
//
// "On its own" means it runs on the scheduler's clock and leaves what it
// found for a person: a notice, a question, a brief for a meeting that had
// none. No assistant writes a record (DECISIONS #1, #38).
export type AssistantId =
  | "promise_keeper"
  | "meeting_prep"
  | "debrief"
  | "account_watch"
  | "plan_keeper"
  | "handoff_writer"
  | "friday_review"
  | "close_the_day"
  | "scheduled_reports"
  | "quarterly_refresh"
  | "morning_digest"
  | "mail_reader"
  | "writer";

export type AssistantMode = "off" | "ask" | "auto";

export const MODE_LABEL: Record<AssistantMode, string> = { off: "Off", ask: "When I ask", auto: "On its own" };

export type AssistantDef = {
  id: AssistantId;
  name: string;
  /** One sentence: what it leaves you. */
  does: string;
  /** When it runs on its own, in words. */
  schedule: string;
  /**
   * "modes": Off / When I ask / On its own all work now.
   * "pressed": it exists as buttons you press; its spend is the people's share.
   * "later": designed, not built yet. Shown so the page is honest about what
   * is coming, with no control that does nothing (DECISIONS #25).
   */
  availability: "modes" | "pressed" | "later";
  /** Where the pressed version lives, or which phase builds it. */
  where?: string;
  defaultMode: AssistantMode;
  defaultCents: number;
  /** False for an assistant that only reads structured records (DECISIONS #27). */
  usesModel: boolean;
};

export const ASSISTANTS: readonly AssistantDef[] = [
  {
    id: "promise_keeper",
    name: "Promise keeper",
    does: "Reminds you two days before something you promised is due, tells you when a customer's promise is coming up, and asks when they said they would do it if nobody wrote a date.",
    schedule: "every morning",
    availability: "modes",
    defaultMode: "auto",
    defaultCents: 0,
    usesModel: false,
  },
  {
    id: "meeting_prep",
    name: "Meeting prep",
    does: "Writes the brief for a meeting that has none: today's in the morning, tomorrow's from late afternoon. A brief you have edited is never replaced.",
    schedule: "mornings and late afternoons",
    availability: "modes",
    defaultMode: "ask",
    defaultCents: 2000,
    usesModel: true,
  },
  {
    id: "debrief",
    name: "Debrief",
    does: "Turns your notes into changes to approve one at a time, and drafts the recap email you send yourself.",
    schedule: "when you save notes",
    availability: "pressed",
    where: "On every meeting: Save and extract changes, and Draft the recap email.",
    defaultMode: "ask",
    defaultCents: 4000,
    usesModel: true,
  },
  {
    id: "account_watch",
    name: "Account watch",
    does: "Looks for public news about the accounts you choose, once a week, and leaves what it finds for you to keep or drop. What touches a play comes first; nothing it has shown you before comes back.",
    schedule: "weekly, one account at a time",
    availability: "modes",
    defaultMode: "ask",
    defaultCents: 3000,
    usesModel: true,
  },
  {
    id: "plan_keeper",
    name: "Plan keeper",
    does: "Asks about plays that have gone quiet, next steps that slipped or were never set, and, once a month per account, where recent meetings sit against the thesis. It asks; it never rewrites the plan.",
    schedule: "daily for plays, monthly for each thesis",
    availability: "modes",
    defaultMode: "ask",
    defaultCents: 1500,
    usesModel: true,
  },
  {
    id: "handoff_writer",
    name: "Handoff writer",
    does: "When someone's calendar shows time off within three days, drafts a cover note for the other person from what falls in those days. On an account's handoff page, drafts the covering text for another team. You edit and send; it sends nothing.",
    schedule: "three days before time off",
    availability: "modes",
    defaultMode: "ask",
    defaultCents: 1500,
    usesModel: true,
  },
  {
    id: "friday_review",
    name: "Friday review",
    does: "Picks the deals on your accounts that need a look — close date passed, pushed out, no next step, gone quiet, changed by a teammate — five at most, and writes the review as a report with a chart and a summary you can copy for your manager.",
    schedule: "Fridays at 07:00",
    availability: "modes",
    defaultMode: "ask",
    defaultCents: 1500,
    usesModel: true,
  },
  {
    id: "close_the_day",
    name: "Close the day",
    does: "Opens on what you did today, then each loose end to give a day or drop, then tomorrow's first meeting, and drafts a two-line note for the team that you choose to send. It sends nothing itself.",
    schedule: "weekdays at 17:30",
    availability: "modes",
    defaultMode: "ask",
    defaultCents: 1000,
    usesModel: true,
  },
  {
    id: "scheduled_reports",
    name: "Scheduled reports",
    does: "Runs the report templates you put on a schedule and leaves each report on Today. A report whose records have not changed since the last one is skipped.",
    schedule: "as each template's schedule says",
    availability: "modes",
    defaultMode: "off",
    defaultCents: 2000,
    usesModel: true,
  },
  {
    id: "quarterly_refresh",
    name: "Quarterly refresh",
    does: "Once a quarter for each account on the playbook, asks whether its archetype still holds and lists the qualification to re-check, as a suggestion and a follow-up for you to accept. Fresh news comes from Account watch.",
    schedule: "daily, one account at a time, each once a quarter",
    availability: "modes",
    defaultMode: "off",
    defaultCents: 1000,
    usesModel: true,
  },
  {
    id: "morning_digest",
    name: "Morning digest",
    does: "Sends each person who connected Slack or Teams a short version of Today's briefing on weekday mornings: counts and a link, and account names only for those who asked for them.",
    schedule: "weekday mornings",
    availability: "modes",
    where: "Connect Slack or Teams under Settings → Connections.",
    defaultMode: "off",
    defaultCents: 0,
    usesModel: false,
  },
  {
    id: "mail_reader",
    name: "Mail reader",
    does: "Reads the mailboxes people connected, keeps only email with a customer it can match to one account, and turns what was agreed into follow-ups and next steps for you to accept one at a time. It never changes a stage, status or amount.",
    schedule: "every few minutes, a few threads at a time",
    availability: "modes",
    where: "Each person connects their own mailbox under Settings → Connections.",
    defaultMode: "off",
    defaultCents: 1500,
    usesModel: true,
  },
  {
    id: "writer",
    name: "Writer",
    does: "Writes Today's summary each morning and each account's Where it stands when its records move, every sentence citing the records it rests on. The counts show whenever it has not written.",
    schedule: "mornings, and when an account's records move",
    availability: "modes",
    defaultMode: "off",
    defaultCents: 2000,
    usesModel: true,
  },
];

export function assistantDef(id: string): AssistantDef | null {
  return ASSISTANTS.find((a) => a.id === id) ?? null;
}

export function isAssistantId(id: string): id is AssistantId {
  return ASSISTANTS.some((a) => a.id === id);
}
