import { currentUser } from "@/lib/auth";
import { getAccount } from "@/lib/queries/accounts";
import { accountRevision } from "@/lib/queries/freshness";
import { AccountFreshnessProvider } from "@/components/AccountFreshness";

export const dynamic = "force-dynamic";

// One wrapper for every page of an account — the account itself, a deal, a
// meeting, research — rather than a line of wiring in twenty routes.
//
// The cursor is read here, from the same server render that produced the data
// on screen, and not from the page's first poll: a change written between the
// render and that first answer would otherwise be swallowed, and the page
// would sit there quietly out of date.
export default async function AccountLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Not the authentication boundary — every page below calls requirePageUser
  // and this layout renders alongside them, so it only declines to start
  // polling for someone who is on their way to /login. Same for an id that is
  // not an account: the page's own notFound() is the answer to that.
  const user = await currentUser();
  if (!user || !getAccount(id)) return <>{children}</>;
  return (
    <AccountFreshnessProvider accountId={id} revision={accountRevision(id)}>
      {children}
    </AccountFreshnessProvider>
  );
}
