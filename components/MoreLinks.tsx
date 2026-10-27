"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { MORE_GROUPS, isActive } from "@/lib/nav/destinations";

const linkClass = "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-label text-ink-muted transition-colors hover:bg-surface-sunk hover:text-ink";

// Everything that is not one of the five daily places, in one grouped menu:
// beside the search box on a phone and a tablet, at the foot of the column
// on a desktop. It used to be ten links listed permanently down the sidebar.
export function MoreMenu({ placement = "top" }: { placement?: "top" | "column" }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const here = MORE_GROUPS.flatMap((g) => g.items).find((d) => isActive(d.href, pathname));
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const column = placement === "column";
  return (
    <div ref={box} className={column ? "relative order-4 hidden lg:mt-auto lg:block" : "relative lg:hidden"}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={column ? "nav-more-column" : "nav-more"}
        onClick={() => setOpen((o) => !o)}
        className={
          column
            ? `${linkClass} w-full ${here ? "bg-surface font-medium text-ink-strong shadow-raised" : ""}`
            : "rounded-md px-2 py-1 text-label text-ink-muted transition-colors hover:bg-surface-sunk hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        }
        data-testid={column ? "nav-more-column" : "nav-more"}
      >
        {column && <Icon name="stack" className="size-4" />}
        {column && here ? here.label : "More"}
      </button>
      {open && (
        <div
          id={column ? "nav-more-column" : "nav-more"}
          className={`absolute z-50 w-60 rounded-xl border border-line bg-surface p-1.5 shadow-raised ${column ? "bottom-full left-0 mb-1" : "right-0 top-full mt-1"}`}
        >
          {MORE_GROUPS.map((g) => (
            <div key={g.title} className="py-1 first:pt-0">
              <p className="px-2.5 pb-0.5 text-micro font-semibold uppercase tracking-[0.06em] text-ink-faint">{g.title}</p>
              {g.items.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  aria-current={isActive(l.href, pathname) ? "page" : undefined}
                  className={`${linkClass} ${isActive(l.href, pathname) ? "bg-accent-soft text-accent" : ""}`}
                  data-testid={`nav${l.href.replace(/\//g, "-")}`}
                >
                  <Icon name={l.icon} className="size-4" />
                  {l.label}
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
