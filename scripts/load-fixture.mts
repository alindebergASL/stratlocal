// SYNTHETIC ONLY: generated toy accounts; no customer-derived values or prose.
import { applyEntityChange } from "../lib/proposals/apply";
import { db } from "../lib/db";
import { acceptNote, storeDraftNote } from "../lib/research/notes";
import { DOSSIER_TOPICS } from "../lib/research/coverage";

if (!process.env.DB_PATH) {
  console.error("Set DB_PATH. Refusing to write to the default database, which is probably the one you are using.");
  process.exit(2);
}

const USER = "user-1";
const THEM = "user-2";

// Fifteen accounts is the top of the range this app was built for ("5-15 key
// accounts"), which is the number worth being fast at.
const ACCOUNTS = Number(process.env.FIXTURE_ACCOUNTS ?? 15);
const DEALS = Number(process.env.FIXTURE_DEALS ?? 40);
const CONTACTS = Number(process.env.FIXTURE_CONTACTS ?? 25);
const MEETINGS = Number(process.env.FIXTURE_MEETINGS ?? 30);
const FOLLOW_UPS = Number(process.env.FIXTURE_FOLLOW_UPS ?? 20);
const PLAYS = Number(process.env.FIXTURE_PLAYS ?? 8);
const NOTES = Number(process.env.FIXTURE_NOTES ?? 4);
const FINDINGS = Number(process.env.FIXTURE_FINDINGS ?? 50);
// A year of quarterly reports by default. Overridable like the rest, because
// the question "does install_base need its own index" can only be answered by
// measuring at a volume bigger than the default (Phase 11's rule: an unused
// index is a cost on every write).
const SNAPSHOTS = Number(process.env.FIXTURE_SNAPSHOTS ?? 4);
const FAMILIES = Number(process.env.FIXTURE_FAMILIES ?? 8);

// Quarterly, walking backwards from the most recent quarter, so more snapshots
// means more history rather than dates running off the end of the year.
function asOfFor(q: number): string {
  const monthsBack = (SNAPSHOTS - 1 - q) * 3;
  const d = new Date(Date.UTC(2026, 9 - monthsBack, 1));
  return d.toISOString().slice(0, 10);
}

// Fictional throughout, and obviously so. tests/fixtures is synthetic by
// decision (DECISIONS #5) and a fixture that generates plausible-looking
// customer names would be the first thing to get mistaken for real data.
const PLACES = ["Synthetic Orchard", "Synthetic Meadow", "Synthetic Pebble", "Synthetic Cloud"];
const KINDS = ["Lab", "Sandbox", "Workshop"];
const FIRST = ["Avery", "Blake", "Casey", "Drew"];
const LAST = ["Example"];

const pick = <T,>(list: T[], i: number): T => list[i % list.length]!;
const started = Date.now();

for (let a = 0; a < ACCOUNTS; a += 1) {
  const accountId = applyEntityChange({
    accountId: "",
    entityType: "account",
    op: "create",
    payload: {
      name: `${pick(PLACES, a)} ${pick(KINDS, a)} ${a}`,
      crm_id: `SYN-LOAD-ACCOUNT-${a}`,
      region: pick(["Central", "West", "East", "South"], a),
      segment: pick(["Enterprise", "Public Sector", "Commercial"], a),
      thesis: "A fictional sandbox compares two toy configurations.",
      // Whose account it is, in thirds — one each and one they share — so the
      // mine/theirs/shared filters are measured against a database where all
      // three answers return rows.
      owner_user_id: a % 3 === 0 ? USER : a % 3 === 1 ? THEM : null,
    },
    actorUserId: a % 2 === 0 ? USER : THEM,
  }).entityId;

  const dealIds: string[] = [];
  for (let d = 0; d < DEALS; d += 1) {
    dealIds.push(
      applyEntityChange({
        accountId,
        entityType: "deal",
        op: "create",
        payload: {
          deal_id: `SYN-LOAD-${a}-${d}`,
          name: `${pick(["Core refresh", "Site expansion", "Fabric upgrade", "Storage tier", "Edge rollout"], d)} ${d}`,
          stage: (d % 6) + 1,
          close_date: `2027-${String((d % 12) + 1).padStart(2, "0")}-${String((d % 27) + 1).padStart(2, "0")}`,
          tcv_usd: 100 * (d + 1),
          owner: `${pick(FIRST, d)} ${pick(LAST, d)}`,
          next_step: d % 3 === 0 ? "" : "Run the next sandbox check",
          status: d % 11 === 0 ? "won" : "open",
        },
        actorUserId: d % 2 === 0 ? USER : THEM,
      }).entityId,
    );
  }

  const contactIds: string[] = [];
  for (let c = 0; c < CONTACTS; c += 1) {
    contactIds.push(
      applyEntityChange({
        accountId,
        entityType: "contact",
        op: "create",
        payload: {
          name: `${pick(FIRST, c)} ${pick(LAST, c + 3)}`,
          org: c % 5 === 0 ? "vendor" : c % 7 === 0 ? "partner" : "customer",
          title: pick(["Director of Infrastructure", "Network Architect", "CIO", "Storage Lead"], c),
          email: `person${c}@example.com`,
        },
        actorUserId: USER,
      }).entityId,
    );
  }

  for (let m = 0; m < MEETINGS; m += 1) {
    const id = applyEntityChange({
      accountId,
      entityType: "meeting",
      op: "create",
      payload: {
        title: pick(["Quarterly review", "Architecture session", "Sizing call", "Exec check-in"], m),
        held_at: `2026-${String((m % 12) + 1).padStart(2, "0")}-${String((m % 27) + 1).padStart(2, "0")}`,
        // Most have a time, some do not — which is the real mix, and the one
        // the ordering has to handle.
        held_time: m % 4 === 3 ? null : `${String(8 + (m % 9)).padStart(2, "0")}:${m % 2 === 0 ? "00" : "30"}`,
        attendees: [{ contact_id: contactIds[m % contactIds.length]!, name: "Someone", note: null }],
      },
      actorUserId: m % 2 === 0 ? USER : THEM,
    }).entityId;
    // A second write, because a meeting that has happened has notes and a
    // summary — and because two writes per meeting is what makes change_log
    // the size it really gets to.
    applyEntityChange({
      accountId,
      entityType: "meeting",
      op: "update",
      entityId: id,
      payload: {
        raw_notes: "The fictional workshop compared toy configuration cards. ".repeat(40),
        summary: "Synthetic workshop complete; compare another toy option next time.",
      },
      actorUserId: m % 2 === 0 ? USER : THEM,
    });
  }

  // Plays, which the fixture never made — so the section that renders one card
  // per play, and now the page each one has, were measured at zero.
  for (let i = 0; i < PLAYS; i += 1) {
    applyEntityChange({
      accountId,
      entityType: "play",
      op: "create",
      payload: {
        title: `${pick(["Hold the platform", "Displace the incumbent", "Fund the refresh", "Win the fabric"], i)} ${i}`,
        thesis: "This fabricated exercise tests linked records in a toy sandbox.",
        status: pick(["proposed", "active", "active", "stalled"], i),
        owner: `${pick(FIRST, i)} ${pick(LAST, i)}`,
        next_step: i % 4 === 0 ? "" : "Schedule another fictional workshop",
        // Linked to a handful each, which is what makes the edit form on the
        // account page expensive: a checkbox per deal and per contact, per play.
        deal_ids: dealIds.slice(i, i + 3),
        contact_ids: contactIds.slice(i, i + 2),
      },
      actorUserId: USER,
    });
  }

  for (let i = 0; i < FOLLOW_UPS; i += 1) {
    applyEntityChange({
      accountId,
      entityType: "action_item",
      op: "create",
      payload: {
        text: `Send the ${pick(["sizing", "migration", "licensing", "support"], i)} document`,
        status: "open",
        // A third of them past due, which is what makes Home the size it gets
        // to: the attention list has no cap and every one of these lands on it.
        due: i % 3 === 0 ? "2026-06-01" : null,
        owner_user_id: i % 2 === 0 ? USER : THEM,
      },
      actorUserId: USER,
    });
  }

  // Research, which this fixture had none of — so the one page whose whole
  // subject is research could not be measured at volume, and the budget
  // guarding it was guarding a three-finding demo note. A real dossier runs
  // to forty or fifty findings across the seven topics; the extraction tests
  // fixture fifty-six on purpose.
  for (let n = 0; n < NOTES; n += 1) {
    // The run row is written here rather than through startRun: that refuses
    // when a provider is unconfigured, and a load fixture that needs an API
    // key to seed rows nobody will call a model for is a trap. Nothing is
    // billed and nothing is called; documents.ai_run_id just needs a row.
    const runId = `syn-research-${a}-${n}`;
    db()
      .prepare(
        `INSERT INTO ai_runs (id, account_id, kind, provider, model, status, cost_cents, created_by, started_at, finished_at)
         VALUES (?, ?, 'research', 'direct', 'fixture', 'done', 0, ?, ?, ?)`,
      )
      .run(runId, accountId, USER, started, started);
    const findings = Array.from({ length: FINDINGS }, (_, i) => ({
      text: `Synthetic sandbox statement ${i} about a fictional configuration, long enough to wrap the way a real finding does.`,
      quote: `Synthetic sandbox statement ${i} about a fictional configuration, long enough to wrap the way a real finding does.`,
      url: `https://www.example.com/synthetic/${a}/${n}/${i}`,
      confidence: pick(["high", "medium", "low"] as const, i),
      date: null,
      topic: pick([...DOSSIER_TOPICS], i),
    }));
    const doc = storeDraftNote({
      accountId,
      userId: USER,
      aiRunId: runId,
      note: {
        title: `Synthetic public record ${n}`,
        summary: "A fictional summary of a fictional public record, written to be read rather than assembled from the findings below.",
        findings,
        open_questions: ["A fictional question the pass did not answer."],
      },
      prose: findings.map((f) => f.quote).join("\n"),
      sources: findings.map((f) => f.url),
      focus: null,
      depth: "deep",
      searches: 8,
      fetches: 5,
      dropped: [],
    });
    // Most kept, a few not, because the kept/total line is real on this page.
    acceptNote(doc.id, findings.flatMap((_, i) => (i % 9 === 0 ? [] : [i])), USER);
  }

  for (let q = 0; q < SNAPSHOTS; q += 1) {
    for (let f = 0; f < FAMILIES; f += 1) {
      applyEntityChange({
        accountId,
        entityType: "install_base",
        op: "create",
        payload: {
          product_family: `Family ${f}`,
          value_usd: 100 * (q + 1),
          share_pct: 100 / FAMILIES,
          as_of: asOfFor(q),
        },
        actorUserId: USER,
      });
    }
  }
}

const counts = db()
  .prepare(
    `SELECT (SELECT COUNT(*) FROM accounts) accounts, (SELECT COUNT(*) FROM deals) deals,
            (SELECT COUNT(*) FROM contacts) contacts, (SELECT COUNT(*) FROM meetings) meetings,
            (SELECT COUNT(*) FROM plays) plays,
            (SELECT COUNT(*) FROM action_items) follow_ups, (SELECT COUNT(*) FROM install_base) install_base,
            (SELECT COUNT(*) FROM change_log) change_log`,
  )
  .get() as Record<string, number>;

console.log(`seeded ${process.env.DB_PATH} in ${Date.now() - started}ms`);
console.log(
  Object.entries(counts)
    .map(([k, v]) => `  ${String(v).padStart(6)} ${k.replace(/_/g, " ")}`)
    .join("\n"),
);

// --- the queries behind the slow pages ---------------------------------------

if (process.argv.includes("--measure")) {
  const { listAccountSummaries, listOpenDeals, installBaseTrend } = await import("../lib/queries/accounts");
  const { recentChanges, dayCounts, upcomingMeetings } = await import("../lib/queries/today");
  const { listAttention } = await import("../lib/queries/attention");
  const { listOpenFollowUps } = await import("../lib/queries/meetings");
  const { search } = await import("../lib/queries/search");

  const first = listAccountSummaries()[0]!.id;
  const cases: Array<[string, () => unknown]> = [
    ["listAccountSummaries (Home, nav)", () => listAccountSummaries()],
    ["listAttention (Home)", () => listAttention()],
    ["dayCounts (Home)", () => dayCounts()],
    ["upcomingMeetings (Home)", () => upcomingMeetings()],
    ["recentChanges 3d (Home)", () => recentChanges(Date.now() - 3 * 86_400_000)],
    ["recentChanges 30d (/activity)", () => recentChanges(Date.now() - 30 * 86_400_000)],
    ["listOpenDeals (/pipeline)", () => listOpenDeals({})],
    ["listOpenFollowUps (/follow-ups)", () => listOpenFollowUps({})],
    ["installBaseTrend (account)", () => installBaseTrend(first).rows],
    ["search (/search)", () => search("storage")],
  ];

  console.log("\n  each query, warm:");
  for (const [label, fn] of cases) {
    fn(); // warm: the first call pays for statement preparation
    const s = process.hrtime.bigint();
    const r = fn();
    const ms = Number(process.hrtime.bigint() - s) / 1e6;
    console.log(`  ${ms.toFixed(1).padStart(8)}ms  ${label}${Array.isArray(r) ? ` (${r.length} rows)` : ""}`);
  }
}
