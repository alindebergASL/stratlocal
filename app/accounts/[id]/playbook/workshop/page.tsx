import Link from "next/link";
import { notFound } from "next/navigation";
import { listTeam, requirePageUser } from "@/lib/auth";
import { getAccount, listContacts } from "@/lib/queries/accounts";
import { currentPlaybook } from "@/lib/playbook/store";
import { getWorkshop } from "@/lib/playbook/workshop";
import { Page } from "@/components/Nav";
import { PlaybookNav } from "../PlaybookNav";
import { AccountHeader } from "@/components/AccountHeader";
import { Empty, Section } from "@/components/ui";
import { WorkshopEditor } from "./WorkshopEditor";
import { addToRoadmapAction, saveWorkshopAction } from "./actions";

export const dynamic = "force-dynamic";

// The working session with the line of business: the playbook's agenda,
// who is invited, and the use cases scored and placed as they come up.
export default async function WorkshopPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const account = getAccount(id);
  if (!account) notFound();
  const playbook = currentPlaybook({ accountId: id })?.playbook ?? null;
  const { workshop, updatedAt } = getWorkshop(id);
  const team = listTeam().filter((m) => m.active);
  const roles = new Map(
    (playbook?.roles ?? []).map((r) => {
      const who = team.filter((m) => m.role === r.id).map((m) => m.display_name);
      return [r.id, who.length ? `${r.name} (${who.join(", ")})` : r.name];
    }),
  );
  return (
    <Page user={user}>
      <AccountHeader account={account} tab="plan" />
      <PlaybookNav accountId={id} current="workshop" />
      <Section title="Workshop" aside={<Link href={`/accounts/${id}/playbook/roadmap`} className="font-semibold text-accent hover:underline">Roadmap and action plan →</Link>}>
        {!playbook ? (
          <Empty>
            No playbook yet. <Link href="/settings/playbook" className="font-semibold text-accent hover:underline">Set one up</Link> and its workshop agenda and placement rubric are used here.
          </Empty>
        ) : (
          <WorkshopEditor
            accountId={id}
            initial={workshop}
            basis={updatedAt}
            agenda={playbook.workshop.map((s) => ({ id: s.id, name: s.name, minutes: s.minutes, focus: s.focus, lead: s.lead_role ? (roles.get(s.lead_role) ?? null) : null }))}
            rubric={playbook.placement}
            contacts={listContacts(id).filter((c) => c.org === "customer").map((c) => ({ id: c.id, name: c.name, title: c.title }))}
            save={saveWorkshopAction.bind(null, id)}
            addToRoadmap={addToRoadmapAction.bind(null, id)}
          />
        )}
      </Section>
    </Page>
  );
}
