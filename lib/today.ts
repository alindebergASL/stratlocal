// What Today puts in front of you, and in what order.
//
// The page used to show everything it knew in six stacked panels. This picks
// at most five things by a fixed rule that is printed on the page under "How
// these were picked", and puts everything else behind a count. The rule is
// deliberately not a score: a ranking nobody can see the grounds for is a
// guess, and a guess on the first screen of the day is the thing people stop
// trusting first.
//
// Pure: every input is read by the page and passed in, so the rule can be
// tested without a database and cannot write anything.
import { daysBetween } from "./clock";
import { countLabel } from "./glance";
import type { AttentionItem } from "./queries/attention";
import type { PartnerDigest, UpcomingMeeting } from "./queries/today";

export const TODAY_LIMIT = 5;
// Past this many days late, a follow-up stops competing for the first screen
// and goes to the backlog, which is sorted in one sitting rather than nagged
// about every morning.
export const RECENT_OVERDUE_DAYS = 7;

export const TODAY_RULE =
  "What an assistant wrote for you and you have not opened yet (a Friday review, a report, a note from a teammate — two at most) first, then preparation for today's and tomorrow's meetings, then what is due today, then what slipped in the last week, then changes waiting for your review, then handing over before your time off, then meetings from your calendar to add, then news Account watch found, then customer promises with no date, then questions about the plan, then meetings with no notes, then promises due in the next two days, then what a teammate changed. Five at most. Nothing else is ranked.";

export type TodayItemKind = "prepare" | "due" | "late" | "review" | "ready" | "handoff" | "calendar" | "news" | "question" | "notes" | "promise" | "fyi";

export type TodayItem = {
  key: string;
  kind: TodayItemKind;
  title: string;
  accountName: string;
  why: string;
  action: string;
  href: string;
};

export const TODAY_KIND_LABEL: Record<TodayItemKind, string> = {
  prepare: "Prepare",
  due: "Due today",
  late: "Late",
  review: "Review",
  ready: "Ready",
  handoff: "Hand over",
  calendar: "Calendar",
  news: "News",
  question: "Question",
  notes: "Notes",
  promise: "Coming up",
  fyi: "FYI",
};

export type TodayPlan = {
  items: TodayItem[];
  /** Everything the rule found, before the cap. */
  found: number;
  /** Past due by more than RECENT_OVERDUE_DAYS: sorted in one sitting. */
  backlog: { followUps: number; plays: number };
  meetingsToday: number;
  /** Today's meetings after the one in the Next-up card, by time. */
  laterToday: UpcomingMeeting[];
};

function byTime(a: UpcomingMeeting, b: UpcomingMeeting): number {
  return a.heldAt.localeCompare(b.heldAt) || (a.heldTime ?? "99:99").localeCompare(b.heldTime ?? "99:99") || a.id.localeCompare(b.id);
}

function when(m: UpcomingMeeting, today: string): string {
  const day = m.heldAt === today ? "today" : "tomorrow";
  return m.heldTime ? `${day} at ${m.heldTime}` : `${day}, time not set`;
}

function lateBy(due: string | undefined, today: string): number {
  return due ? daysBetween(due, today) : 0;
}

export function planToday(input: {
  today: string;
  tomorrow: string;
  upcoming: UpcomingMeeting[];
  notes: UpcomingMeeting[];
  attention: AttentionItem[];
  partners: PartnerDigest[];
  /** What Promise keeper left: customer promises with no date, and promises due soon. */
  promises?: { questions: Array<{ accountName: string }>; soon: Array<{ key: string; title: string; accountName: string; why: string; href: string }> };
  /** Customer meetings the calendar matched and nobody has added yet, and those that need an account. */
  calendar?: { toAdd: number; questions: number };
  /** Plan keeper's open questions, and the accounts they are about. */
  planQuestions?: Array<{ accountName: string }>;
  /** What an assistant wrote for you and you have not opened: a Friday review, a report, a note. */
  ready?: Array<{ key: string; title: string; why: string; href: string; action: string }>;
  /** Notes Account watch wrote that nobody has kept or dropped yet. */
  news?: Array<{ accountName: string; findings: number; touching: number; href: string; signals?: number }>;
  /** The other person's time off in the coming week, from their own calendar. */
  timeOff?: Array<{ name: string; when: string; href?: string }>;
  /** Your own time off in the coming week, and how much falls in it. */
  myTimeOff?: { when: string; things: number } | null;
  /** The Next-up card's link, so nothing appears twice. */
  primaryHref: string | null;
}): TodayPlan {
  const { today, tomorrow, attention } = input;
  // The Next-up card links a meeting to its #brief or #notes, which say
  // nothing about which record it is; a follow-up links to its own page.
  // Dropping every fragment once hid every other follow-up on an account.
  const same = (href: string) => href.replace(/#(brief|notes)$/, "");
  const primary = input.primaryHref ? same(input.primaryHref) : null;
  const notPrimary = (href: string) => same(href) !== primary;

  const meetingsToday =
    input.upcoming.filter((m) => m.heldAt === today).length + input.notes.filter((m) => m.heldAt === today).length;
  const laterToday = input.upcoming.filter((m) => m.heldAt === today && notPrimary(m.href)).sort(byTime);

  const prepare: TodayItem[] = input.upcoming
    .filter((m) => (m.heldAt === today || m.heldAt === tomorrow) && !m.hasBrief && notPrimary(m.href))
    .sort(byTime)
    .map((m) => ({
      key: `prepare-${m.id}`,
      kind: "prepare",
      title: m.title,
      accountName: m.accountName,
      why: when(m, today),
      action: "Prepare",
      href: `${m.href}#brief`,
    }));

  const work = (i: AttentionItem, kind: "due" | "late"): TodayItem => {
    const days = lateBy(i.due, today);
    return {
      key: `${kind}-${i.href}`,
      kind,
      title: i.text,
      accountName: i.accountName,
      why: i.promisedBy
        ? kind === "due"
          ? `${i.promisedBy} promised this for today`
          : `${i.promisedBy}'s promise, ${days === 1 ? "1 day" : `${days} days`} late`
        : kind === "due"
          ? `${i.unit === "play" ? "play next step" : "follow-up"} due today`
          : `${days === 1 ? "1 day" : `${days} days`} late`,
      action: "Open",
      href: i.href,
    };
  };
  const dueToday = attention.filter((i) => i.kind === "due_today" && notPrimary(i.href)).map((i) => work(i, "due"));
  const overdue = attention.filter((i) => i.kind === "overdue");
  const recent = overdue
    .filter((i) => lateBy(i.due, today) <= RECENT_OVERDUE_DAYS && notPrimary(i.href))
    // Most recent first: yesterday's slip is the one still worth rescuing.
    .sort((a, b) => (b.due ?? "").localeCompare(a.due ?? "") || a.accountName.localeCompare(b.accountName) || a.href.localeCompare(b.href))
    .map((i) => work(i, "late"));
  const old = overdue.filter((i) => lateBy(i.due, today) > RECENT_OVERDUE_DAYS);

  const review: TodayItem[] = attention
    .filter((i) => i.kind === "proposals" && notPrimary(i.href))
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.accountName.localeCompare(b.accountName))
    .map((i) => ({
      key: `review-${i.accountId}`,
      kind: "review",
      title: `Review ${countLabel(i.count ?? 0, "proposed change")}`,
      accountName: i.accountName,
      why: "nothing changes until you decide",
      action: "Review",
      href: i.href,
    }));

  const notes: TodayItem[] = [...input.notes]
    .filter((m) => notPrimary(m.href))
    .sort((a, b) => byTime(b, a))
    .map((m) => {
      const ago = daysBetween(m.heldAt, today);
      return {
        key: `notes-${m.id}`,
        kind: "notes",
        title: m.title,
        accountName: m.accountName,
        why: ago === 0 ? "met today, no notes yet" : ago === 1 ? "met yesterday, no notes yet" : `met ${ago} days ago, no notes yet`,
        action: "Write notes",
        href: `${m.href}#notes`,
      };
    });

  const fyi: TodayItem[] = input.partners.map((p) => ({
    key: `fyi-${p.actorId}`,
    kind: "fyi",
    title: `${p.actorName} changed ${countLabel(p.records, "thing")}`,
    accountName:
      p.accounts.length <= 2 ? p.accounts.map((a) => a.name).join(" and ") : `${p.accounts[0]!.name} and ${p.accounts.length - 1} more`,
    why: "in the last day",
    action: "See what",
    href: "/activity?days=1",
  }));

  // Promise keeper's questions are one item: they are answered one at a
  // time on their own page, and five of them would push everything else off.
  const asked = input.promises?.questions ?? [];
  const accounts = [...new Set(asked.map((q) => q.accountName))];
  const question: TodayItem[] =
    asked.length === 0
      ? []
      : [
          {
            key: "question-promises",
            kind: "question",
            title: `${countLabel(asked.length, "customer promise")} with no date`,
            accountName: accounts.length <= 2 ? accounts.join(" and ") : `${accounts[0]} and ${accounts.length - 1} more`,
            why: "when did they say?",
            action: "Answer",
            href: "/inbox?kind=promise",
          },
        ];

  const planAsked = input.planQuestions ?? [];
  const planAccounts = [...new Set(planAsked.map((q) => q.accountName))];
  const plan: TodayItem[] =
    planAsked.length === 0
      ? []
      : [
          {
            key: "question-plan",
            kind: "question",
            title: `${countLabel(planAsked.length, "question")} about the plan`,
            accountName: planAccounts.length <= 2 ? planAccounts.join(" and ") : `${planAccounts[0]} and ${planAccounts.length - 1} more`,
            why: "quiet plays, slipped steps, the thesis",
            action: "Answer",
            href: "/inbox?kind=plan",
          },
        ];

  const seen = new Set([...prepare, ...dueToday, ...recent].map((i) => i.href));
  const promise: TodayItem[] = (input.promises?.soon ?? [])
    .filter((p) => !seen.has(p.href) && notPrimary(p.href))
    .map((p) => ({ key: `promise-${p.key}`, kind: "promise", title: p.title, accountName: p.accountName, why: p.why, action: "Open", href: p.href }));

  const cal = input.calendar ?? { toAdd: 0, questions: 0 };
  const calendar: TodayItem[] =
    cal.toAdd + cal.questions === 0
      ? []
      : [
          {
            key: "calendar-add",
            kind: "calendar",
            title: cal.toAdd > 0 ? `Add ${countLabel(cal.toAdd, "meeting")} from the calendar` : `${countLabel(cal.questions, "calendar event")} need${cal.questions === 1 ? "s" : ""} an account`,
            accountName: "Calendar",
            why: cal.toAdd > 0 ? (cal.questions > 0 ? `matched by who is invited; ${cal.questions} more need an account` : "matched by who is invited") : "which account is it?",
            action: "Add",
            href: "/calendar",
          },
        ];
  const away: TodayItem[] = (input.timeOff ?? []).map((t, i) => ({
    key: `away-${i}`,
    kind: "fyi",
    title: `${t.name} is off ${t.when}`,
    accountName: "Calendar",
    why: "from their calendar",
    action: "See",
    href: t.href ?? "/calendar",
  }));
  const handoff: TodayItem[] =
    input.myTimeOff && input.myTimeOff.things > 0
      ? [
          {
            key: "handoff-me",
            kind: "handoff",
            title: `You are off ${input.myTimeOff.when}`,
            accountName: "Your calendar",
            why: `${countLabel(input.myTimeOff.things, "thing")} to hand over`,
            action: "Hand over",
            href: "/handoff",
          },
        ]
      : [];

  const waiting = input.news ?? [];
  // One line per account, each opening its own review: a single line used
  // to name three accounts and open only the first.
  const news: TodayItem[] = waiting.slice(0, 3).map((w) => ({
    key: `news-watch-${w.href}`,
    kind: "news" as const,
    title: `${countLabel(w.findings, "news item")} to keep or drop`,
    accountName: w.accountName,
    // A reason to act is said first: it is why this line is worth opening.
    why: [
      w.signals ? `${countLabel(w.signals, "reason")} to act` : null,
      w.touching > 0 ? `${w.touching} touch${w.touching === 1 ? "es" : ""} a play` : w.signals ? null : "none touches a play",
    ]
      .filter(Boolean)
      .join(", "),
    action: "Review",
    href: w.href,
  }));

  const ready: TodayItem[] = (input.ready ?? []).map((r) => ({ key: `ready-${r.key}`, kind: "ready", title: r.title, accountName: "", why: r.why, action: r.action, href: r.href }));

  // What an assistant wrote because you asked for it comes first: you are
  // waiting on it. Two at most, so it cannot crowd the day out.
  const all = [...ready.slice(0, 2), ...prepare, ...dueToday, ...recent, ...review, ...handoff, ...calendar, ...news, ...question, ...plan, ...notes, ...promise, ...fyi, ...away];
  return {
    items: all.slice(0, TODAY_LIMIT),
    found: all.length,
    backlog: {
      followUps: old.filter((i) => i.unit !== "play").length,
      plays: old.filter((i) => i.unit === "play").length,
    },
    meetingsToday,
    laterToday,
  };
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
function say(n: number, singular: string, plural = `${singular}s`): string {
  return `${WORDS[n] ?? String(n)} ${n === 1 ? singular : plural}`;
}
function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// One sentence, every word of it counted rather than written by a model.
export function todaySentence(plan: Pick<TodayPlan, "meetingsToday" | "found" | "backlog">, anyLate: boolean): string {
  const meetings = plan.meetingsToday === 0 ? "No meetings today" : `${capital(say(plan.meetingsToday, "meeting"))} today`;
  if (plan.found > TODAY_LIMIT) return `${meetings}. Here are the ${WORDS[TODAY_LIMIT]} that matter most.`;
  const older = plan.backlog.followUps + plan.backlog.plays > 0;
  const work = plan.found > 0 ? `${say(plan.found, "thing")} to clear` : older ? "nothing new to clear" : "nothing waiting on you";
  return `${meetings}, ${work}.${anyLate ? "" : " Nothing is overdue."}`;
}

export function greeting(hhmm: string, name: string | null | undefined): string {
  const hour = Number(hhmm.slice(0, 2));
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first ? `${part}, ${first}.` : `${part}.`;
}
