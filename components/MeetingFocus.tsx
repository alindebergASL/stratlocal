"use client";

import { useEffect, useState, type ReactNode } from "react";
import { focusFromHash, type MeetingFocus as Focus } from "@/lib/workflow";

const labels: Record<Focus, string> = { brief: "Prepare for the conversation", notes: "Capture or revisit notes", review: "Review proposed changes", "follow-ups": "Follow through", "meeting-summary": "Read the saved summary" };
// Freeze the entry suggestion: a refresh after saving/deciding must not move
// the user or remount their editor. Native anchors own history and scrolling.
export function MeetingFocus({ suggested, reason }: { suggested: Focus; reason: string }) {
  const [entry] = useState({ suggested });
  const [focus, setFocus] = useState(suggested);
  useEffect(() => {
    const sync = () => setFocus(focusFromHash(window.location.hash, entry.suggested));
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [entry]);
  return <div className="mb-4 rounded-xl border border-accent-line bg-accent-soft p-4 sm:p-5" data-testid="meeting-focus">
    <p className="text-micro font-semibold uppercase tracking-wide text-accent">Meeting workspace</p>
    <h2 className="mt-1 font-display text-heading font-bold text-ink-strong">{labels[focus]}</h2>
    <p className="mt-2 text-label text-ink-muted">{focus === suggested ? reason : "Selected section · all saved work remains available below."}</p>
    <a href={`#${focus}`} className="mt-3 inline-flex min-h-11 items-center rounded-md bg-accent px-4 py-2 font-semibold text-white hover:opacity-90">{labels[focus]} →</a>
  </div>;
}

// Keep DOM order stable through saves and proposal decisions as well as keeping
// the editor mounted. A changed server suggestion applies on the next visit.
export function MeetingPanels({ briefFirst, brief, notes }: { briefFirst: boolean; brief: ReactNode; notes: ReactNode }) {
  const [first] = useState(briefFirst);
  return <div data-testid="meeting-workspace" className="grid gap-5 lg:items-start lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
    {first ? [brief, notes] : [notes, brief]}
  </div>;
}
