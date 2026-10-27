"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";
import { PRIMARY, isActive } from "@/lib/nav/destinations";

const LINKS = PRIMARY;

// There was no active state at all, and two of the three links pointed at the
// same URL.
export function NavLinks({ badges = {} }: { badges?: Record<string, number> } = {}) {
  const pathname = usePathname();
  // A tab bar along the bottom on a phone, where a thumb reaches and where it
  // costs the page no height at the top; a row under the header on a tablet;
  // a column in the desktop sidebar. Six equal cells at 320 is 53px each, so
  // the labels sit under the icons rather than beside them.
  return (
    <nav
      aria-label="Main"
      className="order-3 flex w-full min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-40 max-sm:flex-nowrap max-sm:justify-around max-sm:gap-0 max-sm:border-t max-sm:border-line max-sm:bg-surface max-sm:px-1 max-sm:pt-1 max-sm:pb-[max(0.25rem,env(safe-area-inset-bottom))] max-sm:shadow-raised lg:flex-col lg:flex-nowrap lg:items-stretch lg:gap-y-0.5"
    >
      {LINKS.map((l) => {
        // /accounts is the list; an account's own pages sit under it too, and
        // that is still "Accounts" in the sense of where you are.
        const active = isActive(l.href, pathname);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`group flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-label font-medium transition-[background-color,color,box-shadow] duration-150 max-sm:min-h-12 max-sm:min-w-0 max-sm:flex-1 max-sm:flex-col max-sm:justify-center max-sm:gap-0.5 max-sm:px-0.5 max-sm:text-[0.6875rem] max-sm:leading-tight sm:px-2 lg:px-2.5 lg:py-2 ${
              active ? "bg-accent-soft text-accent lg:bg-surface lg:text-ink-strong lg:shadow-raised" : "text-ink-muted hover:bg-surface-sunk hover:text-ink"
            }`}
          >
            <Icon name={l.icon} className={`nav-icon size-[1.05rem] ${active ? "text-accent" : "text-ink-faint group-hover:text-ink-muted"}`} />
            <span className="inline-flex items-center gap-1.5">
              {l.label}
              {(badges[l.href] ?? 0) > 0 && (
                <span className="rounded-full bg-accent px-1.5 text-[0.6875rem] font-semibold leading-4 tabular-nums text-white max-sm:absolute max-sm:-mt-6 max-sm:ml-6" data-testid={`nav-badge${l.href.replace(/\//g, "-")}`}>
                  {badges[l.href]! > 99 ? "99+" : badges[l.href]}
                </span>
              )}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
