// A handoff, read by somebody who has no login.
//
// The only page in this app that is not behind requirePageUser, which is why
// everything about it is narrow:
//
//  - the token is the whole address, so there is nothing to enumerate and no
//    account id in the URL;
//  - it renders the stored snapshot and runs no query against the account, so
//    there is nothing here to widen into;
//  - every way of not finding it — wrong token, revoked, expired, archived —
//    is the same 404, because distinguishing them tells a stranger that a
//    token was once real;
//  - there is no navigation and no link into the app;
//  - and when the sender set a passphrase, the box is the whole page: the
//    snapshot is not built at all until the word is right, so holding the
//    address alone reveals nothing about the account.
//
// Search engines are kept off it by the robots export below and by the
// X-Robots-Tag header next.config.ts sets for this path, and caches by
// Cache-Control: no-store — a customer's pipeline is not something to leave in
// an intermediary's copy, or in a back-forward cache after the link is
// revoked.
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import { parseHandoff, sharedByToken } from "@/lib/handoff/store";
import { parseReport } from "@/lib/ask/report";
import { ReportView } from "@/components/ReportView";
import { needsPassphrase, proofMatches, unlockCookieName } from "@/lib/handoff/share";
import { UnlockForm } from "./UnlockForm";
import { HandoffView } from "@/components/HandoffView";
import { fmtDay } from "@/lib/format";
import { dayOf } from "@/lib/clock";

export const dynamic = "force-dynamic";

// Deliberately says nothing: a tab title or a link preview carrying the
// customer's name is the one place this could leak without the page being
// opened at all.
export const metadata: Metadata = {
  title: "Shared from Strategy",
  robots: { index: false, follow: false, nocache: true },
};

export default async function SharedHandoffPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const doc = sharedByToken(decodeURIComponent(token));
  if (!doc) notFound();

  // Locked, and nothing of the snapshot is built before this returns — not the
  // account name, not the ask, not a tab title. The box is the whole page.
  if (needsPassphrase(doc)) {
    const proof = (await cookies()).get(unlockCookieName(doc))?.value;
    if (!proofMatches(doc, proof)) return <UnlockForm token={token} />;
  }

  // A report Ask wrote, or a handoff: both stored snapshots, read the same way.
  const asReport = parseReport(doc);
  if (asReport) {
    return (
      <div data-print="document">
        <main className="mx-auto max-w-3xl px-4 py-8 text-body">
          <ReportView report={asReport.report} />
          <footer className="mt-8 border-t border-line pt-3 text-micro text-ink-muted" data-print-hide>
            <p>A report as written on {fmtDay(asReport.report.generatedAt.slice(0, 10))}. It does not change as the records do.</p>
            <p className="mt-1">
              This link stops working on {fmtDay(dayOf(doc.share_expires_at ?? 0))}, and whoever sent it can end it sooner. Print or Save as PDF from your
              browser to keep a copy.
            </p>
          </footer>
        </main>
      </div>
    );
  }
  const found = parseHandoff(doc);
  if (!found) notFound();
  const { report } = found;

  return (
    <div data-print="document">
      <main className="mx-auto max-w-4xl px-4 py-8 text-body">
        <HandoffView report={report} />
        <footer className="mt-8 border-t border-line pt-3 text-micro text-ink-muted" data-print-hide>
          <p>
            A snapshot of this account as it stood on {fmtDay(report.generated_at)}, prepared by {report.generated_by}. It does not change as the
            account does.
          </p>
          <p className="mt-1">
            This link stops working on {fmtDay(dayOf(doc.share_expires_at ?? 0))}, and whoever sent it can end it sooner.
            Print or Save as PDF from your browser to keep a copy.
          </p>
        </footer>
      </main>
    </div>
  );
}
