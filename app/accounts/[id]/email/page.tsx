import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { getAccount } from "@/lib/queries/accounts";
import { accountMail } from "@/lib/mail/sync";
import { fmtWhen } from "@/lib/format";
import { Page } from "@/components/Nav";
import { AccountHeader } from "@/components/AccountHeader";
import { Empty, Section } from "@/components/ui";

export const dynamic = "force-dynamic";

// The email the Mail reader kept for this account (DECISIONS #102): who, what
// about and when. Bodies are deleted after 30 days; what was agreed in them is
// in the account's changes to review, quoted.
export default async function AccountEmailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const account = getAccount(id);
  if (!account) notFound();
  const mail = accountMail(id);
  return (
    <Page user={user}>
      <AccountHeader account={account} tab="email" />
      <Section title="Email" aside={<span>{mail.length}</span>}>
        {mail.length === 0 ? (
          <Empty>No email kept for this account. Each of you can connect your mailbox under Settings → Connections.</Empty>
        ) : (
          <ul className="divide-y divide-line" data-testid="account-mail">
            {mail.map((m) => (
              <li key={m.id} id={`mail-${m.id}`} className="scroll-mt-20 py-2.5 text-label">
                <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="min-w-0 font-semibold text-ink [overflow-wrap:anywhere]">{m.subject}</span>
                  <span className="text-micro text-ink-muted">{fmtWhen(m.received_at)}</span>
                </p>
                <p className="text-micro text-ink-muted">
                  From {m.from_name ? `${m.from_name} <${m.from_addr}>` : m.from_addr}
                  {m.body_text === null ? " · body deleted after 30 days" : ""}
                </p>
                {m.body_text && <p className="mt-1 line-clamp-2 whitespace-pre-line text-ink-muted [overflow-wrap:anywhere]">{m.body_text.slice(0, 400)}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Page>
  );
}
