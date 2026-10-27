"use client";

// The box. Deliberately the whole page when a link is locked: no account name,
// no ask, nothing from the snapshot, because none of that should be readable
// by someone who has the address and not the word.
import { useActionState } from "react";
import { unlockHandoff, type UnlockState } from "./actions";

export function UnlockForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<UnlockState, FormData>(unlockHandoff.bind(null, token), { error: null });
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-body">
      <h1 className="text-title font-semibold text-ink-strong">This handoff is protected</h1>
      <p className="mt-2 text-ink-muted">Whoever sent you this link will have given you a passphrase. Enter it to read it.</p>
      <form action={action} className="mt-6 space-y-3">
        <label className="block">
          <span className="text-label text-ink-muted">Passphrase</span>
          <input
            type="password"
            name="passphrase"
            autoFocus
            autoComplete="off"
            data-testid="passphrase"
            className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-body text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          />
        </label>
        {state.error ? (
          <p role="alert" data-testid="passphrase-error" className="rounded-md border border-danger-line bg-danger-soft/50 px-3 py-2 text-label text-ink">
            {state.error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          data-testid="passphrase-submit"
          className="rounded-md bg-accent px-4 py-2 text-body font-semibold text-accent-ink disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          {pending ? "Checking…" : "Read it"}
        </button>
      </form>
    </main>
  );
}
