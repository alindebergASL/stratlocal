"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

// A block of plain text to paste into another system, with one button to
// copy it and the text itself to select by hand if the browser will not.
export function CopyBlock({ text, label, testId }: { text: string; label: string; testId?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="quiet"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setState("copied");
            } catch {
              setState("failed");
            }
          }}
        >
          {label}
        </Button>
        <span role="status" className="text-micro text-ink-muted">
          {state === "copied" ? "Copied." : state === "failed" ? "The browser would not copy; select the text below instead." : null}
        </span>
      </div>
      <details>
        <summary className="cursor-pointer text-micro text-ink-muted">Show the text</summary>
        <pre className="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-surface-sunk p-3 text-micro text-ink">{text}</pre>
      </details>
    </div>
  );
}
