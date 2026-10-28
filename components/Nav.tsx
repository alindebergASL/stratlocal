import { localOnly } from "@/lib/localMode";
import Link from "next/link";
import type { PublicUser } from "@/lib/auth";
import { listAccountChoices } from "@/lib/queries/accounts";
import { CommandPalette } from "./CommandPalette";
import { FreshnessNotice } from "./AccountFreshness";
import { NavLinks } from "./NavLinks";
import { MoreMenu } from "./MoreLinks";
import { branding } from "@/lib/team/branding";
import { Suspense } from "react";
import { NavTrail } from "./NavTrail";
import { inboxCount } from "@/lib/inbox/query";

// One element, two shapes. On a phone and a tablet it is the bar across the
// top it always was: brand and utilities first, all navigation on a second
// row. From `lg` it becomes a quiet column down the left, so the page beside
// it gets the whole width and the navigation stops competing with the work.
//
// It is one element rather than a sidebar and a header because the command
// palette listens for ⌘K on the window: two copies would both open.
export function Nav({ user }: { user: PublicUser }) {
  if (localOnly()) return <header className="border-b border-line p-4 lg:w-52 lg:shrink-0 lg:border-r"><Link href="/accounts" className="font-display text-lead font-bold">StrategyLocal</Link><nav aria-label="Main navigation" className="mt-4 flex flex-wrap gap-4 lg:flex-col">{[["Accounts","/accounts"],["Territory","/territory"],["Meetings","/meetings"],["Imports & tasks","/imports"],["Review changes","/inbox?kind=changes"],["Settings","/settings/local"]].map(([label,href])=><Link key={href} href={href!}>{label}</Link>)}</nav><form action="/api/auth/logout" method="post" className="mt-6"><button>Sign out</button></form></header>;
  const accounts = listAccountChoices();
  const brand = branding();
  return (
    <header className="top-0 z-40 border-b border-line bg-surface sm:sticky sm:bg-surface/85 sm:backdrop-blur lg:h-dvh lg:w-60 lg:shrink-0 lg:border-r lg:border-b-0 lg:bg-paper lg:backdrop-blur-none">
      <Suspense fallback={null}>
        <NavTrail />
      </Suspense>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 sm:py-2.5 lg:h-full lg:flex-col lg:flex-nowrap lg:items-stretch lg:gap-y-5 lg:px-3 lg:py-5">
        <Link href="/" className="order-1 flex items-center gap-2.5 font-display text-lead font-extrabold tracking-tight text-ink-strong lg:px-1.5">
          {brand.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logo} alt="" className="size-7 rounded-lg object-contain" data-testid="brand-logo" />
          ) : (
            <span aria-hidden className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-accent to-accent-hover font-display text-label font-extrabold text-white shadow-raised">{brand.appName[0]!.toUpperCase()}</span>
          )}
          <span data-testid="brand-name">{brand.appName}</span>
        </Link>
        <div className="order-2 ml-auto flex min-w-0 items-center lg:ml-0 lg:block">
          <CommandPalette accounts={accounts} />
          <MoreMenu />
        </div>
        <NavLinks badges={{ "/inbox": inboxCount(user.id) }} />
        <MoreMenu placement="column" />
        <form action="/api/auth/logout" method="post" className="order-2 flex min-w-0 items-center gap-2 lg:order-4 lg:justify-between lg:border-t lg:border-line lg:px-2.5 lg:pt-4">
          <span className="hidden min-w-0 items-center gap-2 sm:flex">
            <span aria-hidden className="hidden size-7 shrink-0 place-items-center rounded-full bg-ink text-micro font-semibold text-ink-invert lg:grid">{((user.display_name ?? "").trim()[0] ?? "?").toUpperCase()}</span>
            <span className="max-w-32 truncate text-label text-ink-muted lg:font-medium lg:text-ink">{user.display_name}</span>
          </span>
          <button
            type="submit"
            className="rounded-md px-2 py-1 text-label text-ink-muted transition-colors hover:bg-surface-sunk hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}

// `main` is for the few pages that read better narrower than the default,
// such as the printable summaries.
export function Page({ user, children, main = "max-w-6xl" }: { user: PublicUser; children: React.ReactNode; main?: string }) {
  return (
    <div className="lg:flex">
      <Nav user={user} />
      <main className={`mx-auto w-full min-w-0 px-4 py-6 max-sm:pb-24 lg:px-10 lg:py-10 ${main}`}>
        {/* Nothing at all off an account page, and nothing on one until the
            account has actually been written to by someone else. */}
        <FreshnessNotice />
        {children}
      </main>
    </div>
  );
}
