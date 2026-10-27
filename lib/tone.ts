// One place that decides what colour a status is.
//
// This replaces four maps that had drifted apart: Badge's own tone table,
// stageTone (which gave stage 3 and stage 6 the same colour), PLAY_TONE on the
// account page — which also doubled as the source of the status dropdown's
// options — and CONFIDENCE_TONE, defined byte-identically in two files and
// re-stating Badge's tones as raw strings in both.
import { ContactRole, PlayStatus } from "./proposals/schema";

export type Tone = "neutral" | "accent" | "positive" | "warning" | "danger" | "info";

// Soft chip: coloured ground, readable text, faint border.
export const TONE_CHIP: Record<Tone, string> = {
  neutral: "bg-surface-sunk text-ink-muted ring-1 ring-line",
  accent: "bg-accent-soft text-accent ring-1 ring-accent-line",
  positive: "bg-positive-soft text-positive ring-1 ring-positive-line",
  warning: "bg-warning-soft text-warning ring-1 ring-warning-line",
  danger: "bg-danger-soft text-danger ring-1 ring-danger-line",
  info: "bg-accent-soft text-accent ring-1 ring-accent-line",
};

// Block callout: the same three colours at panel scale.
export const TONE_CALLOUT: Record<Tone, string> = {
  neutral: "border-line bg-surface-sunk text-ink",
  accent: "border-accent-line bg-accent-soft text-ink",
  positive: "border-positive-line bg-positive-soft text-positive",
  warning: "border-warning-line bg-warning-soft text-warning",
  danger: "border-danger-line bg-danger-soft text-danger",
  info: "border-accent-line bg-accent-soft text-ink",
};

export const PLAY_STATUSES = PlayStatus.options;

export const PLAY_TONE: Record<string, Tone> = {
  proposed: "accent",
  active: "positive",
  stalled: "warning",
  won: "info",
  dropped: "neutral",
  not_applicable: "neutral",
  info_only: "info",
};

const PLAY_STATUS_LABEL: Record<string, string> = { not_applicable: "not applicable", info_only: "information only" };
export const playStatusLabel = (s: string) => PLAY_STATUS_LABEL[s] ?? s;

/** Play statuses that still ask for work: next steps, check-ins, warnings. */
export const LIVE_PLAY_STATUSES = ["proposed", "active", "stalled"] as const;

export const DEAL_STATUS_TONE: Record<string, Tone> = {
  open: "accent",
  won: "positive",
  lost: "neutral",
};

export const CONFIDENCE_TONE: Record<string, Tone> = {
  high: "positive",
  medium: "warning",
  low: "neutral",
};

// Routine progress is not a warning or a confirmed win. Stage labels carry
// the distinction; semantic colours remain available for actual outcomes/gaps.
export function stageTone(stage: number | null): Tone {
  if (stage === null) return "neutral";
  if (stage <= 1) return "neutral";
  return "accent";
}

// The role enum is closed, so the field must be a picker. It was a free-text
// input with a placeholder, and typing a real job title — "CIO", "VP
// Infrastructure" — failed the save with a raw zod message. A person's actual
// job title goes in Title; this is what they are to us.
export const CONTACT_ROLES = ContactRole.options;

export const ROLE_LABELS: Record<string, string> = {
  ae: "Account executive",
  se: "Systems engineer",
  specialist_ae: "Specialist AE",
  specialist_se: "Specialist SE",
  partner: "Partner",
  executive: "Executive",
  it_leader: "IT leader",
  technical: "Technical",
  procurement: "Procurement",
  other: "Other",
};
