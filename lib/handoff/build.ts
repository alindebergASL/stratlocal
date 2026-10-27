// Reading the account once, into the shape that gets stored.
//
// Everything here is a read; nothing is written. The caps are the same ones
// the screens use, and for the same reason (DECISIONS #20) — except that a
// handoff has no "show all", because there is nowhere for the reader to go.
// So a cap here is a real decision about what the other team is told, and each
// one keeps the most consequential rows rather than the first ones the query
// returned.
import { latestInstallBase, listContacts, listDeals, listPlays } from "../queries/accounts";
import { byWhen, listActionItems, listMeetings } from "../queries/meetings";
import { keptFindings, listNotes } from "../research/notes";
import type { AccountRow } from "../db";
import { currentFiscalQuarter } from "../fiscal";
import { crmIdText, parseJsonArray } from "../format";
import { todayISO } from "../clock";
import { HandoffReport } from "./schema";

// Enough to hand over, not everything on file. A handoff nobody finishes
// reading is worse than a shorter one.
const MEETINGS = 8;
const NOTES = 3;
const FINDINGS = 8;
// The schema caps this one too (`HandoffInstallBase.rows.max(100)`), and this
// was the only cap with no slice in front of it — so a snapshot over the limit
// did not make a shorter handoff, it made a ZodError and no handoff at all.
// `latestInstallBase` orders by value descending, so slicing keeps the largest
// families, which is what the header above promises every cap here does.
const INSTALL_BASE = 100;

export function buildHandoff(input: { account: AccountRow; by: string; asks: string; note: string | null; now?: Date }): HandoffReport {
  const { account } = input;
  const now = input.now ?? new Date();
  const today = todayISO(now);

  const deals = listDeals(account.id).filter((d) => d.status === "open");
  const contacts = listContacts(account.id);
  // A dropped play is a decision not to do something, which is worth keeping
  // on the working screen and is noise on a hand-over.
  const plays = listPlays(account.id).filter((p) => p.status !== "dropped");
  const dealName = new Map(listDeals(account.id, { includeArchived: true }).map((d) => [d.deal_id, d.name]));
  const contactName = new Map(listContacts(account.id, { includeArchived: true }).map((c) => [c.id, c.name]));
  const install = latestInstallBase(account.id);

  const report: HandoffReport = {
    v: 1,
    generated_at: today,
    generated_by: input.by,
    account: {
      name: account.name,
      crm_id: account.crm_id,
      legal_entity: account.legal_entity,
      region: account.region,
      segment: account.segment,
      hq: account.hq,
      thesis: account.thesis,
    },
    quarter: currentFiscalQuarter(now).label,
    open_pipeline_usd: deals.reduce((s, d) => s + (d.tcv_usd ?? 0), 0),
    deals: deals.map((d) => ({
      // A local id is this app's own placeholder and means nothing to the
      // team receiving this, so it is omitted rather than printed — the same
      // decision the printable one-pager already made.
      crm_id: crmIdText(d.deal_id) || null,
      name: d.name,
      stage: d.stage,
      stage_label: d.stage_label,
      close_date: d.close_date,
      fiscal_quarter: d.fiscal_quarter,
      tcv_usd: d.tcv_usd,
      owner: d.owner,
      next_step: d.next_step,
      competitor: d.competitor,
      partner: d.partner,
    })),
    plays: plays.map((p) => ({
      title: p.title,
      status: p.status,
      thesis: p.thesis,
      owner: p.owner,
      next_step: p.next_step,
      next_step_due: p.next_step_due,
      deals: parseJsonArray(p.deal_ids_json).map((id) => dealName.get(id) ?? id),
      people: parseJsonArray(p.contact_ids_json).map((id) => contactName.get(id) ?? id),
    })),
    contacts: contacts.map((c) => ({
      name: c.name,
      title: c.title,
      org: c.org,
      role: c.role,
      email: c.email,
      notes: c.notes,
    })),
    install_base: {
      as_of: install.asOf,
      rows: install.rows.slice(0, INSTALL_BASE).map((r) => ({
        product_family: r.product_family,
        value_usd: r.value_usd,
        share_pct: r.share_pct,
        role_note: r.role_note,
      })),
    },
    research: listNotes(account.id, "accepted")
      .slice(0, NOTES)
      .map((n) => ({
        title: n.meta.title,
        summary: keptFindings(n.meta)
          .map((f) => f.text)
          .join(" ")
          .slice(0, 1200),
        findings: keptFindings(n.meta)
          .slice(0, FINDINGS)
          .map((f) => ({ text: f.text, url: f.url, confidence: f.confidence })),
      })),
    // The meetings that have happened, newest first — a hand-over is about
    // what was said, and what is in the diary is the receiving team's problem
    // now rather than a record of anything.
    meetings: listMeetings(account.id)
      .filter((m) => m.held_at.slice(0, 10) <= today)
      .sort((a, b) => byWhen(b, a))
      .slice(0, MEETINGS)
      .map((m) => ({
        title: m.title,
        held_at: m.held_at.slice(0, 10),
        summary: m.summary,
      })),
    follow_ups: listActionItems(account.id, { status: "open" }).map((i) => ({
      text: i.text,
      owner: i.owner,
      due: i.due,
    })),
    asks: input.asks,
    note: input.note,
  };

  // Parsed on the way out as well as on the way in. The caps above are the
  // schema's too, and a field that outgrew one should fail here — while the
  // person is still on the page that can say so — rather than when the link
  // is opened by somebody who cannot do anything about it.
  return HandoffReport.parse(report);
}
