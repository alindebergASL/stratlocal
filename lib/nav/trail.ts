// Where you have been in this tab, so "Back" can go where you came from:
// a stack of in-app URLs, kept in sessionStorage (this tab only, gone when
// it closes). Pure functions here; the components wrap storage in try/catch.

export const TRAIL_KEY = "strategy_trail";
const MAX = 30;

/** The stack after arriving at `url`: a return to the entry below the top pops, anything else pushes. */
export function step(trail: string[], url: string): string[] {
  if (trail.at(-1) === url) return trail;
  if (trail.at(-2) === url) return trail.slice(0, -1);
  return [...trail, url].slice(-MAX);
}

/** The page you came from, if you came from inside the app. */
export function previous(trail: string[], current: string): string | null {
  return trail.at(-1) === current ? (trail.at(-2) ?? null) : (trail.at(-1) ?? null);
}

const ACCOUNT_TABS: Record<string, string> = {
  deals: "Deals",
  plays: "Plan",
  plan: "the plan",
  people: "People",
  meetings: "Meetings",
  "follow-ups": "Follow-ups",
  research: "Research",
  details: "Details",
  playbook: "Playbook",
  ask: "Ask",
  review: "Review",
  "install-base": "Install base",
  summary: "One page",
};

/** A short name for a page, from its URL, for "Back to …". */
export function placeName(url: string): string {
  const path = url.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return "Today";
  const [first, second, third, fourth] = parts;
  if (first === "accounts") {
    if (!second) return "Accounts";
    if (!third) return "the account";
    if (third === "deals" && fourth) return "the deal";
    if (third === "plays" && fourth) return "the play";
    if (third === "meetings" && fourth) return "the meeting";
    if (third === "contacts" && fourth) return "the person";
    if (third === "playbook" && fourth) return fourth === "workshop" ? "the workshop" : "the roadmap";
    return ACCOUNT_TABS[third] ?? "the account";
  }
  const top: Record<string, string> = {
    pipeline: "Pipeline",
    "follow-ups": second ? "the follow-up" : "Follow-ups",
    plans: "Plans",
    reports: second ? "the report" : "Reports",
    ask: "Ask",
    activity: "Activity",
    calendar: "Calendar",
    promises: "Promises",
    handoff: "Cover while away",
    close: "Close the day",
    team: second ? "their page" : "Team",
    settings: "Settings",
    search: "Search",
  };
  return top[first!] ?? "the last page";
}
