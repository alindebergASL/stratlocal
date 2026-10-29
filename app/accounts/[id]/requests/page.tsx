import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { getAccount } from "@/lib/queries/accounts";
import { AccountHeader } from "@/components/AccountHeader";
import { Page } from "@/components/Nav";
import { RequestHistory } from "@/components/local/RequestHistory";

export default async function Route({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const user = await requirePageUser();
  const { id } = await params;
  const account = getAccount(id);
  if (!account) notFound();
  const query = await searchParams;
  const page = typeof query.page === "string" ? Number(query.page) : 1;
  return <Page user={user}>
    <AccountHeader account={account} tab="evidence" />
    <RequestHistory accountId={id} userId={user.id} page={page} />
    <Link className="underline block mt-4" href={`/accounts/${id}/evidence`}>Return to evidence & MyAgent</Link>
  </Page>;
}
