"use client";

// There was no error boundary anywhere in this app, so any throw in a server
// component — a malformed row, a database that had gone away — produced Next's
// default blank page reading "Application error: a server-side exception has
// occurred", with the actual message only in a server log neither of these two
// people can read.
//
// This keeps the chrome, says the real thing, and offers the two moves that
// actually help: try again, or go somewhere that works.

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[page]", error);
  }, [error]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <p className="text-micro font-semibold uppercase tracking-[0.08em] text-danger">This page did not load</p>
      <h1 className="mt-2 font-display text-title font-bold text-ink-strong">Something threw.</h1>
      <p className="mt-3 text-body text-ink">
        Nothing was lost — this app only writes when you press a button, and nothing here did.
      </p>

      <pre className="mt-5 overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-danger-line bg-danger-soft/40 p-3 text-micro text-ink">
        {error.message || error.name || "No message."}
        {error.digest ? `\n\ndigest ${error.digest}` : ""}
      </pre>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center rounded-md bg-accent px-3 py-1.5 text-label font-semibold text-white transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex items-center rounded-md border border-line px-3 py-1.5 text-label font-medium text-ink transition-colors hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Back to Today
        </Link>
      </div>
    </main>
  );
}
