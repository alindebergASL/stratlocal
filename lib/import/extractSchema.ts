import { z } from "zod";
import { ContactRole } from "../proposals/schema";

const nstr = z.string().nullable();

export const ExtractedDeal = z.object({
  deal_id: z.string().regex(/^[A-Za-z0-9_-]{4,32}$/),
  name: z.string().min(1),
  stage: z.number().int().min(1).max(6).nullable(),
  stage_label: nstr,
  close_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  fiscal_quarter: nstr,
  tcv_usd: z.number().int().min(0).nullable(),
  competitor: nstr,
  partner: nstr,
  owner: nstr,
  architecture: nstr,
});

export const ExtractedTeamMember = z.object({
  name: z.string().min(1),
  email: nstr,
  role: ContactRole.nullable(),
  title: nstr,
});

export const ExtractedInstallBase = z.object({
  product_family: z.string().min(1),
  value_usd: z.number().int().min(0).nullable(),
  share_pct: z.number().min(0).max(100).nullable(),
  role_note: nstr,
});

export const ExtractedPlay = z.object({
  title: z.string().min(1),
  thesis: nstr,
  deal_ids: z.array(z.string()),
  stakeholders: z.array(z.string()),
  next_step: nstr,
});

export const AgentReportExtraction = z.object({
  account: z.object({
    name: z.string().min(1),
    crm_id: nstr,
    legal_entity: nstr,
    region: nstr,
    segment: nstr,
    hq: nstr,
    summary: nstr,
  }),
  team: z.array(ExtractedTeamMember),
  deals: z.array(ExtractedDeal),
  install_base: z.array(ExtractedInstallBase),
  plays: z.array(ExtractedPlay),
  kpis: z.array(z.object({ label: z.string(), value: z.string(), sub: nstr })),
});

export type AgentReportExtraction = z.infer<typeof AgentReportExtraction>;
export type ExtractedDeal = z.infer<typeof ExtractedDeal>;
