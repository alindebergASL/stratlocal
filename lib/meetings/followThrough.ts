// Read-only presentation: no inferred meeting completion or extraction ledger.
export function followUpGaps(items: readonly { status: string; archived_at?: string | null; owner: string | null; owner_user_id?: string | null; due: string | null }[]) {
  const open = items.filter((i) => i.status === "open" && i.archived_at == null);
  const missingOwner = (i: typeof open[number]) => !i.owner_user_id && !i.owner?.trim();
  const missingDate = (i: typeof open[number]) => !i.due;
  return { open: open.length, items: open.filter((i) => missingOwner(i) || missingDate(i)).length, owners: open.filter(missingOwner).length, dates: open.filter(missingDate).length };
}

export type FollowThroughInput = {
  dirty: boolean; saving: boolean; busy: boolean; conflict: boolean;
  error: string | null; runError: string | null; failed: boolean;
  hasNotes: boolean; tooShort: boolean; pending: number; gaps: number;
  disabledReason?: string | null; readOnlyReason?: string | null;
};
export function followThrough(input: FollowThroughInput) {
  const s = input;
  if (s.readOnlyReason) return { text: s.readOnlyReason, label: "View recorded follow-ups", href: "#follow-ups" };
  if (s.conflict) return { text: "Notes not saved: resolve the conflict below. Your draft is preserved.", label: "Resolve notes conflict", href: "#notes-controls" };
  if (s.error) return { text: `Notes not saved: ${s.error}`, label: "Check save controls", href: "#notes-controls" };
  if (s.runError || s.failed) return { text: `${s.dirty ? "Unsaved notes. " : ""}Extraction needs attention; no completion is implied.`, label: "Check extraction controls", href: "#notes-controls" };
  if (s.busy) return { text: `${s.dirty ? "Unsaved notes. " : ""}Extraction is running.`, label: "View extraction progress", href: "#notes-controls" };
  if (s.saving) return { text: "Saving notes…", label: "View save progress", href: "#notes-controls" };
  if (s.dirty) return { text: "Unsaved notes — this draft is not saved yet.", label: "Review save controls", href: "#notes-controls" };
  if (s.pending) return { text: s.hasNotes ? "Notes saved. Proposals still require your decision." : "No notes saved. Proposals still require your decision.", label: "Review proposed changes", href: "#review" };
  if (s.gaps) return { text: s.hasNotes ? "Notes saved. Recorded follow-ups need details." : "No notes saved. Recorded follow-ups need details.", label: "Edit follow-up owners and dates", href: "#follow-ups" };
  return { text: s.hasNotes ? "Notes saved. Review or extract when ready." : "No notes saved yet.", detail: s.hasNotes ? "Saving notes does not extract changes." : undefined, label: !s.hasNotes || s.tooShort ? "Go to notes" : s.disabledReason ? "Check extraction availability" : "Review extraction controls", href: !s.hasNotes || s.tooShort ? "#notes-editor" : "#notes-controls" };
}
