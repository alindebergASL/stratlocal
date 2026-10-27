"use client";

import { useState } from "react";
import { Button } from "./ui";
import { Icon } from "./icons";

export type DraftPoint = { text: string; sources: Array<{ label: string; href: string | null }> };

// A Handoff writer draft: the opening, the points, and under each point the
// records it cites. "Use this draft" fills a form on the page (DECISIONS #24);
// "Copy" puts it on the clipboard. Neither sends anything.
export function DraftView({ opening, points, fill, testId = "handoff-draft" }: { opening: string; points: DraftPoint[]; fill?: { form: string; opening: string; points: string }; testId?: string }) {
  const [state, setState] = useState<"idle" | "used" | "copied" | "failed">("idle");
  const asText = `${opening}\n\n${points.map((p) => `- ${p.text}`).join("\n")}`.trim();
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 sm:p-5" data-testid={testId}>
      <p className="whitespace-pre-wrap text-body text-ink-strong">{opening}</p>
      {points.length > 0 && (
        <ul className="mt-3 space-y-2">
          {points.map((p, i) => (
            <li key={i} className="text-body text-ink">
              <span className="mr-1.5 text-ink-muted">•</span>
              {p.text}
              {p.sources.length > 0 && (
                <span className="mt-0.5 block pl-4 text-micro text-ink-muted">
                  From{" "}
                  {p.sources.map((s, j) => (
                    <span key={j}>
                      {j > 0 && ", "}
                      {s.href ? <a href={s.href} className="text-accent hover:underline">{s.label}</a> : s.label}
                    </span>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {fill && (
          <Button
            size="sm"
            onClick={() => {
              const form = document.querySelector(`[data-testid="${fill.form}"]`);
              const set = (name: string, value: string) => {
                const el = form?.querySelector<HTMLTextAreaElement>(`[name="${name}"]`);
                if (!el) return false;
                el.value = value;
                el.dispatchEvent(new Event("input", { bubbles: true }));
                return true;
              };
              const ok = set(fill.opening, opening) && set(fill.points, points.map((p) => `- ${p.text}`).join("\n"));
              setState(ok ? "used" : "failed");
              if (ok) form?.querySelector<HTMLTextAreaElement>(`[name="${fill.opening}"]`)?.focus();
            }}
            data-testid={`${testId}-use`}
          >
            {state === "used" ? "In the form below — edit it there" : "Use this draft"}
          </Button>
        )}
        <Button
          size="sm"
          variant="quiet"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(asText);
              setState("copied");
            } catch {
              setState("failed");
            }
          }}
          data-testid={`${testId}-copy`}
        >
          <Icon name={state === "copied" ? "check" : "copy"} />
          {state === "copied" ? "Copied" : "Copy"}
        </Button>
        {state === "failed" && <span role="alert" className="text-micro text-danger">That did not work; select the text instead.</span>}
      </div>
    </div>
  );
}
