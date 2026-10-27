// A report Ask wrote: to read, to print or save as PDF, and to share by link.
//
// The printable part is the same component a shared link renders, from the
// same stored snapshot; here its sources also link to the records as they are
// now. Everything around it is hidden when printed.
import Link from "next/link";
import { BackLink } from "@/components/BackLink";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { getReport } from "@/lib/ask/report";
import { resolveSources } from "@/lib/ask/sources";
import { reportToText } from "@/lib/ask/plainText";
import { recapMailto } from "@/lib/meetings/recap";
import { CopyAndMail } from "@/components/CopyAndMail";
import { DEFAULT_SHARE_DAYS, MIN_PASSPHRASE, SHARE_DAYS, shareState } from "@/lib/handoff/store";
import { needsPassphrase } from "@/lib/handoff/share";
import { fmtDay } from "@/lib/format";
import { dayOf } from "@/lib/clock";
import { Nav } from "@/components/Nav";
import { ReportView } from "@/components/ReportView";
import { PrintButton } from "@/components/PrintButton";
import { ActionForm } from "@/components/ActionForm";
import { Button, buttonClass, Callout, control, Field } from "@/components/ui";
import { CopyLink } from "@/app/accounts/[id]/handoff/[docId]/CopyLink";
import { archiveReportAction, endReportShareAction, saveTemplateAction, shareReportAction } from "../actions";
import { questionForReport } from "@/lib/ask/templates";
import { markReadySeen } from "@/lib/assistants/ready";

export const dynamic = "force-dynamic";

export default async function ReportPage({ params }: { params: Promise<{ docId: string }> }) {
  const user = await requirePageUser();
  const { docId } = await params;
  const found = getReport(docId);
  if (!found) notFound();
  const { doc, report } = found;
  // Opening it is reading it: an assistant's "ready" line leaves Today.
  markReadySeen(docId, user.id);
  const state = shareState(doc);
  const sources = resolveSources(report.citations);
  const asText = reportToText(report, sources);
  const mail = recapMailto([], report.title, asText);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  const url = state === "live" && doc.share_token ? `${proto}://${host}/s/${doc.share_token}` : null;

  return (
    <div data-print="document" className="lg:flex">
      <Nav user={user} />
      <main className="mx-auto w-full min-w-0 max-w-3xl px-4 py-6 text-body max-sm:pb-24 lg:py-10">
        <div data-print-hide className="mb-6 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-label">
            <span className="flex flex-wrap gap-3">
              <BackLink fallback="/reports" fallbackLabel="Reports" />
              {report.threadId && <Link href={`/ask/${report.threadId}`} className="text-accent hover:underline">The conversation</Link>}
            </span>
            {/* The rare and the risky behind one button: copying and mailing
                are a press away, deleting is not next to Save as PDF. */}
            <details className="relative" data-testid="report-more">
              <summary className="inline-flex min-h-9 cursor-pointer list-none items-center rounded-md px-2.5 text-label font-semibold text-ink-muted hover:bg-surface-sunk hover:text-ink [&::-webkit-details-marker]:hidden">More ▾</summary>
              <div className="absolute right-0 z-30 mt-1 flex w-56 flex-col items-start gap-1 rounded-lg border border-line bg-surface p-2 shadow-raised">
                <CopyAndMail text={asText} mailto={mail.href} withBody={mail.withBody} testId="report-copy" />
                <form action={archiveReportAction.bind(null, docId)} className="w-full border-t border-line pt-1">
                  <Button type="submit" variant="ghost" size="sm" className="w-full !justify-start text-danger">Delete the report</Button>
                </form>
              </div>
            </details>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <PrintButton />
            <a href={`/reports/${docId}/deck`} download className={buttonClass("quiet", "sm")} data-testid="report-deck">
              PowerPoint
            </a>
          <div className={url ? "w-full rounded-lg border border-line bg-surface p-3" : "contents"} data-testid="report-share">
            {url ? (
              <>
                <p className="mb-2 text-label text-ink-muted" data-testid="share-warning">
                  {needsPassphrase(doc)
                    ? `This link needs the passphrase you set, and stops working on ${fmtDay(dayOf(doc.share_expires_at ?? 0))}. Send the passphrase separately.`
                    : `Anyone with this link can read the report until ${fmtDay(dayOf(doc.share_expires_at ?? 0))}, with no sign-in. It shows the report as written and links nowhere into the app.`}
                </p>
                <CopyLink url={url} />
                <div className="mt-2">
                  <ActionForm action={endReportShareAction.bind(null, docId)} testId="revoke-share" trigger="End the link" submitLabel="End it now">
                    <p className="text-label text-ink-muted">The link stops working immediately, for everyone it was forwarded to. The report stays here.</p>
                  </ActionForm>
                </div>
              </>
            ) : (
              <>
                {state === "expired" && <Callout className="mb-2">The last link ran out on {fmtDay(dayOf(doc.share_expires_at ?? 0))}.</Callout>}
                <ActionForm action={shareReportAction.bind(null, docId)} testId="report-share-make" trigger="Share by link" submitLabel="Make the link">
                  <p className="text-label text-ink-muted">Someone without a login can read the report, as written, until the link runs out or you end it.</p>
                  <Field label="The link stops working after">
                    <select name="share_days" defaultValue={String(DEFAULT_SHARE_DAYS)} className={control}>
                      {SHARE_DAYS.map((d) => (
                        <option key={d} value={d}>{d} days</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Passphrase" hint="Optional. Blank for none.">
                    <input type="text" name="passphrase" autoComplete="off" minLength={MIN_PASSPHRASE} className={control} placeholder="At least 8 characters" />
                  </Field>
                </ActionForm>
              </>
            )}
          </div>
          </div>
        </div>
        <ReportView report={report} sources={sources} />
        {questionForReport(docId) && (
          <div data-print-hide className="mt-6 border-t border-line pt-4">
            <ActionForm action={saveTemplateAction.bind(null, docId)} testId="save-template" trigger="Save as template" submitLabel="Save the template">
              <p className="text-label text-ink-muted">
                The same question and these section headings, to run again from Reports{report.accountName ? " or any account's Ask" : ""} — for both of you.
              </p>
              <Field label="Name">
                <input name="name" required maxLength={80} defaultValue={report.title.slice(0, 80)} className={control} />
              </Field>
            </ActionForm>
          </div>
        )}
      </main>
    </div>
  );
}
