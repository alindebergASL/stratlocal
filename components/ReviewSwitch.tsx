"use client";

import { useState } from "react";

// One card at a time by default; the whole list when you want to see it all
// at once. Both are the same decisions against the same endpoints, so which
// one you use is a matter of taste, not of what gets written.
export function ReviewSwitch({ deck, list }: { deck: React.ReactNode; list: React.ReactNode }) {
  const [view, setView] = useState<"deck" | "list">("deck");
  return (
    <div>
      <div role="group" aria-label="How to review" className="mb-4 inline-flex rounded-xl bg-surface-sunk p-1 text-label">
        {(["deck", "list"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            data-testid={v === "list" ? "review-as-list" : "review-as-deck"}
            className={`rounded-lg px-3 py-1.5 font-medium transition ${view === v ? "bg-surface text-ink-strong shadow-card" : "text-ink-muted hover:text-ink"}`}
          >
            {v === "deck" ? "One at a time" : "All at once"}
          </button>
        ))}
      </div>
      {view === "deck" ? deck : list}
    </div>
  );
}
