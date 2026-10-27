"use client";

// Accounts filter locally; the fallback keeps the existing full-search route.
import { usePathname, useRouter } from "next/navigation";
import { focusForPath, focusParam } from "@/lib/ask/focusPath";
import { ALL_DESTINATIONS } from "@/lib/nav/destinations";
import { commandsFor } from "@/lib/commands/registry";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type PaletteAccount = { id: string; name: string; region: string | null };
type Item = { id: string; label: string; detail: string | null; href: string };
// Every destination, from the one list the navigation reads too.
const PAGES: Item[] = ALL_DESTINATIONS.map((d) => ({ id: `page${d.href.replace(/\//g, "-") || "-today"}`, label: d.label, detail: d.detail + (d.keywords ? ` · ${d.keywords}` : ""), href: d.href }));

// Typed text that reads as a question rather than a name to look up.
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (t.endsWith("?")) return true;
  if (/^(what|who|whom|which|when|where|why|how|is|are|was|were|did|does|do|should|can|could|will|would|has|have|list|show|summari[sz]e|compare|tell|give|find|rank)\b/i.test(t)) return t.split(/\s+/).length >= 3;
  return t.split(/\s+/).length >= 5;
}

export function CommandPalette({ accounts }: { accounts: PaletteAccount[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const invokerRef = useRef<HTMLElement | null>(null);
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const items = useMemo(() => {
    const all: Item[] = [
      ...accounts.map((a) => ({ id: a.id, label: a.name, detail: a.region, href: `/accounts/${a.id}` })),
      ...commandsFor(pathname),
      ...PAGES,
    ];
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    const matched = all.filter((i) => i.label.toLowerCase().includes(needle) || (i.detail ?? "").toLowerCase().includes(needle));
    // From a page, the question is about that page, or the record it shows;
    // the focus is read from the address when the item is chosen.
    const here = focusForPath(pathname);
    const ask: Item = {
      id: "ask",
      label: `Ask: “${q.trim()}”`,
      detail: here ? (here.kind === "page" ? "About this page, answered from what is on file" : "About this record, answered from what is on file") : "Answered from what is on file, with sources",
      href: `/ask?q=${encodeURIComponent(q.trim())}`,
    };
    const search: Item = { id: "search", label: `Search everything for “${q.trim()}”`, detail: null, href: `/search?q=${encodeURIComponent(q.trim())}` };
    // A question is asked first; a name is looked up first, and asked only
    // when nothing matches it.
    if (looksLikeQuestion(q)) return [ask, ...matched, search];
    return matched.length > 0 ? matched : [search, ask];
  }, [accounts, q, pathname]);

  const restoreFocus = useCallback(() => {
    // close() restores immediately; the native close event arrives later.
    // It must neither steal subsequent focus nor reset a reopened palette.
    if (dialogRef.current?.open) return;
    setOpen(false);
    const invoker = invokerRef.current;
    invokerRef.current = null;
    if (invoker) (invoker.isConnected ? invoker : triggerRef.current)?.focus({ preventScroll: true });
  }, []);
  const close = useCallback(() => {
    dialogRef.current?.close();
    restoreFocus();
  }, [restoreFocus]);
  const show = useCallback((invoker?: HTMLElement) => {
    const focused = document.activeElement;
    invokerRef.current = invoker ?? (focused instanceof HTMLElement && focused !== document.body ? focused : triggerRef.current);
    setQ("");
    setActive(0);
    dialogRef.current?.showModal();
    setOpen(true);
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (dialogRef.current?.open) close();
        else show();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, show]);

  useEffect(() => {
    if (open) resultRefs.current[active]?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [active, items, open]);

  const go = useCallback((item: Item | undefined) => {
    if (!item) return;
    close();
    if (item.id === "ask") {
      const here = focusForPath(`${window.location.pathname}${window.location.search}`);
      router.push(here ? `${item.href}&focus=${encodeURIComponent(focusParam(here))}` : item.href);
      return;
    }
    router.push(item.href);
  }, [router, close]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => show(e.currentTarget)}
        className="inline-flex items-center gap-2 rounded-md border border-control-line bg-surface px-2.5 py-1.5 text-label lg:w-full text-ink-muted transition-colors hover:border-accent hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        aria-label="Search accounts, deals and people"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <svg aria-hidden viewBox="0 0 20 20" className="size-4 shrink-0 fill-none stroke-current stroke-2">
          <circle cx="9" cy="9" r="6" />
          <path d="m14 14 3.5 3.5" strokeLinecap="round" />
        </svg>
        <span className="hidden sm:inline">Jump to…</span>
        <kbd className="hidden rounded border border-line px-1 font-sans text-micro text-ink-faint md:inline lg:ml-auto">⌘K</kbd>
      </button>
      <dialog
        ref={dialogRef}
        aria-label="Jump to"
        className="command-palette overflow-hidden rounded-xl border border-line bg-surface text-ink shadow-pop"
        onCancel={(e) => { e.preventDefault(); close(); }}
        onClose={restoreFocus}
        onClick={(e) => {
          // Backdrop events target the dialog; padding/scrollbar clicks do not close it.
          const box = e.currentTarget.getBoundingClientRect();
          if (e.target === e.currentTarget && (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom)) close();
        }}
        onKeyDown={(e) => {
          // Native modality makes the page inert. Wrap endpoints explicitly so
          // Tab never hands focus to browser chrome before returning here.
          if (e.key !== "Tab") return;
          const controls = e.currentTarget.querySelectorAll<HTMLElement>('input, button:not([tabindex="-1"])');
          const first = controls[0], last = controls[controls.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }}
      >
        <div className="flex shrink-0 items-center border-b border-line">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, items.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
              if (e.key === "Enter") { e.preventDefault(); go(items[active]); }
            }}
            placeholder="An account, a page, or a question"
            aria-label="Jump to"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls="palette-results"
            aria-activedescendant={open ? `palette-result-${active}` : undefined}
            className="min-w-0 flex-1 px-4 py-3 text-lead text-ink placeholder:text-ink-faint"
          />
          <button type="button" onClick={close} className="mr-2 rounded px-2 py-2 text-label text-ink-muted" aria-label="Close jump to">Close</button>
        </div>
        <ul id="palette-results" role="listbox" aria-label="Destinations" className="min-h-0 max-h-80 overflow-y-auto overscroll-contain py-1">
          {items.map((item, i) => (
            <li key={item.id} role="option" id={`palette-result-${i}`} aria-selected={i === active}>
              <button
                ref={(node) => { resultRefs.current[i] = node; }}
                type="button"
                tabIndex={-1}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(item)}
                className={`flex w-full items-baseline justify-between gap-3 px-4 py-2 text-left ${i === active ? "bg-accent-soft" : ""}`}
              >
                <span className={`min-w-0 break-words font-medium ${i === active ? "text-accent" : "text-ink"}`}>{item.label}</span>
                {item.detail && <span className="max-w-[40%] text-micro text-ink-muted">{item.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      </dialog>
    </>
  );
}
