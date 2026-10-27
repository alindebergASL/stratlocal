// What a refused save carries back so the form can explain it rather than
// just report it: the fields the other person changed, what each says now,
// who wrote it and when, and the version to submit with if the answer is
// "mine anyway".
export type Conflict = {
  currentVersion: number | null;
  // Authenticated notes-only snapshot, never the size marker in change_log.
  notes?: { text: string; version: number };
  changes: Array<{ field: string; label: string; theirs: string; actor: string; atMs: number }>;
};

// `version` is the row's new version after a successful write. The notes
// panel and the follow-up checkboxes need it: both stay mounted after a save,
// often on a page the save does not re-render, so without this their second
// write is measured against their own first one — and the notice names you as
// the other person. `versions` is the same for a write of several rows.
export type ActionResult = { ok: true; version?: number; versions?: Record<string, number> } | { ok: false; error: string; conflict?: Conflict };

// Calls a server action and turns a *rejected* promise into an ordinary
// failure result.
//
// Every client form in this app handled `{ ok: false }` and none of them
// handled the promise rejecting, which is what a dropped connection does. The
// worst case was the one the app is actually used for: paste a meeting's notes
// in a car park with one bar of signal, press save, lose the request, and lose
// the notes — they only ever existed in component state, and the unhandled
// rejection took the component with them.
export async function attempt(run: () => Promise<ActionResult | void>): Promise<ActionResult> {
  try {
    const r = await run();
    return r ?? { ok: true };
  } catch (e) {
    // A navigation started by redirect() inside a server action rejects with a
    // sentinel that has to be re-thrown or the redirect never happens.
    if (isRedirect(e)) throw e;
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      // A dropped connection says nothing about whether the request landed:
      // the save can commit and the reply still be the part that was lost.
      // What is kept is the input, so say that — and never "nothing was
      // saved", which on a create form is the sentence that makes a second
      // copy, and on an edit the one that conflicts you with your own save.
      error: /fetch|network|load failed/i.test(message)
        ? "The connection dropped before the server answered. What you typed is still here; whether it was saved is not known from this page — check the record before sending it again."
        : message || "The request failed.",
    };
  }
}

function isRedirect(e: unknown): boolean {
  const digest = (e as { digest?: unknown })?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND");
}
