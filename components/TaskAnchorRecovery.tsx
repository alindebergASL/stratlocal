"use client";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Old /follow-ups#action-ID links still reach their task, even when it is
// off the current page, assigned to someone else, or has been completed.
export function TaskAnchorRecovery() {
  const router = useRouter();
  const search = useSearchParams();
  useEffect(() => {
    function recover() {
      const match = /^#action-([A-Za-z0-9_-]+)$/.exec(window.location.hash);
      if (match && !document.getElementById(`action-${match[1]}`)) router.replace(`/follow-ups/${encodeURIComponent(match[1]!)}`);
    }
    recover();
    window.addEventListener("hashchange", recover);
    return () => window.removeEventListener("hashchange", recover);
  }, [router, search]);
  return null;
}
