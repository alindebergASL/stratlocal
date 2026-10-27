"use server";

// The one server action in this app that does not call requirePageUser, on
// purpose: the person answering the box has no login and is never given one.
//
// It reaches exactly one document, by a token it must already hold, and the
// only thing it can produce is a cookie scoped to that document's own path.
import { cookies } from "next/headers";
import { sharedByToken } from "@/lib/handoff/store";
import { needsPassphrase, tryUnlock, unlockCookieName } from "@/lib/handoff/share";

export type UnlockState = { error: string | null };

export async function unlockHandoff(token: string, _prev: UnlockState, fd: FormData): Promise<UnlockState> {
  const doc = sharedByToken(decodeURIComponent(token));
  const found = doc ? { doc } : null;
  // Same answer as the page gives for a token that was never real. A link that
  // has expired or been ended between the box rendering and the word being
  // typed must not start describing itself.
  if (!found || !needsPassphrase(found.doc)) return { error: "This link is no longer available." };

  const phrase = String(fd.get("passphrase") ?? "");
  const result = tryUnlock(found.doc, phrase);
  if (!result.ok) return { error: result.error };

  const jar = await cookies();
  jar.set(unlockCookieName(found.doc), result.proof, {
    httpOnly: true,
    sameSite: "lax",
    // Set on https and harmless on the http used by the browser flows.
    secure: process.env.NODE_ENV === "production",
    // Sent to this link and nothing else in the app.
    path: `/s/${token}`,
    // Never outlives the link itself.
    expires: new Date(Math.min(found.doc.share_expires_at ?? 0, Date.now() + 12 * 3_600_000)),
  });
  return { error: null };
}
