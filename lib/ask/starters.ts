// Questions worth asking right now, worked out from the records — no model.
//
// An empty question box is the hardest way to start. These are drawn from
// what moved, what stalled and what is due, so each one is a question the
// data already says is worth asking, with its count in the words. They are
// only suggestions: pressing one asks it like any other question.
import { listMovement, listStalled } from "../queries/movement";
import { listAttention } from "../queries/attention";
import { upcomingMeetings } from "../queries/today";
import { currentFiscalQuarter } from "../fiscal";
import { getAccount } from "../queries/accounts";

const DAY = 86_400_000;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function starterQuestions(opts: { accountId?: string | null; now?: Date } = {}): string[] {
  const now = opts.now ?? new Date();
  const accountId = opts.accountId ?? null;
  const quarter = currentFiscalQuarter(now);
  const out: string[] = [];

  const pushed = listMovement(now.getTime() - 7 * DAY, { accountId }).filter((m) => m.kind === "pushed_out");
  if (pushed.length) out.push(`${plural(pushed.length, "deal was", "deals were")} pushed out this week. Which matter, and why did they slip?`);

  const stalled = listStalled(now.getTime() - 21 * DAY, quarter, { accountId });
  if (stalled.length) out.push(`${plural(stalled.length, "deal")} closing in ${quarter.label} ${stalled.length === 1 ? "has" : "have"} not moved in three weeks. Where is the risk?`);

  const attention = listAttention(now).filter((a) => !accountId || a.accountId === accountId);
  const overdue = attention.filter((a) => a.kind === "overdue").reduce((n, a) => n + (a.count ?? 1), 0);
  if (overdue) out.push(`What is overdue${accountId ? " here" : ""}, and what should I do first?`);

  const tomorrow = new Date(now.getTime() + DAY).toISOString().slice(0, 10);
  const next = upcomingMeetings(now, 2).find((m) => m.heldAt.slice(0, 10) === tomorrow && (!accountId || m.accountId === accountId));
  if (next) out.push(`Prepare me for tomorrow's meeting: ${next.title}.`);

  if (accountId) {
    const name = getAccount(accountId)?.name ?? "this account";
    out.push(`Where does ${name} stand, in five lines?`, "Who should we talk to next, and why?", "What have we promised them, and is any of it late?");
  } else {
    out.push(`Where does the pipeline stand for ${quarter.label}?`, "What changed this week, and who changed it?");
  }
  return [...new Set(out)].slice(0, 4);
}
