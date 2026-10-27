// Ask, started on one account: the agent reads it first and takes questions
// to be about it unless they say otherwise.
import { notFound } from "next/navigation";
import { requirePageUser, listUsers } from "@/lib/auth";
import { getAccount } from "@/lib/queries/accounts";
import { listThreads } from "@/lib/ask/threads";
import { focusParam, parseFocus, resolveFocus } from "@/lib/ask/focus";
import { AskAbout } from "@/components/AskAbout";
import { AskChips } from "@/components/AskChips";
import { starterQuestions } from "@/lib/ask/starters";
import { getTemplate, listTemplates, ONE_PAGER } from "@/lib/ask/templates";
import Link from "next/link";
import { Page } from "@/components/Nav";
import { AccountHeader } from "@/components/AccountHeader";
import { AskBox } from "@/components/AskBox";
import { AskThreadList } from "@/components/AskThreadList";
import { Card, Section } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AccountAskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ focus?: string; template?: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const sp = await searchParams;
  const about = resolveFocus(parseFocus(sp.focus), id);
  const template = sp.template ? getTemplate(sp.template, id) : null;
  const account = getAccount(id);
  if (!account || account.kind !== "customer") notFound();
  const names = new Map(listUsers({ includeInactive: true }).map((u) => [u.id, u.display_name]));
  return (
    <Page user={user}>
      <AccountHeader account={account} tab="ask" />
      <div className="max-w-3xl">
        <Card className="mb-6 p-4 sm:p-5">
          {about && <AskAbout about={about} />}
          <AskBox
            accountId={id}
            focus={about ? focusParam(about.focus) : undefined}
            initialQuestion={template?.question}
            templateId={template?.id}
            placeholder={about ? "Ask about this" : `Ask about ${account.name}: where it stands, who to call, what moved`}
          />
          {!about && !template && (
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-line pt-3 text-label text-ink-muted" data-testid="account-templates">
              Or write a report:
              {/* The account one-pager is written from One page, where the
                  live version already is: two entries for "this account on
                  a page" side by side was one too many. */}
              {listTemplates("account", id).filter((t) => t.id !== ONE_PAGER).map((t) => (
                <Link key={t.id} href={`/accounts/${id}/ask?template=${t.id}`} className="inline-flex min-h-8 items-center rounded-full border border-line px-3 font-medium text-ink hover:border-accent hover:text-accent">
                  {t.name}
                </Link>
              ))}
            </p>
          )}
        </Card>
        {!about && (
          <div className="-mt-3 mb-6">
            <AskChips questions={starterQuestions({ accountId: id }).slice(0, 3)} accountId={id} testId="ask-starters" />
          </div>
        )}
        <Section title="Conversations on this account">
          <AskThreadList threads={listThreads({ accountId: id })} names={names} showAccount={false} empty="Nothing asked about this account yet." />
        </Section>
      </div>
    </Page>
  );
}
