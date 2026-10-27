"use client";

import { useEffect, type ReactNode } from "react";

// Native disclosures stay closed until requested. A nested fragment opens
// every enclosing disclosure, including when the same link is clicked again.
export function revealHash(hash: string, root: Document = document): HTMLElement | null {
  let id: string;
  try {
    id = decodeURIComponent(hash.replace(/^#/, ""));
  } catch {
    return null;
  }
  if (!id) return null;
  const target = root.getElementById(id);
  for (let node: HTMLElement | null = target; node; node = node.parentElement) {
    if (node.tagName === "DETAILS") node.setAttribute("open", "");
  }
  return target;
}

export function OpenOnHash() {
  useEffect(() => {
    let frame = 0;
    const open = (hash = window.location.hash) => {
      const target = revealHash(hash);
      if (target) {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          // Navigation wraps; a fixed 5rem offset hides the summary under the
          // sticky header. Measure the actual header at the jump — but only
          // when it is a bar across the top that stays put. On a phone it
          // scrolls away, and on a wide screen it is a sidebar beside the
          // page: its height is the whole viewport and it covers nothing.
          const header = document.querySelector("header");
          const box = header?.getBoundingClientRect();
          const covers = !!header && !!box && getComputedStyle(header).position === "sticky" && box.width > box.height;
          target.style.scrollMarginTop = `${covers ? Math.ceil(box.height) + 16 : 16}px`;
          target.scrollIntoView({ block: "start" });
        });
      }
    };
    const changed = () => open();
    const clicked = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!link || link.hasAttribute("download") || (link.getAttribute("target") && link.getAttribute("target") !== "_self")) return;
      const url = new URL(link.getAttribute("href")!, window.location.href);
      if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search && url.hash) open(url.hash);
    };
    open();
    window.addEventListener("hashchange", changed);
    document.addEventListener("click", clicked, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", changed);
      document.removeEventListener("click", clicked, true);
    };
  }, []);
  return null;
}

export function DisclosureSection({ id, title, aside, children }: {
  id: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  empty?: boolean;
}) {
  return (
    <details id={id} className="disclosure-section mb-4 scroll-mt-20 rounded-xl border border-line-strong bg-surface p-4 shadow-card sm:p-5">
      <summary className="section-heading cursor-pointer font-display text-heading font-bold tracking-tight text-ink-strong focus-visible:outline-2 focus-visible:outline-accent">{title}</summary>
      {aside && <div className="mt-3 flex flex-wrap items-center gap-2 text-label text-ink-muted">{aside}</div>}
      <div className="mt-3">{children}</div>
    </details>
  );
}
