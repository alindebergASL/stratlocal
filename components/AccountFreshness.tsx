"use client";

// "This account was updated."
//
// Two people work the same account at the same time, and until now the only
// way to find out that the other one had saved something was to save on top
// of it and read the refusal. This watches, quietly, and says so — and then
// stops, because the one thing it must never do is decide on its own to throw
// away what is on screen. Refreshing is a person's decision, taken by pressing
// a button, and the forms that would lose something to it say so instead of
// losing it.
//
// It never says who. A second tab of your own is the commonest cause of this
// notice, and "Jamie changed something" when Jamie changed nothing is worse
// than saying less.
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isNewerRevision, parseRevision, supportsFreshness } from "@/lib/freshness";
import { Button } from "./ui";

type Freshness = {
  /** The server data on screen is behind a change we have been told about. */
  stale: boolean;
  refreshing: boolean;
  /** A refresh came back and the server data still did not include it. */
  failed: boolean;
  /** Open work that a refresh would destroy, keyed so it can be withdrawn. */
  holds: Record<string, string>;
  refresh: () => void;
  /** Bumped when an explicit refresh lands server data that acknowledges it. */
  adoptions: number;
  hold: (key: string, reason: string | null) => void;
  /** A page render reporting the cursor it was read at. */
  baseline: (revision: string) => void;
};

const FreshnessContext = createContext<Freshness | null>(null);

// How often a visible page asks. Low enough to be nearly free — one integer
// query and a ~40 byte answer — and slow enough that nobody is polling their
// own database for a living.
const POLL_MS = 25_000;

export function AccountFreshnessProvider({
  accountId,
  revision,
  children,
}: {
  accountId: string;
  /** The account's cursor as this render of the server data read it. */
  revision: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const supported = supportsFreshness(usePathname(), accountId);
  // The furthest point we have been told the account has reached. Held with
  // the account it belongs to so a reply that arrives after a navigation
  // cannot be mistaken for news about the account now on screen.
  const [seen, setSeen] = useState<string | null>(null);
  // The cursor the newest page render under this layout was read at. The
  // layout's own `revision` is rendered once and then kept across client
  // navigations beneath it — a walk from the overview to a meeting renders
  // the meeting from the server and leaves this prop where it was, so a
  // change made in between showed as a notice over data that already
  // included it. Each supported page reports its own cursor; the later of
  // the two is the point the screen is actually at.
  const [pageRevision, setPageRevision] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [adoptions, setAdoptions] = useState(0);
  const [holds, setHolds] = useState<Record<string, string>>({});
  const [refreshing, startRefresh] = useTransition();
  // What the last explicit refresh was asked to catch up to. A change that
  // arrives *during* the refresh must not make the refresh look failed.
  const target = useRef<string | null>(null);

  // Moving to another account is a different history and a different cursor.
  // Updating state during render on a changed prop is the documented way to
  // reset for a new subject under a component that stays mounted.
  const [scope, setScope] = useState(accountId);
  if (scope !== accountId) {
    setScope(accountId);
    setSeen(null);
    setPageRevision(null);
    setFailed(false);
    target.current = null;
  }

  const base = pageRevision !== null && isNewerRevision(pageRevision, revision) ? pageRevision : revision;
  const stale = supported && isNewerRevision(seen, base);

  useEffect(() => {
    if (!supported) return;
    let done = false;
    let inFlight = false;
    const controller = new AbortController();

    async function check() {
      // One at a time: a slow answer must not become a queue of them, and an
      // overlapped pair can land out of order.
      if (done || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const r = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/freshness`, {
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        });
        // A poll that did not succeed knows nothing. Not that the page is
        // current, not that a notice already shown was wrong — 401 after a
        // session expires and 500 from a restart both mean "ask again later".
        if (!r.ok) return;
        const body: unknown = await r.json();
        const next = (body as { revision?: unknown } | null)?.revision;
        if (done || typeof next !== "string" || !parseRevision(next)) return;
        // Monotonic, so a reply that overtook a newer one cannot walk the
        // cursor backwards and silently retire a notice.
        setSeen((prev) => (prev !== null && !isNewerRevision(next, prev) ? prev : next));
      } catch {
        // Offline, aborted, or an answer that was not JSON. Same rule.
      } finally {
        inFlight = false;
      }
    }

    const wake = () => {
      if (document.visibilityState === "visible") void check();
    };
    void check();
    const timer = setInterval(() => void check(), POLL_MS);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      done = true;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [accountId, supported]);

  // A refresh is over when the transition commits, and by then this component
  // is rendering the server's new answer. Whether it worked is that answer's
  // to say: if the data still does not include what we were told about, the
  // notice stays and says the refresh did not pick it up.
  const settling = useRef(false);
  useEffect(() => {
    if (refreshing) {
      settling.current = true;
      return;
    }
    if (!settling.current) return;
    settling.current = false;
    const asked = target.current;
    target.current = null;
    if (asked !== null && isNewerRevision(asked, base)) setFailed(true);
    else setAdoptions((n) => n + 1);
  }, [refreshing, base]);

  const hold = useCallback((key: string, reason: string | null) => {
    setHolds((prev) => {
      if (reason === null) {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      if (prev[key] === reason) return prev;
      return { ...prev, [key]: reason };
    });
  }, []);

  const baseline = useCallback((next: string) => {
    if (!parseRevision(next)) return;
    // Monotonic for the same reason `seen` is: a page render that lands
    // behind a newer one must not walk the baseline back.
    setPageRevision((prev) => (prev !== null && !isNewerRevision(next, prev) ? prev : next));
  }, []);

  const refresh = useCallback(() => {
    if (!supported || Object.keys(holds).length > 0) return;
    target.current = seen;
    setFailed(false);
    startRefresh(() => router.refresh());
  }, [holds, router, seen, supported]);

  return (
    <FreshnessContext.Provider value={{ stale, refreshing, failed, holds, refresh, adoptions, hold, baseline }}>
      {children}
    </FreshnessContext.Provider>
  );
}

// The slot, rendered by every page's frame. Outside an account it has no
// provider above it and is nothing at all.
export function FreshnessNotice() {
  const freshness = useContext(FreshnessContext);
  if (!freshness || !freshness.stale) return null;
  const reasons = Object.values(freshness.holds);
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="freshness-notice"
      className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-line bg-surface-sunk px-3.5 py-2.5 text-label text-ink-muted print:hidden"
    >
      <span className="min-w-0">
        This account was updated. What is on screen was read before that.
        {freshness.failed && (
          <span className="ml-1.5 font-medium text-ink" data-testid="freshness-failed">
            The refresh did not come back with it. Nothing was lost — try again.
          </span>
        )}
      </span>
      {reasons.length > 0 ? (
        <span className="min-w-0 text-ink" data-testid="freshness-deferred">
          {reasons[0]} Finish or cancel it, then refresh.
        </span>
      ) : (
        <Button variant="quiet" size="sm" onClick={freshness.refresh} disabled={freshness.refreshing} aria-busy={freshness.refreshing} data-testid="freshness-refresh">
          {freshness.refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      )}
    </div>
  );
}

// Open work that an RSC refresh would take away rather than update: an inline
// editor whose row the other person may have just archived, for instance. The
// honest answer is to defer the refresh and say why, not to refresh and drop
// what someone typed.
export function useRefreshHold(key: string, reason: string | null) {
  const hold = useContext(FreshnessContext)?.hold;
  const instance = useId();
  const holdKey = `${instance}:${key}`;
  useEffect(() => {
    if (!hold) return;
    hold(holdKey, reason);
    return () => hold(holdKey, null);
  }, [hold, holdKey, reason]);
}

// Counts explicit refreshes that genuinely landed newer server data. A form
// holding nothing of its own can take that data; one holding a draft cannot.
export function useFreshnessAdoptions(): number {
  return useContext(FreshnessContext)?.adoptions ?? 0;
}

// Rendered by each page the notice is scoped to, with the cursor that page's
// server render read. Renders nothing; it only tells the provider where the
// screen now is, so a client navigation does not inherit the layout's older
// idea of it.
export function FreshnessBaseline({ revision }: { revision: string }) {
  const freshness = useContext(FreshnessContext);
  const baseline = freshness?.baseline;
  useEffect(() => {
    baseline?.(revision);
  }, [baseline, revision]);
  return null;
}
