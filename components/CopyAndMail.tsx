"use client";

import { useState } from "react";
import { Icon } from "./icons";
import { buttonClass } from "./ui";

// Copy as text, and Open in Mail — the recap draft's two buttons
// (components/RecapDraft.tsx). Nothing is sent from Strategy: the mail opens
// in your own client, addressed to nobody, for you to send.
export function CopyAndMail({ text, mailto, withBody, testId = "copy-mail" }: { text: string; mailto: string; withBody: boolean; testId?: string }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  // Said once Mail is pressed, not before: most answers fit a mail link.
  const [mailed, setMailed] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-1" data-print-hide data-testid={testId}>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied("done");
          } catch {
            setCopied("failed");
          }
        }}
        className={buttonClass("ghost", "sm")}
        title="Copy as plain text, with the sources listed"
        data-testid={`${testId}-copy`}
      >
        <Icon name={copied === "done" ? "check" : "copy"} className="size-4" />
        {copied === "done" ? "Copied" : "Copy"}
      </button>
      <a href={mailto} className={buttonClass("ghost", "sm")} title="Open a new message in your own mail app" onClick={() => setMailed(true)} data-testid={`${testId}-mail`}>
        <Icon name="mail" className="size-4" />
        Mail
      </a>
      <span className="text-micro text-ink-muted" role="status">
        {copied === "failed" ? "The browser would not copy; select the text instead." : !withBody && mailed ? "Too long for a mail link: the message opens empty — press Copy and paste it in." : null}
      </span>
    </div>
  );
}
