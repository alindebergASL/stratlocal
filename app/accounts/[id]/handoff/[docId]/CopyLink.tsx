"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

// The link, visible and copyable.
//
// Shown in full rather than hidden behind a button: this is a URL that lets
// anyone holding it read a customer's pipeline, and a person about to paste it
// into an email should be able to see exactly what they are pasting.
export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code
        data-testid="share-link"
        className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-line bg-surface-sunk px-2 py-1 text-micro text-ink"
      >
        {url}
      </code>
      <Button
        variant="quiet"
        size="sm"
        data-testid="copy-link"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            // No clipboard permission, which is why the URL is on screen.
            setCopied(false);
          }
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
