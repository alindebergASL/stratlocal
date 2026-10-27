// Every place in the app, once. The main navigation, the More menu and the
// command palette all read this list, so they can no longer disagree about
// what exists or what it is called (DECISIONS #95).
import type { IconName } from "@/components/icons";

export type Destination = {
  href: string;
  label: string;
  icon: IconName;
  /** What it is for, shown in the command palette. */
  detail: string;
  /** Other words someone might type for it. */
  keywords?: string;
  /** g + this key jumps there. */
  key?: string;
};

/** The five places a day is spent: Inbox is where every decision waits (DECISIONS #97). */
export const PRIMARY: Destination[] = [
  { href: "/", label: "Today", icon: "today", detail: "What needs you, and what changed", key: "t" },
  { href: "/accounts", label: "Accounts", icon: "accounts", detail: "Every account, and a new one", key: "a" },
  { href: "/pipeline", label: "Pipeline", icon: "pipeline", detail: "Every open deal by quarter", key: "p" },
  { href: "/inbox", label: "Inbox", icon: "review", detail: "Everything waiting on a decision, from every account", keywords: "review approve changes questions", key: "i" },
  { href: "/ask", label: "Ask", icon: "ask", detail: "A question about anything on file, answered with sources", key: "k" },
];

export const MORE_GROUPS: Array<{ title: string; items: Destination[] }> = [
  {
    title: "Work",
    items: [
      { href: "/follow-ups", label: "Tasks", icon: "tasks", detail: "What you and the team owe, across accounts", keywords: "follow-ups todo", key: "f" },
      { href: "/activity", label: "What changed", icon: "activity", detail: "Every change, by whom and when", keywords: "activity history", key: "c" },
      { href: "/calendar", label: "Calendar", icon: "calendar", detail: "Meetings to add from your calendars" },
      { href: "/?view=close", label: "Close the day", icon: "check", detail: "What you did, loose ends, tomorrow" },
      { href: "/handoff", label: "Cover while away", icon: "people", detail: "What falls in your time off, and handing it over", keywords: "handoff" },
      { href: "/reports", label: "Reports", icon: "copy", detail: "What Ask has written up, to print or share" },
      { href: "/search", label: "Search", icon: "search", detail: "Everything on file, by words", key: "s" },
    ],
  },
  {
    title: "Team",
    items: [
      { href: "/team", label: "Team", icon: "people", detail: "What each of us owns, did this week, and where a hand would help" },
      { href: "/assistants", label: "Assistants", icon: "sparkle", detail: "What runs on its own, and the AI budget", keywords: "agents budget" },
    ],
  },
  {
    title: "Settings",
    items: [
      { href: "/settings/direction", label: "Team direction", icon: "flag", detail: "What the team sells and is trying to achieve" },
      { href: "/settings/playbook", label: "Playbook", icon: "stack", detail: "How the team runs an account, step by step" },
      { href: "/settings/team", label: "Team setup", icon: "people", detail: "Who is on the team, roles, the app's name, your password" },
      { href: "/settings/salesforce", label: "Salesforce", icon: "stack", detail: "The optional connection to the CRM" },
      { href: "/settings/connections", label: "Connections", icon: "mail", detail: "Slack or Teams for your morning digest", keywords: "slack teams webhook digest notify" },
    ],
  },
];

export const ALL_DESTINATIONS: Destination[] = [...PRIMARY, ...MORE_GROUPS.flatMap((g) => g.items)];

/** Whether a path is inside a destination: an account's pages are still Accounts. */
export function isActive(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
