"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

// On a phone the account's tabs scroll sideways inside their strip, and
// Research or Details start off its right edge: bring the current one in.
// Only the strip moves, never the page.
export function CurrentTabIntoView() {
  const pathname = usePathname();
  useEffect(() => {
    const reveal = () => {
      const nav = document.querySelector<HTMLElement>('[data-testid="account-tabs"]');
      const strip = nav?.querySelector<HTMLElement>("ul");
      const current = strip?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!strip || !current) return;
      const bounds = strip.getBoundingClientRect();
      const active = current.getBoundingClientRect();
      if (active.right > bounds.right) strip.scrollLeft += active.right - bounds.right;
      else if (active.left < bounds.left) strip.scrollLeft += active.left - bounds.left;
    };
    reveal();
    window.addEventListener("resize", reveal);
    return () => window.removeEventListener("resize", reveal);
  }, [pathname]);
  return null;
}
