"use server";
import { revalidatePath } from "next/cache";
import { requirePageUser } from "@/lib/auth";
import { saveSalesforceSettings } from "@/lib/salesforce/config";
import { checkSalesforce } from "@/lib/salesforce/sync";
import { MEDDPICC } from "@/lib/playbook/schema";

type FormResult = { ok: true } | { ok: false; error: string };
const opt = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim() || null;

export async function saveSalesforceAction(fd: FormData): Promise<FormResult> {
  const user = await requirePageUser();
  const object = opt(fd, "ib_object");
  const product = opt(fd, "ib_product");
  try {
    saveSalesforceSettings(
      {
        enabled: fd.get("enabled") === "on",
        mode: fd.get("mode") === "mcp" ? "mcp" : "rest",
        installBase: object && product ? { object, product, value: opt(fd, "ib_value"), quantity: opt(fd, "ib_quantity") } : null,
        qualification: {
          combined: opt(fd, "q_combined"),
          fields: Object.fromEntries(MEDDPICC.map((e) => [e, opt(fd, `q_${e}`)]).filter(([, v]) => v)),
        },
        mcpQueryTool: opt(fd, "mcp_query") ?? "soql_query",
        mcpUpdateTool: opt(fd, "mcp_update"),
      },
      user.id,
    );
  } catch (e) {
    const issues = (e as { issues?: Array<{ path: unknown[]; message: string }> }).issues;
    return { ok: false, error: issues ? issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : String(e) };
  }
  revalidatePath("/settings/salesforce");
  return { ok: true };
}

export async function checkSalesforceAction(): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const user = await requirePageUser();
  const r = await checkSalesforce(user.id);
  revalidatePath("/settings/salesforce");
  return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
}
