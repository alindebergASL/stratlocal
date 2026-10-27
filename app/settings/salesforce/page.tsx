import { listUsers, requirePageUser } from "@/lib/auth";
import { ENV_NEEDED, isFakeSalesforce, salesforceProblem, salesforceSettings } from "@/lib/salesforce/config";
import { salesforceLog } from "@/lib/salesforce/sync";
import { MEDDPICC, MEDDPICC_LABELS } from "@/lib/playbook/schema";
import { fmtWhen } from "@/lib/format";
import { Page } from "@/components/Nav";
import { ActionForm } from "@/components/ActionForm";
import { ResultButton } from "@/components/ResultButton";
import { Field, PageHeader, Section, control } from "@/components/ui";
import { checkSalesforceAction, saveSalesforceAction } from "./actions";

export const dynamic = "force-dynamic";

// The optional Salesforce connection: off until turned on here, with the
// credentials only in the box's environment. Reads arrive as proposals;
// writes happen only when someone presses send.
export default async function SalesforcePage() {
  const user = await requirePageUser();
  const s = salesforceSettings();
  const problem = salesforceProblem(s);
  const log = salesforceLog(15);
  const names = new Map(listUsers({ includeInactive: true }).map((u) => [u.id, u.display_name]));
  const envState = (k: string) => (process.env[k]?.trim() ? "set" : "missing");
  return (
    <Page user={user} main="max-w-3xl">
      <PageHeader title="Salesforce" sub="Optional. Bring opportunities and contacts in for review; send the scorecard out." />

      <Section title="Connection" aside={<span data-testid="sf-state">{s.enabled ? (problem ? "On, not ready" : "On") : "Off"}</span>}>
        <div className="space-y-3 text-label" data-testid="sf-connection">
          {problem ? <p className="text-ink">{problem}</p> : <p className="text-ink">Ready{isFakeSalesforce() ? " (synthetic records: SALESFORCE_FAKE is set)" : ""}.</p>}
          <ul className="grid gap-1 sm:grid-cols-2">
            {ENV_NEEDED[s.mode].map((k) => (
              <li key={k} className="font-mono text-micro text-ink-muted">
                {k}: <span className={envState(k) === "set" ? "text-positive" : "text-danger"}>{envState(k)}</span>
              </li>
            ))}
          </ul>
          <p className="text-micro text-ink-muted">
            {s.mode === "rest"
              ? "REST: a connected app with the client-credentials flow, its run-as user limited to what this team may see. Login URL is your My Domain or login.salesforce.com."
              : "MCP: a Salesforce MCP server reached over HTTPS with a bearer token. Name the server's query tool, and its update tool if writes should be possible."}
          </p>
          {s.enabled && !problem && <ResultButton run={checkSalesforceAction} testId="sf-check">Check Salesforce</ResultButton>}
        </div>
      </Section>

      <Section title="Settings">
        <ActionForm action={saveSalesforceAction} trigger="Change settings" submitLabel="Save" testId="sf-settings">
          <label className="flex basis-full items-center gap-2 text-label">
            <input type="checkbox" name="enabled" defaultChecked={s.enabled} className="size-4 accent-accent" /> Use Salesforce
          </label>
          <Field label="Connect through">
            <select name="mode" defaultValue={s.mode} className={control}>
              <option value="rest">REST API</option>
              <option value="mcp">MCP server</option>
            </select>
          </Field>
          <Field label="MCP query tool">
            <input name="mcp_query" defaultValue={s.mcpQueryTool} className={control} />
          </Field>
          <Field label="MCP update tool (blank: no writes)">
            <input name="mcp_update" defaultValue={s.mcpUpdateTool ?? ""} className={control} />
          </Field>
          <p className="basis-full text-label font-semibold text-ink-strong">Installed base</p>
          <Field label="Object">
            <input name="ib_object" defaultValue={s.installBase?.object ?? ""} placeholder="Asset" className={control} />
          </Field>
          <Field label="Product field">
            <input name="ib_product" defaultValue={s.installBase?.product ?? ""} placeholder="Product2.Name" className={control} />
          </Field>
          <Field label="Value field">
            <input name="ib_value" defaultValue={s.installBase?.value ?? ""} placeholder="Price" className={control} />
          </Field>
          <Field label="Quantity field">
            <input name="ib_quantity" defaultValue={s.installBase?.quantity ?? ""} placeholder="Quantity" className={control} />
          </Field>
          <p className="basis-full text-label font-semibold text-ink-strong">Scorecard on the opportunity</p>
          <Field label="One long text field for all of it" wide>
            <input name="q_combined" defaultValue={s.qualification.combined ?? ""} placeholder="MEDDPICC_Notes__c" className={control} />
          </Field>
          {MEDDPICC.map((e) => (
            <Field key={e} label={MEDDPICC_LABELS[e]}>
              <input name={`q_${e}`} defaultValue={s.qualification.fields[e] ?? ""} className={control} />
            </Field>
          ))}
        </ActionForm>
        <dl className="mt-3 grid gap-x-4 gap-y-1 text-label sm:grid-cols-2" data-testid="sf-summary">
          <dt className="text-ink-muted">Installed base</dt>
          <dd className="text-ink">{s.installBase ? `${s.installBase.object}: ${[s.installBase.product, s.installBase.value, s.installBase.quantity].filter(Boolean).join(", ")}` : "Not read"}</dd>
          <dt className="text-ink-muted">Scorecard goes to</dt>
          <dd className="text-ink">{[s.qualification.combined, ...Object.values(s.qualification.fields)].filter(Boolean).join(", ") || "Nowhere yet"}</dd>
        </dl>
      </Section>

      <Section title="What went where" aside={<span>last {log.length}</span>}>
        {log.length === 0 ? (
          <p className="text-label text-ink-muted">Nothing read or written yet.</p>
        ) : (
          <ul className="divide-y divide-line text-label" data-testid="sf-log">
            {log.map((l) => (
              <li key={l.id} className="py-2">
                <span className={`font-semibold ${l.status === "failed" ? "text-danger" : "text-ink"}`}>{l.direction === "write" ? "Wrote" : l.direction === "read" ? "Read" : "Checked"}</span>{" "}
                <span className="text-ink">{l.summary}</span>
                <span className="block text-micro text-ink-muted">
                  {fmtWhen(l.at)}
                  {l.user_id ? ` · ${names.get(l.user_id) ?? "someone"}` : ""}
                  {l.error ? ` · ${l.error}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Page>
  );
}
