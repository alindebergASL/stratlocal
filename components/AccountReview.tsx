import Link from "next/link";
import { listUsers } from "@/lib/auth";
import type { AccountRow } from "@/lib/db";
import { listPendingProposals, otherSideNames } from "@/lib/queries/accounts";
import { groupByBatch, toProposalViews } from "@/lib/proposals/view";
import { ChangeDeck } from "./ChangeDeck";
import { ProposalReview } from "./ProposalReview";
import { ReviewSwitch } from "./ReviewSwitch";
import { Empty, Section } from "./ui";

// Everything waiting on one account, one change at a time, with the whole
// list one press away (DECISIONS #105). The list keeps its grouping by batch,
// because "accept all" there means one batch: an import, a drafted plan or a
// meeting's notes, never all of them at once. Lives in the Inbox.
export function AccountReview({ account, me }: { account: AccountRow; me: string }) {
  const id = account.id;
  const pending = listPendingProposals(id);
  const batches = groupByBatch(pending);
  const owners = listUsers().map((u) => ({ id: u.id, name: u.display_name }));
  const customers = otherSideNames(id).get(id) ?? [];
  if (pending.length === 0) {
    return (
      <Section title="Clear">
        <Empty>
          Nothing to review.{" "}
          <Link href={`/accounts/${id}`} className="text-accent hover:underline">
            Back to {account.name}.
          </Link>
        </Empty>
      </Section>
    );
  }
  return (
    <ReviewSwitch
      deck={
        <ChangeDeck
          key={pending.map((p) => p.id).join(",")}
          proposals={toProposalViews(id, pending)}
          owners={owners}
          customers={customers}
          me={me}
          accountName={account.name}
          done={{ href: `/accounts/${id}`, label: `Back to ${account.name}` }}
        />
      }
      list={batches.map((b) => (
        <Section key={b.batchId} title={b.label} aside={<span>{b.rows.length} change{b.rows.length === 1 ? "" : "s"}</span>}>
          <ProposalReview accountId={id} proposals={toProposalViews(id, b.rows)} batchId={b.batchId} refresh={false} />
        </Section>
      ))}
    />
  );
}

/** Where an account's changes are reviewed. */
export function reviewHref(accountId: string): string {
  return `/inbox?kind=changes&account=${encodeURIComponent(accountId)}`;
}
