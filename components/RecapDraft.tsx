"use client";

import { useState } from "react";
import { Icon } from "./icons";
import type { MeetingRecap } from "@/lib/meetings/recap";

// Square-bracketed gaps are the draft's way of saying "this needs you": they
// are drawn as a highlight rather than read as part of the sentence.
function WithGaps({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[[^\]]{1,80}\])/g).map((part, i) =>
        /^\[[^\]]+\]$/.test(part) ? (
          <mark key={i} className="whitespace-nowrap rounded bg-warning-soft px-1 text-warning ring-1 ring-warning-line">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

// A line the notes support: tap it to see the sentence it came from.
function Sourced({ text, quote }: { text: string; quote: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="block text-left underline decoration-accent-line decoration-2 underline-offset-4 hover:decoration-accent"
      >
        <WithGaps text={text} />
      </button>
      {open && <span className="animate-rise mt-1 block rounded-xl bg-surface-sunk px-3 py-2 text-micro text-ink-muted">You wrote: “{quote}”</span>}
    </li>
  );
}

export function RecapDraft({ recap, text, mailto, bodyInMail = true, sender }: { recap: MeetingRecap; text: string; mailto: string; bodyInMail?: boolean; sender: string }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const gaps = (text.match(/\[[^\]]{1,80}\]/g) ?? []).length;
  return (
    <div className="rounded-3xl border border-line bg-surface shadow-raised" data-testid="recap-draft">
      <div className="space-y-1 border-b border-line px-5 py-4 text-label text-ink-muted sm:px-7">
        <p className="grid grid-cols-[4.5rem_minmax(0,1fr)]"><span>To</span><span className="text-ink">{recap.to.length ? recap.to.join(", ") : "Add the people you met"}</span></p>
        <p className="grid grid-cols-[4.5rem_minmax(0,1fr)]"><span>Subject</span><span className="font-medium text-ink-strong">{recap.subject}</span></p>
      </div>
      <div className="space-y-3 px-5 py-5 text-body leading-relaxed text-ink-strong sm:px-7">
        <p>{recap.greeting}</p>
        {recap.opening && <p><WithGaps text={recap.opening} /></p>}
        {recap.points.length > 0 && <ul className="list-disc space-y-1.5 pl-5">{recap.points.map((p, i) => <Sourced key={i} text={p.text} quote={p.quote} />)}</ul>}
        {recap.next_steps.length > 0 && (
          <>
            <p className="font-semibold">Next steps</p>
            <ul className="list-disc space-y-1.5 pl-5">{recap.next_steps.map((p, i) => <Sourced key={i} text={p.text} quote={p.quote} />)}</ul>
          </>
        )}
        {recap.closing && <p><WithGaps text={recap.closing} /></p>}
        <p>Best,<br />{sender}</p>
      </div>
      {/* The draft is built from notes written for us, not for them. The
          check that every line quotes the notes cannot tell a fact from an
          aside, so the person is the last guard, and is told so plainly. */}
      <p className="flex gap-2 border-t border-line bg-warning-soft px-5 py-3 text-label text-warning sm:px-7" data-testid="recap-read-first">
        <Icon name="flag" className="mt-0.5 size-4 shrink-0" />
        <span>Read every line before you send it. The draft comes from your own notes, so it can repeat something meant only for your team.</span>
      </p>
      <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4 sm:px-7">
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
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-control-line bg-surface px-4 font-semibold text-ink transition hover:border-accent"
          data-testid="recap-copy"
        >
          <Icon name={copied === "done" ? "check" : "copy"} />{copied === "done" ? "Copied" : "Copy"}
        </button>
        <a href={mailto} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-4 font-semibold text-white shadow-raised transition hover:-translate-y-px hover:bg-accent-hover" data-testid="recap-mail">
          <Icon name="mail" />Open in Mail
        </a>
        <p className="text-micro text-ink-muted" role="status">
          {copied === "failed" ? "The browser would not copy; select the text instead." : !bodyInMail ? "Too long for a mail link: Open in Mail starts the message, then Copy and paste the text in." : gaps > 0 ? `${gaps} gap${gaps === 1 ? "" : "s"} to fill before sending. Underlined lines come from your notes.` : "Underlined lines come from your notes. Nothing is sent from Strategy."}
        </p>
      </div>
    </div>
  );
}
