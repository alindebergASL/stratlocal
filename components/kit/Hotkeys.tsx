"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ALL_DESTINATIONS } from "@/lib/nav/destinations";

// Keys for the whole app: g then a letter jumps to a place, ? lists them.
// Nothing fires while you are typing in a field, and modifier combinations
// are left to the browser and the command palette (⌘K).
const JUMPS = ALL_DESTINATIONS.filter((d) => d.key).map((d) => ({ key: d.key!, href: d.href, label: d.label }));

export function typingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function Hotkeys() {
  const router = useRouter();
  const [help, setHelp] = useState(false);
  const pendingG = useRef<number | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typingIn(e.target)) return;
      if (e.key === "Escape") {
        setHelp(false);
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setHelp((h) => !h);
        return;
      }
      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        const jump = JUMPS.find((j) => j.key === e.key.toLowerCase());
        if (jump) {
          // Caught first, so a page's own single-letter keys do not also fire.
          e.preventDefault();
          e.stopImmediatePropagation();
          setHelp(false);
          router.push(jump.href);
        }
        return;
      }
      if (e.key === "g") pendingG.current = window.setTimeout(() => (pendingG.current = null), 1200);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [router]);
  if (!help) return null;
  return (
    <div role="dialog" aria-label="Keyboard shortcuts" data-testid="hotkeys-help" className="fixed inset-0 z-[70] grid place-items-center bg-ink/30 p-4" onClick={() => setHelp(false)}>
      <div className="w-full max-w-sm rounded-2xl bg-surface p-5 shadow-raised" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-heading font-bold text-ink-strong">Keyboard</h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-label">
          <dt><Kbd>⌘ K</Kbd></dt>
          <dd className="text-ink">Go anywhere, or ask</dd>
          {JUMPS.map((j) => (
            <Row key={j.key} keys={`g ${j.key}`} label={j.label} />
          ))}
          <Row keys="?" label="This list" />
        </dl>
      </div>
    </div>
  );
}

function Row({ keys, label }: { keys: string; label: string }) {
  return (
    <>
      <dt><Kbd>{keys}</Kbd></dt>
      <dd className="text-ink">{label}</dd>
    </>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-line bg-surface-sunk px-1.5 py-0.5 font-sans text-micro font-semibold text-ink-muted">{children}</kbd>;
}
