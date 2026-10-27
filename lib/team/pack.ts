// A team pack: everything a team has set up that another team could start
// from, in one file. The playbook, the team direction, saved report
// templates, which assistants are on and their limits, the app's name and
// deck colour, and the Salesforce mapping (never credentials, and never
// switched on by a load). No account, person or record is ever in it.
//
// Loading one is shown first (what it holds, what it would change) and
// applied by an admin; every part goes through the same save as its own
// settings page, so the playbook and direction keep their history.
import { z } from "zod";
import { db } from "../db";
import { ApplyError } from "../proposals/apply";
import { findUserById } from "../auth";
import { Playbook } from "../playbook/schema";
import { STARTER_PLAYBOOK } from "../playbook/starter";
import { createPlaybook, currentPlaybook, listPlaybooks, playbookProblems, savePlaybook } from "../playbook/store";
import { currentDirection, saveDirection } from "../teamDirection";
import { listTemplates, saveTemplate } from "../ask/templates";
import { allAssistantSettings, saveAssistant } from "../assistants/settings";
import { ASSISTANTS, isAssistantId } from "../assistants/registry";
import { branding, saveBranding } from "./branding";
import { SalesforceSettings, salesforceSettings, saveSalesforceSettings } from "../salesforce/config";

export const PACK_KIND = "team_pack";
export const PACK_VERSION = 1;

const Direction = z.object({ focusAreas: z.array(z.string()).max(12), goals: z.string().nullable(), signals: z.string().nullable(), avoid: z.string().nullable() });
const Template = z.object({ name: z.string().min(2).max(80), question: z.string().min(2).max(4000), sections: z.array(z.string().min(1).max(200)).min(1).max(12), scope: z.enum(["all", "account"]) });
const AssistantPart = z.object({ id: z.string(), mode: z.enum(["off", "ask", "auto"]), monthlyCents: z.number().int().min(0) });

export const TeamPack = z
  .object({
    kind: z.literal(PACK_KIND),
    version: z.literal(PACK_VERSION),
    exported_at: z.string().optional(),
    name: z.string().max(120).optional(),
    /** The default playbook. */
    playbook: z.unknown().nullable().default(null),
    /** Any others the team keeps, by name (DECISIONS #83). */
    others: z.array(z.object({ name: z.string().min(1).max(120), playbook: z.unknown() })).max(10).default([]),
    direction: Direction.nullable().default(null),
    templates: z.array(Template).max(50).default([]),
    assistants: z.array(AssistantPart).max(20).default([]),
    branding: z.object({ appName: z.string().max(40).optional(), teamName: z.string().max(80).nullable().optional(), accent: z.string().optional() }).nullable().default(null),
    salesforce: z.unknown().nullable().default(null),
  })
  .strict();
export type TeamPack = z.infer<typeof TeamPack>;

export function exportPack(name?: string): TeamPack {
  const d = currentDirection();
  const b = branding();
  const sf = salesforceSettings();
  return {
    kind: PACK_KIND,
    version: PACK_VERSION,
    exported_at: new Date().toISOString(),
    name: name ?? b.teamName ?? b.appName,
    playbook: currentPlaybook()?.playbook ?? null,
    others: listPlaybooks().filter((p) => !p.isDefault).map((p) => ({ name: p.name, playbook: currentPlaybook({ slug: p.slug })!.playbook })),
    direction: d ? { focusAreas: d.focusAreas, goals: d.goals, signals: d.signals, avoid: d.avoid } : null,
    templates: listTemplates().filter((t) => !t.builtIn).map((t) => ({ name: t.name, question: t.question, sections: t.sections, scope: t.scope })),
    assistants: allAssistantSettings().map((s) => ({ id: s.id, mode: s.mode, monthlyCents: s.monthlyCents })),
    // The logo stays behind: it is the team's own mark, not a setting.
    branding: { appName: b.appName, teamName: b.teamName, accent: b.accent },
    // The mapping only; whether it is on, and every credential, stay on the box.
    salesforce: { ...sf, enabled: false },
  };
}

/** The neutral starter: the starter playbook and nothing else. Names nobody. */
export function starterPack(): TeamPack {
  return TeamPack.parse({ kind: PACK_KIND, version: PACK_VERSION, name: "Neutral starter", playbook: STARTER_PLAYBOOK });
}

export type PackPreview = { ok: true; pack: TeamPack; lines: string[]; problems: string[] } | { ok: false; error: string };

export function readPack(text: string): PackPreview {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not JSON." };
  }
  const parsed = TeamPack.safeParse(raw);
  if (!parsed.success) {
    const kind = (raw as { kind?: unknown })?.kind;
    return { ok: false, error: kind === "playbook" ? "That is a playbook file; load it on the Playbook page." : `That is not a team pack: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "file"}: ${i.message}`).join("; ")}` };
  }
  const pack = parsed.data;
  const problems: string[] = [];
  const lines: string[] = [];
  if (pack.playbook) {
    const p = playbookProblems(pack.playbook);
    if (p) problems.push(...p.map((x) => `Playbook: ${x}`));
    else {
      const pb = Playbook.parse(pack.playbook);
      lines.push(`Playbook "${pb.name}": ${pb.steps.length} steps, ${pb.archetypes.length} archetypes, ${pb.questions.length} questions. It becomes the playbook; the current one stays restorable.`);
    }
  }
  if (pack.others.length) {
    const have = new Set(listPlaybooks().map((p) => p.name.toLowerCase()));
    const fresh = pack.others.filter((o) => !have.has(o.name.toLowerCase()));
    if (pack.others.some((o) => playbookProblems(o.playbook))) problems.push("One of the other playbooks has problems and would be skipped.");
    lines.push(`Other playbooks: ${fresh.length} new${pack.others.length - fresh.length ? `, ${pack.others.length - fresh.length} already here by name and left alone` : ""}.`);
  }
  if (pack.direction) lines.push(`Team direction: ${pack.direction.focusAreas.length} focus areas. It becomes the direction; the current one stays in its history.`);
  const have = new Set(listTemplates().map((t) => t.name.toLowerCase()));
  const newTemplates = pack.templates.filter((t) => !have.has(t.name.toLowerCase()));
  if (pack.templates.length) lines.push(`Report templates: ${newTemplates.length} new${pack.templates.length - newTemplates.length ? `, ${pack.templates.length - newTemplates.length} already here by name and left alone` : ""}.`);
  const known = pack.assistants.filter((a) => isAssistantId(a.id));
  if (known.length) lines.push(`Assistants: ${known.filter((a) => a.mode !== "off").map((a) => ASSISTANTS.find((d) => d.id === a.id)!.name).join(", ") || "all off"}${known.some((a) => a.mode !== "off") ? " on" : ""}, with the pack's limits where the budget allows.`);
  if (pack.branding) lines.push(`App name "${pack.branding.appName ?? branding().appName}"${pack.branding.teamName ? `, team "${pack.branding.teamName}"` : ""}${pack.branding.accent ? `, deck colour #${pack.branding.accent.replace(/^#/, "")}` : ""}.`);
  if (pack.salesforce) {
    const sf = SalesforceSettings.safeParse({ ...(pack.salesforce as object), enabled: false });
    if (sf.success) lines.push("Salesforce mapping (what to read, where the scorecard goes). The connection stays off until someone turns it on.");
    else problems.push("Salesforce: the mapping is not valid and would be skipped.");
  }
  if (!lines.length && !problems.length) lines.push("Nothing in it to load.");
  return { ok: true, pack, lines, problems };
}

export function applyPack(text: string, userId: string): { applied: string[]; skipped: string[] } {
  const user = findUserById(userId);
  if (!user || user.deactivated_at || !user.is_admin) throw new ApplyError("Only an admin can load a team pack.", "state");
  const preview = readPack(text);
  if (!preview.ok) throw new ApplyError(preview.error, "validation");
  const { pack } = preview;
  const applied: string[] = [];
  const skipped: string[] = [];
  db().transaction(() => {
    if (pack.playbook) {
      if (playbookProblems(pack.playbook)) skipped.push("the playbook (it has problems)");
      else {
        savePlaybook({ playbook: Playbook.parse(pack.playbook), note: `Loaded from team pack${pack.name ? ` "${pack.name}"` : ""}`, userId, basisId: currentPlaybook()?.id ?? null });
        applied.push("playbook");
      }
    }
    let made = 0;
    for (const o of pack.others) {
      if (playbookProblems(o.playbook)) {
        skipped.push(`the playbook "${o.name}" (it has problems)`);
        continue;
      }
      if (listPlaybooks().some((p) => p.name.toLowerCase() === o.name.toLowerCase())) continue;
      createPlaybook({ name: o.name, from: Playbook.parse(o.playbook), userId });
      made++;
    }
    if (made) applied.push(`${made} other playbook${made === 1 ? "" : "s"}`);
    if (pack.direction) {
      saveDirection({ ...pack.direction, userId, basisId: currentDirection()?.id ?? null });
      applied.push("team direction");
    }
    const have = new Set(listTemplates().map((t) => t.name.toLowerCase()));
    let added = 0;
    for (const t of pack.templates) {
      if (have.has(t.name.toLowerCase())) continue;
      saveTemplate({ ...t, userId });
      added++;
    }
    if (added) applied.push(`${added} report template${added === 1 ? "" : "s"}`);
    let switched = 0;
    for (const a of pack.assistants) {
      if (!isAssistantId(a.id) || ASSISTANTS.find((d) => d.id === a.id)?.availability !== "modes") continue;
      try {
        saveAssistant(a.id, { mode: a.mode, monthlyCents: a.monthlyCents }, userId);
        switched++;
      } catch (e) {
        skipped.push(`${ASSISTANTS.find((d) => d.id === a.id)!.name} (${e instanceof Error ? e.message : String(e)})`);
      }
    }
    if (switched) applied.push("assistant settings");
    if (pack.branding) {
      const b = branding();
      saveBranding({ ...b, ...Object.fromEntries(Object.entries(pack.branding).filter(([, v]) => v !== undefined)) }, userId);
      applied.push("name and colour");
    }
    if (pack.salesforce) {
      const sf = SalesforceSettings.safeParse({ ...(pack.salesforce as object), enabled: false });
      if (sf.success) {
        saveSalesforceSettings({ ...sf.data, enabled: salesforceSettings().enabled }, userId);
        applied.push("Salesforce mapping");
      } else skipped.push("the Salesforce mapping (not valid)");
    }
  })();
  return { applied, skipped };
}
