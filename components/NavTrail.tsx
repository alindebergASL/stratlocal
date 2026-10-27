"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { step, TRAIL_KEY } from "@/lib/nav/trail";

// Records each page you arrive at in this tab, for BackLink.
export function NavTrail() {
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    const url = `${pathname}${search.size ? `?${search.toString()}` : ""}`;
    try {
      const trail = JSON.parse(sessionStorage.getItem(TRAIL_KEY) ?? "[]") as string[];
      sessionStorage.setItem(TRAIL_KEY, JSON.stringify(step(Array.isArray(trail) ? trail : [], url)));
    } catch {
      // No storage (private window, blocked): Back falls back to the parent page.
    }
  }, [pathname, search]);
  return null;
}
