// Ask: a question about anything on file, answered from the records with
import { teamPhrase } from "@/lib/team/members";
// numbered sources (lib/ask/run.ts, DECISIONS #52).
import Link from "next/link";
import { requirePageUser, listUsers } from "@/lib/auth";
import { listThreads } from "@/lib/ask/threads";
import { focusParam, parseFocus, resolveFocus } from "@/lib/ask/focus";
import { AskAbout } from "@/components/AskAbout";
import { AskChips } from "@/components/AskChips";
import { starterQuestions } from "@/lib/ask/starters";
import { getTemplate } from "@/lib/ask/templates";
import { Page } from "@/components/Nav";
import { AskBox } from "@/components/AskBox";
import { AskThreadList } from "@/components/AskThreadList";
import { Card, PageHeader, Section } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AskPage({ searchParams }: { searchParams: Promise<{ q?: string; focus?: string; template?: string }> }) {
  const user = await requirePageUser();
  const { q, focus, template: templateId } = await searchParams;
  const template = templateId ? getTemplate(templateId) : null;
  const about = resolveFocus(parseFocus(focus));
  const names = new Map(listUsers({ includeInactive: true }).map((u) => [u.id, u.display_name]));
  return (
    <Page user={user} main="max-w-3xl">
      <PageHeader
        title="Ask"
        sub={`Anything about your accounts, pipeline, people, meetings and research — answered from what is on file, with sources. Conversations you keep are shared by ${teamPhrase(listUsers().length).all}.`}
      />
      <Card className="mb-6 p-4 sm:p-5">
        {about && <AskAbout about={about} />}
        <AskBox
          initialQuestion={template?.scope === "all" ? template.question : q?.trim() ? q.trim().slice(0, 4000) : undefined}
          templateId={template?.scope === "all" ? template.id : undefined}
          focus={about ? focusParam(about.focus) : undefined}
          placeholder={about ? "Ask about this" : "Which deals slipped this quarter, and why?"}
        />
      </Card>
      {!about && (
        <div className="-mt-3 mb-6">
          <AskChips questions={starterQuestions()} testId="ask-starters" />
        </div>
      )}
      <Section title="Conversations">
        <AskThreadList threads={listThreads()} names={names} empty="Nothing asked yet. Kept conversations are listed here for both of you." />
      </Section>
      <p className="text-label text-ink-muted">
        How Ask is doing, and the answers either of you marked wrong:{" "}
        <Link href="/ask/feedback" className="font-semibold text-accent hover:underline" data-testid="ask-health-link">
          see how it is doing
        </Link>
        .
      </p>
    </Page>
  );
}
