import Link from "next/link";
import type { AccountSignals } from "@/lib/queries/accountSignals";
import { Icon, type IconName } from "./icons";

// The marks for what deserves attention on an account, in one look and one
// order everywhere: a reason to act, overdue follow-ups, changes waiting, deals
// with no next step, and an account gone quiet. Each carries an icon and a
// word as well as a colour, and nothing renders when there is nothing to say.
type Tone = "warning" | "danger" | "accent" | "neutral";
const TONE: Record<Tone, string> = {
  warning: "bg-warning-soft text-warning ring-1 ring-warning-line",
  danger: "bg-danger-soft text-danger ring-1 ring-danger-line",
  accent: "bg-accent-soft text-accent ring-1 ring-accent-line",
  neutral: "bg-surface-sunk text-ink-muted ring-1 ring-line",
};

export function SignalChip({ tone, icon, children, href, testId }: { tone: Tone; icon: IconName; children: React.ReactNode; href?: string; testId?: string }) {
  const cls = `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-semibold ${TONE[tone]}`;
  const body = (
    <>
      <Icon name={icon} className="size-3" />
      {children}
    </>
  );
  return href ? (
    <Link href={href} className={`${cls} hover:underline`} data-testid={testId}>
      {body}
    </Link>
  ) : (
    <span className={cls} data-testid={testId}>
      {body}
    </span>
  );
}

export function SignalChips({ accountId, signals, links = true, only, className = "" }: { accountId: string; signals: AccountSignals; links?: boolean; only?: Array<keyof AccountSignals>; className?: string }) {
  const base = `/accounts/${accountId}`;
  const show = (k: keyof AccountSignals) => !only || only.includes(k);
  const href = (p: string) => (links ? p : undefined);
  const chips = [
    show("reason") && signals.reason && (
      <SignalChip key="reason" tone="warning" icon="flag" href={href(`${base}/research`)} testId="signal-reason">
        {signals.reason.kind === "compelling_event" ? "Compelling event" : "Reason to act"}
        {signals.reason.date && <span className="font-normal tabular-nums">· {signals.reason.date}</span>}
      </SignalChip>
    ),
    show("overdue") && signals.overdue > 0 && (
      <SignalChip key="overdue" tone="danger" icon="clock" href={href(`${base}/follow-ups`)} testId="signal-overdue">
        {signals.overdue} overdue
      </SignalChip>
    ),
    show("review") && signals.review > 0 && (
      <SignalChip key="review" tone="accent" icon="review" href={href(`/inbox?kind=changes&account=${accountId}`)} testId="signal-review">
        {signals.review} to review
      </SignalChip>
    ),
    show("noNextStep") && signals.noNextStep > 0 && (
      <SignalChip key="next" tone="neutral" icon="arrow" href={href(`${base}/deals`)} testId="signal-next-step">
        {signals.noNextStep} without a next step
      </SignalChip>
    ),
    show("quiet") && signals.quiet && (
      <SignalChip key="quiet" tone="warning" icon="pen" testId="signal-quiet">
        {signals.quietDays === null ? "nothing written down yet" : `quiet ${Math.floor(signals.quietDays / 7)} weeks`}
      </SignalChip>
    ),
  ].filter(Boolean);
  if (chips.length === 0) return null;
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`} data-testid="signals">
      {chips}
    </div>
  );
}
