import { field } from "@/lib/local/styles";
import { saveNotes, saveActionItem } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";
import { BaseVersion } from "@/components/ui";
import type { MeetingRow } from "@/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db, type AccountRow } from "@/lib/db";
import { requirePageUser, type PublicUser } from "@/lib/auth";
import { Page } from "@/components/Nav";
import { AccountHeader } from "@/components/AccountHeader";
import {
  artifact,
  packageRow,
  localSettings,
  type Job,
  type PackageRow,
  type Artifact,
} from "@/lib/local/store";
import { type PackageManifest } from "@/lib/local/packages";
import {
  capabilities,
  type DraftInput,
  type Citation,
  modelPrompt,
} from "@/lib/local/models";
import { type Segment } from "@/lib/local/evidence";
import { PackageUpload, LocalForm, RefreshJobs, CopyText } from "./Forms";

const card = "rounded-lg border border-line bg-surface p-5 space-y-3";
export function Hidden({ name, value }: { name: string; value: string }) {
  return <input type="hidden" name={name} value={value} />;
}
function Warnings({ json }: { json: string }) {
  const list = JSON.parse(json) as string[];
  return list.length ? (
    <ul className="list-disc pl-5 text-label">
      {list.map((w, i) => (
        <li key={i}>{w}</li>
      ))}
    </ul>
  ) : null;
}
function accounts() {
  return db()
    .prepare(
      "SELECT id,name FROM accounts WHERE archived_at IS NULL AND merged_into IS NULL AND kind='customer' ORDER BY name",
    )
    .all() as { id: string; name: string }[];
}
function AccountSelect({ value }: { value?: string }) {
  return (
    <select
      aria-label="Target account"
      name="accountId"
      className={field}
      defaultValue={value ?? ""}
      required
    >
      <option value="">Choose account</option>
      {accounts().map((a) => (
        <option value={a.id} key={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );
}
function Sources({ items }: { items: Citation[] }) {
  return (
    <ul className="space-y-2">
      {items.map((s) => (
        <li key={s.key}>
          <Link
            className="underline"
            href={`/evidence/${s.artifactId}#${s.locator}`}
          >
            [{s.key}] {s.filename} · {s.locator}
          </Link>
        </li>
      ))}
    </ul>
  );
}
function EvidenceChoices({ accountId }: { accountId: string }) {
  const rows = db()
    .prepare(
      "SELECT DISTINCT a.id,a.filename FROM local_artifacts a JOIN local_artifact_links l ON l.artifact_id=a.id WHERE l.account_id=? ORDER BY a.created_at DESC",
    )
    .all(accountId) as { id: string; filename: string }[];
  return (
    <fieldset className="space-y-2">
      <legend>Select evidence to include</legend>
      {rows.length ? (
        rows.map((a) => (
          <label className="block" key={a.id}>
            <input type="checkbox" name="artifactIds" value={a.id} />{" "}
            {a.filename}
          </label>
        ))
      ) : (
        <p>Import and link evidence first.</p>
      )}
    </fieldset>
  );
}
export function LocalOverview({
  account,
  user,
}: {
  account: AccountRow;
  user: PublicUser;
}) {
  const counts = db()
    .prepare(
      "SELECT (SELECT count(DISTINCT artifact_id) FROM local_artifact_links WHERE account_id=?) evidence,(SELECT count(*) FROM deals WHERE account_id=? AND archived_at IS NULL) opportunities,(SELECT count(*) FROM meetings WHERE account_id=? AND archived_at IS NULL) meetings",
    )
    .get(account.id, account.id, account.id) as {
    evidence: number;
    opportunities: number;
    meetings: number;
  };
  return (
    <Page user={user}>
      <AccountHeader account={account} tab="overview" />
      <div className="space-y-5">
        <section className={card}>
          <h2 className="text-lead font-semibold">Account plan</h2>
          <p className="whitespace-pre-wrap">
            {account.thesis ||
              "Capture the account objective and next steps in the plan."}
          </p>
          <Link className="underline" href={`/accounts/${account.id}/plays`}>
            Review plan and actions
          </Link>
        </section>
        <section className={card}>
          <h2 className="text-lead font-semibold">
            Prepare your next conversation
          </h2>
          <p>
            {counts.evidence} sources · {counts.opportunities} opportunities ·{" "}
            {counts.meetings} meetings
          </p>
          <p>
            Select evidence, prepare a MyAgent request, or draft with an
            available local model.
          </p>
          <Link className="underline" href={`/accounts/${account.id}/evidence`}>
            Open evidence & MyAgent
          </Link>
        </section>
        <p className="text-label text-ink-muted">
          Research and generated text stay separate from customer-confirmed
          answers. Review imported changes in the inbox.
        </p>
      </div>
    </Page>
  );
}
export async function ImportsPage() {
  const user = await requirePageUser();
  const packages = db()
    .prepare("SELECT * FROM local_packages ORDER BY created_at DESC LIMIT 100")
    .all() as PackageRow[];
  const jobs = db()
    .prepare(
      "SELECT * FROM local_jobs WHERE created_by=? ORDER BY created_at DESC LIMIT 50",
    )
    .all(user.id) as Job[];
  return (
    <Page user={user}>
      <h1 className="text-title font-bold mb-5">Imports & tasks</h1>
      <div className="space-y-5">
        <section className={card}>
          <PackageUpload />
        </section>
        <section className={card}>
          <h2 className="text-lead">Imports</h2>
          {packages.map((p) => (
            <p key={p.id}>
              <Link className="underline" href={`/imports/${p.id}`}>
                {p.filename}
              </Link>{" "}
              · {p.state}
            </p>
          ))}
          {!packages.length && (
            <p>
              Import a MyAgent package, or open an account to add reference
              files.
            </p>
          )}
        </section>
        <section className={card}>
          <h2 className="text-lead">Background tasks</h2>
          <RefreshJobs
            active={jobs.some((j) => ["queued", "running"].includes(j.status))}
          />
          {jobs.map((j) => {
            const result = j.result_json ? JSON.parse(j.result_json) : {};
            return (
              <div className="border-t border-line py-3" key={j.id}>
                <p>
                  {j.kind} · {j.status} · {j.progress}
                </p>
                {j.error && <p role="alert">{j.error}</p>}
                {result?.draftId && (
                  <Link
                    className="underline"
                    href={`/drafts/${result.draftId}`}
                  >
                    Review draft
                  </Link>
                )}
                {["queued", "running"].includes(j.status) && (
                  <LocalForm operation="cancel_job" label="Cancel">
                    <Hidden name="id" value={j.id} />
                  </LocalForm>
                )}
              </div>
            );
          })}
        </section>
      </div>
    </Page>
  );
}
export async function ImportPage({ id }: { id: string }) {
  const user = await requirePageUser(),
    p = packageRow(id);
  if (!p) notFound();
  const m = p.manifest_json
    ? (JSON.parse(p.manifest_json) as PackageManifest)
    : null;
  const paths = JSON.parse(p.artifacts_json) as Record<string, string>;
  const j = db()
    .prepare("SELECT status,error FROM local_jobs WHERE request_key=?")
    .get(`import:${id}`) as
    | { status: string; error: string | null }
    | undefined;
  return (
    <Page user={user}>
      <h1 className="text-title font-bold">{p.filename}</h1>
      <p>
        {p.state} {j ? `· task ${j.status}` : ""}
      </p>
      <RefreshJobs active={!!j && ["queued", "running"].includes(j.status)} />
      <div className="mt-5 space-y-5">
        <Warnings json={p.warnings_json} />
        {(p.error || j?.error) && <p role="alert">{p.error || j?.error}</p>}
        <section className={card}>
          <h2 className="text-lead">Originals & source locations</h2>
          {Object.entries(paths).map(([name, aid]) => (
            <p key={name}>
              <Link className="underline" href={`/evidence/${aid}`}>
                {name}
              </Link>
            </p>
          ))}
        </section>
        {m?.accounts.map((a) => {
          const mapping = db()
            .prepare(
              "SELECT account_id,alias_approved FROM local_account_mappings WHERE package_id=? AND source_key=?",
            )
            .get(id, a.key) as
            | { account_id: string; alias_approved: number }
            | undefined;
          const identity = a.report.account as {
            name: string;
            crm_id?: string;
          };
          return (
            <section className={card} key={a.key}>
              <h2 className="text-lead">{identity.name}</h2>
              <p>
                Source key: {a.key} · CRM ID:{" "}
                {identity.crm_id || "not supplied"}
              </p>
              <LocalForm
                operation="resolve_account"
                label="Confirm account mapping"
              >
                <Hidden name="packageId" value={id} />
                <Hidden name="key" value={a.key} />
                <AccountSelect value={mapping?.account_id} />
                <label className="block">
                  <input
                    type="checkbox"
                    name="alias"
                    defaultChecked={!!mapping?.alias_approved}
                  />{" "}
                  I reviewed the identity and approve this name as an alias.
                  Conflicting CRM IDs remain blocked.
                </label>
              </LocalForm>
              <details>
                <summary>Reported account data</summary>
                <pre className="overflow-auto whitespace-pre-wrap text-micro">
                  {JSON.stringify(a.report, null, 2)}
                </pre>
              </details>
            </section>
          );
        })}
        {m && (
          <section className={card}>
            <h2 className="text-lead">Prepare changes for review</h2>
            <p>
              Confirm mappings first. This links evidence and territory
              membership and prepares account and metric proposals. Review each
              change before accepting it.
            </p>
            <LocalForm operation="propose_package" label="Prepare proposals">
              <Hidden name="packageId" value={id} />
            </LocalForm>
            <Link className="underline" href="/accounts">
              Create or review accounts
            </Link>
          </section>
        )}
        <Metrics packageId={id} />
      </div>
    </Page>
  );
}
export async function EvidencePage({ id }: { id: string }) {
  const user = await requirePageUser(),
    a = artifact(id);
  if (!a) notFound();
  const links = db()
    .prepare(
      "SELECT l.*,a.name FROM local_artifact_links l JOIN accounts a ON a.id=l.account_id WHERE artifact_id=?",
    )
    .all(id) as {
    account_id: string;
    name: string;
    audience: string;
    author_labels_json: string;
  }[];
  return (
    <Page user={user}>
      <h1 className="text-title font-bold">{a.filename}</h1>
      <a className="underline" href={`/api/local/files/${id}`}>
        Download original
      </a>
      <p className="break-all text-micro">SHA-256: {a.sha256}</p>
      <Warnings json={a.warnings_json} />
      <div className="space-y-5 mt-5">
        <section className={card}>
          <h2>Linked accounts</h2>
          {links.map((l, i) => (
            <p key={i}>
              <Link className="underline" href={`/accounts/${l.account_id}`}>
                {l.name}
              </Link>{" "}
              · audience: {l.audience} · author labels:{" "}
              {(JSON.parse(l.author_labels_json) as string[]).join(", ") ||
                "none"}
            </p>
          ))}
          <p className="text-label">
            Audience and evidence labels are author-supplied classifications,
            not independent verification.
          </p>
          <LocalForm operation="link_evidence" label="Link original">
            <Hidden name="artifactId" value={id} />
            <AccountSelect />
            <label>
              Meeting ID (optional)
              <input className={field} name="meetingId" />
            </label>
          </LocalForm>
        </section>
        {(JSON.parse(a.segments_json) as Segment[]).map((s) => (
          <section className={card} id={s.locator} key={s.locator}>
            <h2 className="font-semibold">
              {s.label} · {s.locator}
            </h2>
            <p className="whitespace-pre-wrap break-words">{s.text}</p>
          </section>
        ))}
      </div>
    </Page>
  );
}
export async function AccountEvidencePage({ id }: { id: string }) {
  const user = await requirePageUser();
  const account = db().prepare("SELECT * FROM accounts WHERE id=?").get(id) as
    | AccountRow
    | undefined;
  if (!account) notFound();
  const settings = localSettings();
  const rows = db()
    .prepare(
      "SELECT DISTINCT a.* FROM local_artifacts a JOIN local_artifact_links l ON l.artifact_id=a.id WHERE l.account_id=? ORDER BY a.created_at DESC",
    )
    .all(id) as Artifact[];
  const meetings = db()
    .prepare(
      "SELECT id,title,held_at FROM meetings WHERE account_id=? AND archived_at IS NULL ORDER BY held_at DESC",
    )
    .all(id) as { id: string; title: string; held_at: string }[];
  const drafts = db()
    .prepare(
      "SELECT id,task,status FROM local_drafts WHERE account_id=? ORDER BY created_at DESC",
    )
    .all(id) as { id: string; task: string; status: string }[];
  return (
    <Page user={user}>
      <AccountHeader account={account} tab="overview" />
      <div className="space-y-5">
        <section className={card}>
          <h2 className="text-lead">Evidence</h2>
          {rows.map((a) => (
            <p key={a.id}>
              <Link className="underline" href={`/evidence/${a.id}`}>
                {a.filename}
              </Link>
            </p>
          ))}
          <PackageUpload accountId={id} />
        </section>
        <section className={card}>
          <h2 className="text-lead">Prepare a MyAgent request</h2>
          <p>
            Copy the prompt or download the package and give it to MyAgent.
            Import its response here for review.
          </p>
          <LocalForm operation="prepare_request" label="Prepare request">
            <Hidden name="accountId" value={id} />
            <textarea
              className={field}
              name="question"
              required
              maxLength={8000}
              placeholder="What do you want MyAgent to research?"
            />
            <EvidenceChoices accountId={id} />
            <label className="block">
              <input type="checkbox" name="writeFolder" /> Also write to the
              configured exchange folder
            </label>
          </LocalForm>
        </section>
        <section className={card}>
          <h2 className="text-lead">Draft with a local model</h2>
          <p>
            Review the exact evidence context before running. Models must
            already be installed and available.
          </p>
          <LocalForm operation="preview_draft" label="Preview context">
            <Hidden name="accountId" value={id} />
            <label>
              Provider
              <select
                className={field}
                name="provider"
                defaultValue={settings.provider}
              >
                <option value="ollama">Ollama</option>
                <option value="apple">Apple Foundation Models</option>
              </select>
            </label>
            <label>
              Model (Ollama model name)
              <input
                className={field}
                name="model"
                defaultValue={settings.model}
              />
            </label>
            <label>
              Task
              <select className={field} name="task">
                <option value="summary">Evidence summary</option>
                <option value="account_plan">Account plan update</option>
                <option value="meeting_brief">Meeting brief</option>
                <option value="follow_up">Follow-up draft</option>
              </select>
            </label>
            <label>
              Meeting
              <select className={field} name="meetingId">
                <option value="">None</option>
                {meetings.map((m) => (
                  <option value={m.id} key={m.id}>
                    {m.title} · {m.held_at}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Instructions
              <textarea
                className={field}
                name="instructions"
                maxLength={4000}
              />
            </label>
            <EvidenceChoices accountId={id} />
          </LocalForm>
        </section>
        <section className={card}>
          <h2 className="text-lead">Drafts</h2>
          {drafts.map((d) => (
            <p key={d.id}>
              <Link className="underline" href={`/drafts/${d.id}`}>
                {d.task.replaceAll("_", " ")}
              </Link>{" "}
              · {d.status}
            </p>
          ))}
        </section>
        <Metrics accountId={id} />
      </div>
    </Page>
  );
}
export async function RequestPage({ id }: { id: string }) {
  const user = await requirePageUser();
  const r = db()
    .prepare("SELECT * FROM local_requests WHERE id=? AND created_by=?")
    .get(id, user.id) as { prompt: string } | undefined;
  if (!r) notFound();
  return (
    <Page user={user}>
      <h1 className="text-title">MyAgent request</h1>
      <p className="my-4">
        Prepared locally. Give this request to MyAgent, then import its response
        package.
      </p>
      <div className="flex gap-4">
        <CopyText text={r.prompt} />
        <a className="underline" href={`/api/local/files/${id}`}>
          Download request & selected originals
        </a>
      </div>
      <pre className="mt-5 whitespace-pre-wrap">{r.prompt}</pre>
    </Page>
  );
}
export async function PreviewPage({ id }: { id: string }) {
  const user = await requirePageUser();
  const r = db()
    .prepare("SELECT value FROM settings WHERE key=? AND updated_by=?")
    .get(`local_preview:${id}`, user.id) as { value: string } | undefined;
  if (!r) notFound();
  const input = JSON.parse(r.value) as DraftInput,
    external = ["anthropic", "bedrock"].includes(input.provider);
  return (
    <Page user={user}>
      <h1 className="text-title">Review draft context</h1>
      <p className="my-4">
        Provider: {input.provider} · Model: {input.model || "system default"}.{" "}
        {external
          ? "This task sends the following text to an external provider."
          : "This task uses your local model bridge."}
      </p>
      <Warnings json={JSON.stringify(input.context.omissions)} />
      <Sources items={input.context.sources} />
      <pre className="my-5 whitespace-pre-wrap rounded border border-line p-4">
        {modelPrompt(input.context)}
      </pre>
      <LocalForm operation="run_draft" label="Run this task">
        <Hidden name="previewId" value={id} />
        {external && (
          <label>
            <input required type="checkbox" name="externalApproved" /> I approve
            sending exactly this context to {input.provider} for this task.
          </label>
        )}
      </LocalForm>
    </Page>
  );
}
export async function DraftPage({ id }: { id: string }) {
  const user = await requirePageUser();
  const d = db()
    .prepare("SELECT * FROM local_drafts WHERE id=? AND created_by=?")
    .get(id, user.id) as
    | {
        id: string;
        task: string;
        provider: string;
        model: string;
        content: string;
        reviewed_content: string | null;
        status: string;
        sources_json: string;
        omissions_json: string;
        account_id: string;
      }
    | undefined;
  if (!d) notFound();
  return (
    <Page user={user}>
      <h1 className="text-title">{d.task.replaceAll("_", " ")}</h1>
      <p className="my-4">
        {d.status} · {d.provider} · {d.model}. Model output requires factual
        review; citations locate evidence but do not verify the claims.
      </p>
      <Warnings json={d.omissions_json} />
      <Sources items={JSON.parse(d.sources_json)} />
      {d.status === "draft" ? (
        <LocalForm
          operation="accept_draft"
          label={
            d.task === "account_plan"
              ? "Accept and update account thesis"
              : "Accept reviewed draft"
          }
        >
          <Hidden name="id" value={id} />
          <textarea
            aria-label="Review draft text"
            className={`${field} min-h-96 mt-5`}
            name="content"
            defaultValue={d.content}
            required
          />
          <p>
            {d.task === "account_plan"
              ? "Acceptance replaces the account thesis with your reviewed text (up to 4,000 characters)."
              : "Acceptance saves a reviewed draft. Copy it into meeting notes or follow-up actions when ready; nothing is sent."}
          </p>
        </LocalForm>
      ) : (
        <pre className="whitespace-pre-wrap my-5">
          {d.reviewed_content || d.content}
        </pre>
      )}
      <details className="my-4">
        <summary>Original generated text</summary>
        <pre className="whitespace-pre-wrap">{d.content}</pre>
      </details>
      <Link className="underline" href={`/accounts/${d.account_id}`}>
        Return to account
      </Link>
    </Page>
  );
}
function Metrics({
  accountId,
  packageId,
}: {
  accountId?: string;
  packageId?: string;
}) {
  const rows = db()
    .prepare(
      `SELECT m.*,a.name account_name,t.name territory_name FROM local_metrics m LEFT JOIN accounts a ON a.id=m.account_id LEFT JOIN local_territories t ON t.id=m.territory_id ${accountId ? "WHERE m.account_id=?" : packageId ? "WHERE m.package_id=?" : "WHERE m.status='accepted'"} ORDER BY m.period_end DESC`,
    )
    .all(...(accountId ? [accountId] : packageId ? [packageId] : [])) as {
    id: string;
    account_name: string | null;
    territory_name: string | null;
    measure: string;
    value: number;
    unit: string;
    period_start: string;
    period_end: string;
    definition: string;
    source_json: string;
    status: string;
  }[];
  return (
    <section className={card}>
      <h2 className="text-lead">Metric observations</h2>
      <p>
        Wallet, pipeline, bookings, and installed base remain separate. Reported
        territory totals are shown separately from account observations; they
        are not added together.
      </p>
      {rows.map((m) => {
        const s = JSON.parse(m.source_json) as {
          artifact_id: string;
          locator?: string;
        };
        return (
          <article className="border-t border-line py-3 space-y-2" key={m.id}>
            <p className="font-semibold">
              {m.account_name || `Territory: ${m.territory_name}`} ·{" "}
              {m.measure.replaceAll("_", " ")} · {m.value.toLocaleString()}{" "}
              {m.unit}
            </p>
            <p>
              {m.period_start} – {m.period_end} · {m.status}
            </p>
            <p>{m.definition}</p>
            <Link
              className="underline"
              href={`/evidence/${s.artifact_id}${s.locator ? `#${s.locator}` : ""}`}
            >
              Inspect source
            </Link>
            {m.status === "pending" && (
              <LocalForm operation="metric_decision" label="Record decision">
                <Hidden name="id" value={m.id} />
                <select className={field} name="status">
                  <option value="accepted">Accept observation</option>
                  <option value="rejected">Reject observation</option>
                </select>
              </LocalForm>
            )}
          </article>
        );
      })}
      {!rows.length && <p>No observations to display.</p>}
    </section>
  );
}
export async function TerritoryPage() {
  const user = await requirePageUser();
  const rows = db()
    .prepare(
      "SELECT t.id,t.name,a.id account_id,a.name account_name,m.as_of FROM local_territories t JOIN local_territory_members m ON m.territory_id=t.id JOIN accounts a ON a.id=m.account_id WHERE m.as_of=(SELECT max(m2.as_of) FROM local_territory_members m2 WHERE m2.territory_id=t.id) ORDER BY t.name,a.name",
    )
    .all() as {
    id: string;
    name: string;
    account_id: string;
    account_name: string;
    as_of: string;
  }[];
  return (
    <Page user={user}>
      <h1 className="text-title font-bold mb-5">Territory</h1>
      <div className="space-y-5">
        <section className={card}>
          <h2 className="text-lead">Accounts by latest territory snapshot</h2>
          {rows.map((r) => (
            <p key={`${r.id}:${r.account_id}`}>
              {r.name} ·{" "}
              <Link className="underline" href={`/accounts/${r.account_id}`}>
                {r.account_name}
              </Link>{" "}
              · as of {r.as_of}
            </p>
          ))}
          {!rows.length && (
            <p>
              Import a package with a territory and account mappings to begin.
            </p>
          )}
        </section>
        <Metrics />
      </div>
    </Page>
  );
}
export async function MeetingsPage() {
  const user = await requirePageUser();
  const rows = db()
    .prepare(
      "SELECT m.id,m.title,m.held_at,m.account_id,a.name FROM meetings m JOIN accounts a ON a.id=m.account_id WHERE m.archived_at IS NULL ORDER BY m.held_at DESC LIMIT 100",
    )
    .all() as {
    id: string;
    title: string;
    held_at: string;
    account_id: string;
    name: string;
  }[];
  return (
    <Page user={user}>
      <h1 className="text-title font-bold mb-5">Meetings</h1>
      <p className="mb-5">
        Open an account to create a meeting. Prepare its brief from selected
        evidence, then capture questions and confirmed answers separately.
      </p>
      {rows.map((m) => (
        <section className={`${card} mb-4`} key={m.id}>
          <h2>
            <Link
              className="underline"
              href={`/accounts/${m.account_id}/meetings/${m.id}`}
            >
              {m.title}
            </Link>{" "}
            · {m.name} · {m.held_at}
          </h2>
          <Link
            className="underline"
            href={`/accounts/${m.account_id}/evidence`}
          >
            Prepare meeting brief or follow-up
          </Link>
          <Confirmations accountId={m.account_id} meetingId={m.id} />
        </section>
      ))}
    </Page>
  );
}
export function Confirmations({
  accountId,
  meetingId,
}: {
  accountId: string;
  meetingId: string;
}) {
  const rows = db()
    .prepare(
      "SELECT * FROM local_confirmations WHERE meeting_id=? ORDER BY created_at",
    )
    .all(meetingId) as {
    id: string;
    state: string;
    question: string;
    answer: string | null;
    speaker: string | null;
    confirmed_at: string | null;
  }[];
  return (
    <details>
      <summary>Discovery questions & customer confirmations</summary>
      <div className="space-y-3 mt-3">
        {rows.map((r) => (
          <article key={r.id}>
            <p className="font-semibold">
              {r.state} · {r.question}
            </p>
            <p>{r.answer}</p>
            {r.speaker && (
              <p>
                {r.speaker} · {r.confirmed_at}
              </p>
            )}
          </article>
        ))}
        <LocalForm operation="confirmation" label="Save discovery record">
          <Hidden name="accountId" value={accountId} />
          <Hidden name="meetingId" value={meetingId} />
          <label>
            Record type
            <select className={field} name="state">
              <option value="question">Proposed question</option>
              <option value="hypothesis">Hypothesis</option>
              <option value="confirmed">Customer-confirmed answer</option>
            </select>
          </label>
          <label>
            Question
            <input className={field} name="question" required />
          </label>
          <label>
            Answer / hypothesis
            <textarea className={field} name="answer" />
          </label>
          <p>
            Confirmed answers require speaker, time, and an exact quotation from
            an imported source.
          </p>
          {[
            ["speaker", "Speaker"],
            ["confirmedAt", "Confirmation time (ISO date/time)"],
            ["artifactId", "Source artifact ID (from evidence URL)"],
            ["locator", "Source location (e.g. section:1)"],
            ["quote", "Exact source quotation"],
          ].map(([name, label]) => (
            <label className="block" key={name}>
              {label}
              <input className={field} name={name} />
            </label>
          ))}
        </LocalForm>
      </div>
    </details>
  );
}
export async function LocalSettingsPage() {
  const user = await requirePageUser(),
    settings = localSettings(),
    caps = await capabilities();
  return (
    <Page user={user}>
      <h1 className="text-title font-bold mb-5">Local workspace settings</h1>
      <div className="space-y-5">
        <section className={card}>
          <p>
            MyAgent is a manual exchange: prepare requests, bring back sources,
            then review changes. No AI provider is required to use accounts,
            imports, or meetings.
          </p>
          <LocalForm operation="settings">
            <label>
              Preferred local provider
              <select
                name="provider"
                className={field}
                defaultValue={settings.provider}
              >
                <option value="ollama">Ollama</option>
                <option value="apple">Apple Foundation Models</option>
              </select>
            </label>
            <label>
              Installed Ollama model
              <input
                name="model"
                className={field}
                defaultValue={settings.model}
              />
            </label>
            <label className="block">
              <input
                type="checkbox"
                name="watchEnabled"
                defaultChecked={settings.watchEnabled}
              />{" "}
              Watch configured exchange folder
            </label>
            <p>
              Folder mount:{" "}
              {process.env.STRATEGY_EXCHANGE_DIR
                ? "configured"
                : "not configured"}
              . Incoming files must finish copying before import. Failed files
              remain in Incoming.
            </p>
          </LocalForm>
        </section>
        <section className={card}>
          <h2 className="text-lead">Model availability</h2>
          {"error" in caps && <p>{caps.error}</p>}
          {caps.providers.map((p) => (
            <p key={p.id}>
              {p.id}: {p.available ? "available" : p.reason || "unavailable"}{" "}
              {p.models.join(", ")}
            </p>
          ))}
          <p>
            Install the Mac helper using the repository’s local-workspace guide.
            Apple support requires compatible hardware, macOS, and enabled Apple
            Intelligence. Unavailable models fail visibly; there is no external
            fallback.
          </p>
        </section>
        <details className={card}>
          <summary>Advanced</summary>
          <Link className="underline" href="/settings/advanced/external-ai">
            External AI
          </Link>
        </details>
      </div>
    </Page>
  );
}
export async function ExternalSettingsPage() {
  const user = await requirePageUser(),
    s = localSettings();
  return (
    <Page user={user}>
      <h1 className="text-title font-bold mb-5">Advanced · External AI</h1>
      <div className="space-y-5">
        <section className={card}>
          <p>
            External AI is {s.externalEnabled ? "enabled" : "disabled"}. Every
            external task requires a separate review of the exact context.
            Credentials are stored by the Mac helper in Keychain.
          </p>
          <LocalForm operation="external_policy" label="Save external policy">
            <label>
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={s.externalEnabled}
              />{" "}
              Enable external tasks
            </label>
          </LocalForm>
        </section>
        {s.externalEnabled && (
          <>
            <section className={card}>
              <h2>Provider credentials</h2>
              <LocalForm operation="credentials" label="Store in Keychain">
                <select className={field} name="provider">
                  <option value="anthropic">Anthropic</option>
                  <option value="bedrock">Bedrock</option>
                </select>
                {[
                  ["apiKey", "Anthropic API key"],
                  ["accessKeyId", "AWS access key ID"],
                  ["secretAccessKey", "AWS secret access key"],
                  ["sessionToken", "AWS session token (optional)"],
                  ["region", "AWS region"],
                ].map(([name, label]) => (
                  <label className="block" key={name}>
                    {label}
                    <input
                      type={name === "region" ? "text" : "password"}
                      autoComplete="off"
                      className={field}
                      name={name}
                    />
                  </label>
                ))}
              </LocalForm>
            </section>
            <section className={card}>
              <h2>Prepare an external task</h2>
              <p>
                Use the account ID and evidence IDs from their URLs. This
                advanced form never adds unselected context.
              </p>
              <LocalForm
                operation="preview_draft"
                label="Preview external context"
              >
                <AccountSelect />
                <select className={field} name="provider">
                  <option value="anthropic">Anthropic</option>
                  <option value="bedrock">Bedrock</option>
                </select>
                <label>
                  Model ID
                  <input className={field} name="model" required />
                </label>
                <Hidden name="task" value="summary" />
                <label>
                  Evidence artifact ID
                  <input className={field} name="artifactIds" required />
                </label>
                <label>
                  Instructions
                  <textarea className={field} name="instructions" />
                </label>
              </LocalForm>
            </section>
          </>
        )}
      </div>
    </Page>
  );
}

export function LocalMeeting({
  account,
  meeting,
  user,
}: {
  account: AccountRow;
  meeting: MeetingRow;
  user: PublicUser;
}) {
  const links = db()
    .prepare(
      "SELECT a.id,a.filename FROM local_artifacts a JOIN local_artifact_links l ON l.artifact_id=a.id WHERE l.meeting_id=? AND l.account_id=?",
    )
    .all(meeting.id, account.id) as { id: string; filename: string }[];
  return (
    <Page user={user}>
      <AccountHeader account={account} tab="meetings" />
      <h2 className="text-title font-bold">{meeting.title}</h2>
      <p>
        {meeting.held_at} {meeting.held_time}
      </p>
      <div className="space-y-5 mt-5">
        <section className={card}>
          <h3 className="text-lead">Preparation & sources</h3>
          <Link className="underline" href={`/accounts/${account.id}/evidence`}>
            Prepare a meeting brief or follow-up draft
          </Link>
          {links.map((a) => (
            <p key={a.id}>
              <Link className="underline" href={`/evidence/${a.id}`}>
                {a.filename}
              </Link>
            </p>
          ))}
          <p className="text-micro">
            To link a briefing or deck, open its evidence page and use meeting
            ID: {meeting.id}
          </p>
        </section>
        <section className={card}>
          <h3 className="text-lead">Meeting notes</h3>
          <ActionForm
            action={saveNotes.bind(null, account.id, meeting.id)}
            trigger="Edit notes"
            open
          >
            <BaseVersion of={meeting.updated_at} />
            <textarea
              name="raw_notes"
              aria-label="Meeting notes"
              className={`${field} min-h-64`}
              defaultValue={meeting.raw_notes ?? ""}
            />
          </ActionForm>
          <p>
            Import a copy of confirmed notes as evidence to cite exact
            quotations below.
          </p>
        </section>
        <section className={card}>
          <Confirmations accountId={account.id} meetingId={meeting.id} />
        </section>
        <section className={card}>
          <h3 className="text-lead">Follow-up actions</h3>
          <ActionForm
            action={saveActionItem.bind(null, account.id, null)}
            trigger="Add follow-up"
          >
            <Hidden name="meeting_id" value={meeting.id} />
            <label>
              Action
              <input name="text" className={field} required />
            </label>
            <label>
              Owner
              <input name="owner" className={field} />
            </label>
            <label>
              Due
              <input type="date" name="due" className={field} />
            </label>
          </ActionForm>
          <Link
            className="underline"
            href={`/accounts/${account.id}/follow-ups`}
          >
            Review and complete account follow-ups
          </Link>
        </section>
      </div>
    </Page>
  );
}
