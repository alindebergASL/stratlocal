// A JSON export read straight into the import's extraction, with no model.
//
// Two shapes are taken. The extraction itself (what the model returns, so an
// export saved from another copy of this app round-trips), and a simpler one
// a person or a script can write by hand:
//
//   { "account": { "name": "…" }, "team": [], "deals": [], "install_base": [], "plays": [] }
//
// Every key is optional, and every field inside a row is optional except the
// ones that identify it (deal_id and name, product_family, title, a person's
// name). Anything else in the file is ignored. A file that fits neither
// shape is read by the model as text instead, like any other document.
import { z } from "zod";
import { AgentReportExtraction, ExtractedDeal, ExtractedInstallBase, ExtractedPlay, ExtractedTeamMember } from "./extractSchema";
import { sanitizeExtraction } from "./extract";

const opt = <T extends z.ZodType>(s: T) => s.nullish().transform((v) => v ?? null);
const str = opt(z.coerce.string().trim().min(1));
const int = opt(z.coerce.number().int().min(0));

const Deal = z.object({
  deal_id: z.coerce.string().trim(),
  name: z.coerce.string().trim().min(1),
  stage: opt(z.coerce.number().int().min(1).max(6)),
  stage_label: str,
  close_date: opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  fiscal_quarter: str,
  tcv_usd: int,
  competitor: str,
  partner: str,
  owner: str,
  architecture: str,
});
const Team = z.object({ name: z.coerce.string().trim().min(1), email: str, role: opt(ExtractedTeamMember.shape.role.unwrap()), title: str });
const Install = z.object({ product_family: z.coerce.string().trim().min(1), value_usd: int, share_pct: opt(z.coerce.number().min(0).max(100)), role_note: str });
const Play = z.object({
  title: z.coerce.string().trim().min(1),
  thesis: str,
  deal_ids: z.array(z.coerce.string()).nullish().transform((v) => v ?? []),
  stakeholders: z.array(z.coerce.string()).nullish().transform((v) => v ?? []),
  next_step: str,
});
const Simple = z.object({
  account: z
    .object({ name: str, crm_id: str, legal_entity: str, region: str, segment: str, hq: str, summary: str })
    .partial()
    .nullish(),
  team: z.array(Team).nullish(),
  deals: z.array(Deal).nullish(),
  install_base: z.array(Install).nullish(),
  plays: z.array(Play).nullish(),
});

export type JsonImport = { extraction: AgentReportExtraction; dropped: string[] };

/**
 * The extraction a JSON file states outright, or null when it is not one of
 * the two shapes (or states nothing at all). `accountName` fills a missing
 * account name; the import never renames an account from a blank anyway.
 */
export function jsonExtraction(text: string, accountName: string): JsonImport | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const exact = AgentReportExtraction.safeParse(raw);
  const parsed = exact.success ? null : Simple.safeParse(raw);
  if (!exact.success && !parsed?.success) return null;
  const s = parsed?.success ? parsed.data : null;
  const extraction: AgentReportExtraction = exact.success
    ? exact.data
    : {
        account: {
          name: s!.account?.name ?? accountName,
          crm_id: s!.account?.crm_id ?? null,
          legal_entity: s!.account?.legal_entity ?? null,
          region: s!.account?.region ?? null,
          segment: s!.account?.segment ?? null,
          hq: s!.account?.hq ?? null,
          summary: s!.account?.summary ?? null,
        },
        team: s!.team ?? [],
        deals: s!.deals ?? [],
        install_base: s!.install_base ?? [],
        plays: s!.plays ?? [],
        kpis: [],
      };
  if (!extraction.deals.length && !extraction.team.length && !extraction.install_base.length && !extraction.plays.length) return null;
  // A deal id has to be one the CRM could hold; a row that is not is dropped
  // by name, as the model path drops an id it cannot show in the text.
  const dropped: string[] = [];
  extraction.deals = extraction.deals.filter((d) => {
    const ok = ExtractedDeal.safeParse(d).success;
    if (!ok) dropped.push(`deal ${d.deal_id || "(no id)"}`);
    return ok;
  });
  extraction.install_base = extraction.install_base.filter((r) => ExtractedInstallBase.safeParse(r).success);
  extraction.plays = extraction.plays.filter((p) => ExtractedPlay.safeParse(p).success);
  // The same clean-up the model's output gets: plays keep only known deal ids,
  // TOTAL rows go, and an address a contact would refuse is dropped.
  const clean = sanitizeExtraction(extraction, text);
  return { extraction: clean.extraction, dropped: [...dropped, ...clean.dropped] };
}
