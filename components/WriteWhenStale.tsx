"use client";

import { useEffect } from "react";

// Asks the Writer to catch up when what is shown was counted because the
// written version is out of date (DECISIONS #106). In the background, after
// the page is on screen; the page never waits for it and never writes itself.
export function WriteWhenStale({ place, id }: { place: "today" | "account"; id?: string }) {
  useEffect(() => {
    void fetch("/api/writer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ place, id }), keepalive: true }).catch(() => {});
  }, [place, id]);
  return null;
}
