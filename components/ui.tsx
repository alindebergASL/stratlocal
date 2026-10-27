// The visual vocabulary. Before this, `button` was used once in the whole app
// and `buttonQuiet` never, against roughly twenty-five hand-written button
// strings in a dozen variants — and nothing anywhere had a focus style. Every
// primitive here carries its own focus ring, so keyboard use works by default
// rather than by remembering.
import { Fragment } from "react";
import Link from "next/link";
import { BackLink } from "./BackLink";
import { logValueText, sizeMarker } from "@/lib/format";
import { TONE_CALLOUT, TONE_CHIP, type Tone } from "@/lib/tone";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

// ---- buttons ----------------------------------------------------------------

export type ButtonVariant = "primary" | "quiet" | "positive" | "danger" | "ghost";
export type ControlSize = "sm" | "md";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-ink text-ink-invert hover:bg-ink-strong",
  quiet: "border border-control-line bg-surface text-ink hover:border-accent hover:bg-paper",
  positive: "bg-positive text-white hover:brightness-110",
  danger: "bg-danger text-white hover:brightness-110",
  ghost: "text-ink-muted hover:bg-surface-sunk hover:text-ink",
};

// `sm` is the size the frequent actions use — Accept, Reject, archive, the
// evidence disclosures — and at px-2 py-1 it was a 22px-high target pressed
// with a thumb. The type is unchanged; the box around it is not.
const SIZE: Record<ControlSize, string> = {
  sm: "rounded-sm px-2.5 py-1.5 text-micro",
  md: "rounded-md px-3 py-2 text-label",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ControlSize = "md"): string {
  return `inline-flex items-center justify-center gap-1.5 font-semibold transition-[background-color,border-color,filter] disabled:cursor-not-allowed disabled:opacity-50 ${SIZE[size]} ${VARIANT[variant]} ${FOCUS}`;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ControlSize }) {
  return <button type={type} className={`${buttonClass(variant, size)} ${className}`} {...rest} />;
}

// A link that acts like a button. Two of these were painted by hand and would
// have drifted from the real buttons forever.
export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className = "",
  children,
  testId,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ControlSize;
  className?: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <Link href={href} className={`${buttonClass(variant, size)} ${className}`} data-testid={testId}>
      {children}
    </Link>
  );
}

// ---- form controls ----------------------------------------------------------

function controlClass(size: ControlSize = "md"): string {
  const pad = size === "sm" ? "px-2 py-1 text-base sm:text-micro" : "px-2.5 py-1.5 text-base sm:text-label";
  return `w-full min-w-0 rounded-md border border-control-line bg-surface text-ink placeholder:text-ink-faint transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-60 ${pad} ${FOCUS}`;
}

// Kept as a bare string because most call sites spread it onto a native
// element inside an existing form layout.
export const control = controlClass("md");
export const controlSm = controlClass("sm");

export function Field({ label, hint, wide, children }: { label: string; hint?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={wide ? "basis-full" : ""}>
      <span className="mb-1 block text-micro font-medium text-ink-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-micro text-ink-faint">{hint}</span>}
    </label>
  );
}

// ---- containers -------------------------------------------------------------

// Exported because `Section` was the only way to get one, so anything that
// wanted a card and not a titled block hand-wrote the class string — which is
// why there are four spellings of it in the app and no card grid anywhere.
export function Card({ className = "", children, id }: { className?: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className={`rounded-xl border border-line bg-surface ${className}`}>
      {children}
    </section>
  );
}

// The header wraps: its aside now carries whole buttons, which at 390px used
// to fight the title for the same row.
export function Section({
  title,
  aside,
  children,
  id,
  className = "",
  // A section that knows it has nothing in it. It keeps its heading, its
  // count, its add action and its anchor, and gives up the empty room a
  // populated one needs (`.section-empty` in globals.css).
  empty = false,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
  className?: string;
  empty?: boolean;
}) {
  return (
    <Card id={id} className={`mb-6 p-4 sm:p-5 ${empty ? "section-empty" : ""} ${className}`}>
      <div className="section-heading mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="font-display text-heading font-bold tracking-tight text-ink-strong">{title}</h2>
        {aside && <div className="flex flex-wrap items-center gap-2 text-label text-ink-muted">{aside}</div>}
      </div>
      {children}
    </Card>
  );
}

export function Callout({
  tone = "neutral",
  className = "",
  children,
  testId,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
  /** A handle for the browser flows, as ActionForm has. */
  testId?: string;
}) {
  return (
    <div className={`rounded-lg border px-3.5 py-2.5 text-label ${TONE_CALLOUT[tone]} ${className}`} data-testid={testId}>
      {children}
    </div>
  );
}

// ---- small pieces -----------------------------------------------------------

export function Chip({ tone = "neutral", children, className = "" }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-micro font-semibold ${TONE_CHIP[tone]} ${className}`}>{children}</span>
  );
}

// The row as this form saw it.
//
// One hidden field is the whole mechanism behind refusing a save that would
// overwrite the other person's work: the server compares what has been written
// since against the fields this form would change. `updated_at` was already on
// every one of these tables and already maintained on every write — nothing
// had ever read it.
export function BaseVersion({ of }: { of: number | null | undefined }) {
  if (of == null) return null;
  return <input type="hidden" name="base_version" value={String(of)} readOnly />;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="empty-body py-4 text-label text-ink-muted">{children}</p>;
}

// A small label above a group or a title. It used to render an <h3>, which
// put a level-three heading immediately above the page's <h1> on three pages
// and told a screen reader the page begins with a subsection. It is a label,
// not a heading, and the Section it usually sits inside already has one.
export function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-micro font-bold uppercase tracking-[0.08em] text-ink-muted ${className}`}>{children}</p>;
}

// A labelled figure. `size` exists because half the call sites were wrapping
// their value in a span to undo the display type: a close date or an owner's
// name is a fact worth putting in the same row as the money, but it is not a
// number to read across a room, and at 28px it wrapped to three lines.
export function Stat({
  label,
  value,
  sub,
  tone,
  size = "number",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "accent";
  size?: "number" | "text";
}) {
  return (
    <div className="min-w-0">
      <div className="text-micro font-medium uppercase tracking-[0.06em] text-ink-muted">{label}</div>
      <div
        className={`${size === "number" ? "font-display text-title font-bold tabular-nums tracking-tight" : "text-body font-semibold"} ${
          tone === "accent" ? "text-accent" : "text-ink-strong"
        }`}
      >
        {value}
      </div>
      {sub && <div className="text-micro text-ink-muted">{sub}</div>}
    </div>
  );
}

export function AccountLink({ id, name, className = "" }: { id: string; name: string; className?: string }) {
  return (
    <Link href={`/accounts/${id}`} className={`font-semibold text-ink hover:text-accent hover:underline ${className}`}>
      {name}
    </Link>
  );
}

// Where a page sits (Accounts › account › section › page), each part a link,
// and above it a way back to wherever you actually came from.
export function Breadcrumb({ accountId, accountName, page, section }: { accountId: string; accountName: string; page: string; section?: { label: string; href: string } }) {
  const crumbs = [
    { label: "Accounts", href: "/accounts" },
    { label: accountName, href: `/accounts/${accountId}` },
    ...(section ? [section] : []),
  ];
  const parent = crumbs.at(-1)!;
  return (
    <div className="mb-3">
      <BackLink fallback={parent.href} fallbackLabel={parent.label} />
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-label text-ink-muted" data-testid="breadcrumb">
        {crumbs.map((c) => (
          <span key={c.href} className="flex min-w-0 items-center gap-1.5">
            <Link href={c.href} className="truncate hover:text-accent hover:underline">
              {c.label}
            </Link>
            <span aria-hidden className="text-ink-faint">
              ›
            </span>
          </span>
        ))}
        <span className="min-w-0 truncate text-ink" aria-current="page">
          {page}
        </span>
      </nav>
    </div>
  );
}

// Every page gets a real h1. Four of them had none at all — their largest
// heading was a section title at 16px.
export function PageHeader({ title, sub, actions }: { title: string; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div>
        <h1 className="font-display text-title font-extrabold tracking-tight text-ink-strong sm:text-display">{title}</h1>
        {sub && <p className="mt-1 text-label text-ink-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export { stageTone } from "@/lib/tone";
export type { Tone } from "@/lib/tone";

import { fieldLabel } from "@/lib/fieldLabels";

// What changed, from what to what.
//
// The activity feed printed the *names* of the fields that moved and nothing
// else — "close_date, tcv_usd" — on the page whose whole purpose is telling
// you what your partner did while you were away. It could not say whether he
// pulled a $1K deal into this quarter or pushed it out, although change_log
// has held both values in full fidelity since the first commit.
//
// A value too long to carry arrives as null with its size, and is rendered as
// that size — the same thing history already does for a meeting's notes
// (DECISIONS #9), and honest in a way that a truncated sentence is not.
export function ChangeSummary({
  changes,
  max,
  labels,
}: {
  changes: Array<{ field: string; from: string | null; to: string | null; fromBytes: number; toBytes: number }>;
  max: number;
  /** Resolves an id inside a value to a name, where the caller has one. */
  labels?: (id: string) => string | undefined;
}) {
  if (changes.length === 0) return null;
  // A record that was written down for the first time: every field starts at
  // nothing. "as of — → 2030-01-01; share pct — → 10; value usd — → 100"
  // is the record's own contents dressed as a diff — it costs twice the bytes
  // of the field names and tells you nothing the record's name did not. So
  // creates say what was filled in, and changes say what changed.
  const created = changes.every((c) => c.from === null && c.fromBytes === 0);
  if (created) {
    return (
      <span className="ml-2 text-micro text-ink-muted">
        added · {changes.map((c) => fieldLabel(c.field)).join(", ")}
      </span>
    );
  }
  const shown = changes.slice(0, max);
  const named = changes.slice(max);
  const side = (raw: string | null, bytes: number) => (raw === null ? (bytes > 0 ? sizeMarker(bytes) : "—") : logValueText(raw, labels));
  return (
    <span className="ml-2 text-micro text-ink-muted">
      {shown.map((c, i) => (
        // A Fragment with a key renders no element of its own, and <s> needs
        // no class: at 200 rows on /activity the markup around each value
        // costs more than the values. Wrapping every side in a styled <span>
        // took the page from 306 KB to 726 KB, which is the whole of
        // DECISIONS #20 in one change.
        <Fragment key={c.field}>
          {i > 0 ? "; " : ""}
          {fieldLabel(c.field)} <s>{clamp(side(c.from, c.fromBytes))}</s> → {clamp(side(c.to, c.toBytes))}
        </Fragment>
      ))}
      {/* Past the cap, names only. The values are what cost bytes, and by the
          fourth field on one row nobody is reading them anyway. */}
      {named.length > 0 ? ` · also ${named.map((c) => fieldLabel(c.field)).join(", ")}` : ""}
    </span>
  );
}

// Long enough to recognise a next step, short enough that one row stays a row.
function clamp(text: string, at = 60): string {
  return text.length <= at ? text : `${text.slice(0, at - 1)}…`;
}
