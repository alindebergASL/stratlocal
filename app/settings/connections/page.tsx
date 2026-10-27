import { requirePageUser } from "@/lib/auth";
import { listConnections } from "@/lib/integrations";
import { sealingReady } from "@/lib/crypto/secretBox";
import { flag } from "@/lib/prefs";
import { assistantMode } from "@/lib/assistants/settings";
import { fmtWhen } from "@/lib/format";
import { Page } from "@/components/Nav";
import { ActionForm } from "@/components/ActionForm";
import { ResultButton } from "@/components/ResultButton";
import { Field, PageHeader, Section, control } from "@/components/ui";
import { connectMailAction, disconnectMailAction, readMailNowAction, setCanSendAction, draftSelfTestAction, removeConnectionAction, saveConnectionAction, saveDigestAction, testConnectionAction } from "./actions";
import { mailSource } from "@/lib/mail/sync";
import { MAIL_KIND_LABEL, mailKinds } from "@/lib/mail/kinds";

export const dynamic = "force-dynamic";

const NAME = { slack: "Slack", teams: "Teams" } as const;
const HOW = {
  slack: "In Slack: Apps → Incoming Webhooks → Add to a channel (a private one to yourself works well), then copy the webhook URL.",
  teams: "In Teams: on the channel, Workflows → \"Post to a channel when a webhook request is received\", then copy the URL it gives you.",
} as const;

// Your own Slack or Teams channel, for the morning digest (DECISIONS #99).
// Yours alone: a teammate's connection is theirs. The address is sealed once
// saved and never shown again, only where it points.
export default async function ConnectionsPage() {
  const user = await requirePageUser();
  const conns = listConnections(user.id);
  const ready = sealingReady();
  const digestAuto = assistantMode("morning_digest") === "auto";
  const mail = mailSource(user.id);
  const kinds = mailKinds();
  const readerAuto = assistantMode("mail_reader") === "auto";
  return (
    <Page user={user} main="max-w-3xl">
      <PageHeader title="Connections" sub="Where your morning digest goes: counts and a link, never a customer's details unless you ask for names." />

      {!ready && (
        <p className="mb-6 rounded-xl bg-warning-soft p-4 text-label text-warning ring-1 ring-warning-line" role="status" data-testid="connections-no-key">
          Connections cannot be saved on this server yet: INTEGRATIONS_KEY is not set. Whoever runs the server sets it (32 random bytes, base64).
        </p>
      )}

      {(["slack", "teams"] as const).map((kind) => {
        const c = conns.find((x) => x.kind === kind);
        return (
          <Section key={kind} title={NAME[kind]} aside={<span data-testid={`connection-${kind}-state`}>{c ? "Connected" : "Not connected"}</span>}>
            <div className="space-y-3 text-label" data-testid={`connection-${kind}`}>
              {c ? (
                <>
                  <p className="text-ink">
                    Posting to <span className="font-mono text-micro">{c.host}</span>
                    {c.lastOkAt ? ` · last sent ${fmtWhen(c.lastOkAt)}` : ""}
                  </p>
                  {c.lastError && <p className="text-danger" role="alert" data-testid={`connection-${kind}-error`}>Last try failed: {c.lastError}</p>}
                  <ResultButton run={removeConnectionAction.bind(null, kind)} variant="ghost" testId={`connection-${kind}-remove`}>Remove</ResultButton>
                </>
              ) : (
                <p className="text-ink-muted">{HOW[kind]}</p>
              )}
              {ready && (
                <ActionForm action={saveConnectionAction.bind(null, kind)} trigger={c ? "Replace the address" : `Connect ${NAME[kind]}`} submitLabel="Save" testId={`connection-${kind}-form`} className="flex flex-wrap items-end gap-3">
                  <Field label="Webhook address">
                    <input name="url" type="url" required autoComplete="off" className={`${control} w-[min(32rem,80vw)]`} placeholder={kind === "slack" ? "https://hooks.slack.com/services/…" : "https://…"} />
                  </Field>
                </ActionForm>
              )}
            </div>
          </Section>
        );
      })}

      <Section title="Read my email" aside={<span data-testid="mail-state">{mail?.enabled ? "On" : "Off"}</span>}>
        <div className="space-y-3 text-label" data-testid="mail-settings">
          <p className="text-ink-muted">
            Only email with a customer is kept, for 30 days. What was agreed becomes changes to accept; email never moves a stage, status or amount.
          </p>
          {mail?.enabled ? (
            <>
              <p className="text-ink" data-testid="mail-connected">
                Reading <span className="font-mono text-micro">{mail.mailbox}</span> through {MAIL_KIND_LABEL[mail.kind]}
                {mail.lastReadAt ? ` · last read ${fmtWhen(mail.lastReadAt)}` : " · not read yet"}
                {mail.skipped ? ` · ${mail.skipped} not about an account, not kept` : ""}
              </p>
              {mail.lastError && <p className="text-danger" role="alert" data-testid="mail-error">Last read failed: {mail.lastError}</p>}
              {!readerAuto && <p className="text-ink-muted">The Mail reader assistant is not on its own yet; it reads only when you press Read now. Turn it on under Assistants.</p>}
              <div className="mt-2 rounded-lg bg-surface-sunk p-3" data-testid="mail-send-settings">
                <p className="text-ink">
                  <span className="font-semibold">Send from my mailbox:</span> {mail.canSend ? "on" : "off"}.{" "}
                  <span className="text-ink-muted">Nothing goes until you press Send on it.</span>
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <ResultButton run={setCanSendAction.bind(null, !mail.canSend)} testId="mail-can-send">{mail.canSend ? "Turn sending off" : "Turn sending on"}</ResultButton>
                  {mail.canSend && <ResultButton run={draftSelfTestAction} variant="ghost" testId="mail-self-test">Send myself a test</ResultButton>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <ResultButton run={readMailNowAction} testId="mail-read-now">Read now</ResultButton>
                <ResultButton run={disconnectMailAction} variant="ghost" testId="mail-disconnect">Stop reading</ResultButton>
              </div>
            </>
          ) : kinds.length === 0 ? (
            <p className="text-ink-muted" data-testid="mail-unavailable">Not available on this server yet: whoever runs it adds Mail.Read for Microsoft 365, or domain-wide delegation for Gmail.</p>
          ) : (
            <ActionForm action={connectMailAction} trigger="Connect my mailbox" submitLabel="Start reading" testId="mail-connect" className="flex flex-wrap items-end gap-3">
              <Field label="Mail">
                <select name="kind" className={control} defaultValue={kinds[0]} data-testid="mail-kind">
                  {kinds.map((k) => (
                    <option key={k} value={k}>{MAIL_KIND_LABEL[k]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Mailbox">
                <input name="mailbox" type="email" defaultValue={user.email} className={`${control} w-72`} />
              </Field>
            </ActionForm>
          )}
        </div>
      </Section>

      <Section title="Morning digest">
        <div className="space-y-3 text-label" data-testid="digest-settings">
          <p className="text-ink-muted">
            On weekday mornings, a short version of Today&apos;s briefing.
            {digestAuto ? "" : " The Morning digest assistant is not on its own yet; turn it on under Assistants."}
          </p>
          <ActionForm action={saveDigestAction} trigger="Change" submitLabel="Save" testId="digest-form" open className="flex flex-col gap-2">
            <label className="flex items-center gap-2"><input type="checkbox" name="digest_on" defaultChecked={flag(user.id, "digest_on")} className="size-4 accent-accent" data-testid="digest-on" /> Send me the morning digest</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="digest_names" defaultChecked={flag(user.id, "digest_names")} className="size-4 accent-accent" data-testid="digest-names" /> Include account names</label>
          </ActionForm>
          {conns.length > 0 && <ResultButton run={testConnectionAction} testId="connection-test">Send a test</ResultButton>}
        </div>
      </Section>
    </Page>
  );
}
