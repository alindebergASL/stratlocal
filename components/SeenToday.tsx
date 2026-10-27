"use client";

import { useEffect } from "react";

// Tells the server you looked at Today, once the page is on screen
// (app/api/me/seen-today). Nothing is shown and nothing waits on it.
export const SEEN_TODAY_URL = "/api/me/seen-today";

export function SeenToday() {
  useEffect(() => {
    void fetch(SEEN_TODAY_URL, { method: "POST", keepalive: true }).catch(() => {});
  }, []);
  return null;
}

// The same, for an account's Overview (app/api/accounts/[id]/seen).
export function SeenAccount({ accountId }: { accountId: string }) {
  useEffect(() => {
    void fetch(`/api/accounts/${encodeURIComponent(accountId)}/seen`, { method: "POST", keepalive: true }).catch(() => {});
  }, [accountId]);
  return null;
}
