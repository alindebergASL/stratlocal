// A handoff you have made: the link, and exactly what the other team sees.
//
// The preview is the same component /s/<token> renders, from the same stored
// object, so what is on this page is what they get — not a second rendering
// that could drift from it.
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { getAccount, getDocument } from "@/lib/queries/accounts";
import { parseHandoff, shareState, SHARE_DAYS, DEFAULT_SHARE_DAYS, MIN_PASSPHRASE } from "@/lib/handoff/store";
import { needsPassphrase } from "@/lib/handoff/share";
import { archiveDocumentRecord, reshareHandoff, revokeHandoffShare } from "@/app/actions";
import { fmtDay } from "@/lib/format";
import { dayOf } from "@/lib/clock";
import { Page } from "@/components/Nav";
import { Breadcrumb, Callout, control, Field, Section } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { ArchiveButton } from "@/components/ArchiveButton";
import { HandoffView } from "@/components/HandoffView";
import { CopyLink } from "./CopyLink";

export const dynamic = "force-dynamic";

export default async function HandoffPage({ params }: { params: Promise<{ id: string; docId: string }> }) {
  const user = await requirePageUser();
  const { id, docId } = await params;
  const account = getAccount(id);
  if (!account) notFound();
  const doc = getDocument(docId);
  // Checked against the account in the URL as well as existing: a document id
  // from another account would otherwise render that account's handoff under
  // this one's breadcrumb.
  if (!doc || doc.account_id !== id) notFound();
  const found = parseHandoff(doc);
  if (!found) notFound();
  const { report } = found;
  const state = shareState(doc);
  const locked = needsPassphrase(doc);

  // The public name of this deployment, taken from the request rather than
  // from configuration, so the link is one that actually works from where the
  // person is standing — including in local development.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  const url = doc.share_token ? `${proto}://${host}/s/${doc.share_token}` : null;

  return (
    <Page user={user}>
      <Breadcrumb accountId={id} accountName={account.name} page="Handoff" />

      <Section title="The link">
        {state === "live" && url ? (
          <>
            {/* Said plainly, every time, and said differently depending on
                which of the two this link actually is. The unprotected
                sentence stayed true for a protected link would be the worst
                version of this screen: it would talk somebody out of sending
                a link that was already safe, or worse, leave them thinking a
                passphrase was set when it was not. */}
            <p className="mb-2 text-label text-ink-muted" data-testid="share-warning">
              {locked ? (
                <>
                  This link needs the passphrase you set, and stops working on {fmtDay(dayOf(doc.share_expires_at ?? 0))}. Send the passphrase
                  separately — a forwarded link is no use without it. If you have forgotten it, end the link and share again.
                </>
              ) : (
                <>
                  Anyone with this link can read the handoff until {fmtDay(dayOf(doc.share_expires_at ?? 0))} — there is no sign-in and no passphrase
                  on it, so it works for whoever it is forwarded to as well.
                </>
              )}
            </p>
            <CopyLink url={url} />
            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
              {/* Two steps rather than one button, which is the confirmation:
                  ending a link somebody may be reading is not a thing to do
                  by misclick. */}
              <ActionForm action={revokeHandoffShare.bind(null, id, docId)} testId="revoke-share" trigger="End the link" submitLabel="End it now">
                <p className="text-label text-ink-muted">
                  The link stops working immediately, for everyone it was forwarded to. The handoff itself stays here, and you can make a new link
                  afterwards — it will be a different address, so the old one stays dead.
                </p>
              </ActionForm>
            </div>
          </>
        ) : (
          <>
            <Callout tone="neutral" testId="share-off">
              {state === "expired"
                ? `This link ran out on ${fmtDay(dayOf(doc.share_expires_at ?? 0))}. Nobody can open it.`
                : "This link was ended. Nobody can open it."}
            </Callout>
            <ActionForm
              action={reshareHandoff.bind(null, id, docId)}
              testId="reshare"
              trigger="Share it again"
              submitLabel="Make a new link"
            >
              {/* A new token, not the old one reissued: a link that was ended
                  and then works again is the opposite of what ending it
                  meant. */}
              <Field label="The new link stops working after" hint="A fresh address — the old one stays dead.">
                <select name="share_days" defaultValue={String(DEFAULT_SHARE_DAYS)} className={control}>
                  {SHARE_DAYS.map((d) => (
                    <option key={d} value={d}>
                      {d} days
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Passphrase"
                hint="A new one, or blank for none. Whatever word the old link had does not carry over."
              >
                <input type="text" name="passphrase" autoComplete="off" minLength={MIN_PASSPHRASE} className={control} placeholder="At least 8 characters" />
              </Field>
            </ActionForm>
          </>
        )}
      </Section>

      <Section
        title="What they see"
        aside={
          <Link href={`/accounts/${id}/handoff`} className="text-micro font-semibold text-accent hover:underline">
            All handoffs
          </Link>
        }
      >
        <p className="mb-4 text-label text-ink-muted">
          Taken on {fmtDay(report.generated_at)} by {report.generated_by}. It does not change as the account does — that is what makes it a handoff
          rather than a link to the account.
        </p>
        {/* data-print="document" here too, so Save as PDF from this page gives
            the sender the same file the recipient would make. */}
        <div data-print="document" className="rounded-xl border border-line bg-paper p-4 sm:p-6">
          <HandoffView report={report} />
        </div>
      </Section>

      <Section title="Retire it">
        <div className="flex flex-wrap items-center gap-3">
          <ArchiveButton size="md" label="Archive this handoff" action={archiveDocumentRecord.bind(null, docId)} />
          <span className="text-micro text-ink-muted">
            Hides it here and stops its link working. Nothing is deleted — it comes back from the account&rsquo;s archived block.
          </span>
        </div>
      </Section>
    </Page>
  );
}
