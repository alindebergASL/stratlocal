"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { placeName, previous, TRAIL_KEY } from "@/lib/nav/trail";

// "← Back to Pipeline": the page you came from in this tab, by the browser's
// own back so its filters and scroll come with it. Arriving from outside the
// app (a link, a bookmark), it is the page's natural parent instead.
export function BackLink({ fallback, fallbackLabel }: { fallback: string; fallbackLabel: string }) {
  const router = useRouter();
  const [prev, setPrev] = useState<string | null>(null);
  useEffect(() => {
    try {
      const trail = JSON.parse(sessionStorage.getItem(TRAIL_KEY) ?? "[]") as string[];
      setPrev(previous(Array.isArray(trail) ? trail : [], `${location.pathname}${location.search}`));
    } catch {
      setPrev(null);
    }
  }, []);
  const cls = "inline-flex min-h-9 items-center text-label font-semibold text-accent hover:underline";
  if (prev) {
    return (
      <button type="button" onClick={() => router.back()} className={cls} data-testid="back-link">
        ← Back to {placeName(prev)}
      </button>
    );
  }
  return (
    <Link href={fallback} className={cls} data-testid="back-link">
      ← {fallbackLabel}
    </Link>
  );
}
