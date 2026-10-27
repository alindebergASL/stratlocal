// AI_FAKE=1 replaces every model call with canned data so the whole pipeline
// (runs, budgets, proposals, review) can be exercised locally and in tests
// without credentials. The canned import answer matches
// tests/fixtures/agent-report.html, which is synthetic.
import type { Role } from "./models";
import { STARTER_PLAYBOOK } from "../playbook/starter";

export function fakeEnabled(): boolean {
  return process.env.AI_FAKE === "1";
}

// SYNTHETIC ONLY: independently invented toy amounts, sequential IDs and prose.
const IMPORT = {
  "account": {
    "name": "Synthetic Orchard Lab",
    "crm_id": "SYN-ACCOUNT-001",
    "legal_entity": "SYNTHETIC ORCHARD ENTITY",
    "region": "Synthetic Region",
    "segment": null,
    "hq": "Example Town",
    "summary": "Fully fabricated sandbox account for import tests; not customer data."
  },
  "team": [
    {
      "name": "Avery Example",
      "email": "avery.example@example.com",
      "role": "specialist_ae",
      "title": "Specialist AE (DC)"
    },
    {
      "name": "Blake Example",
      "email": "blake.example@example.com",
      "role": "specialist_se",
      "title": "Specialist Lead SE"
    },
    {
      "name": "Casey Example",
      "email": null,
      "role": "ae",
      "title": null
    },
    {
      "name": "Drew Example",
      "email": null,
      "role": "ae",
      "title": null
    },
    {
      "name": "Emery Example",
      "email": null,
      "role": "se",
      "title": null
    }
  ],
  "deals": [
    {
      "deal_id": "SYN-DEAL-001",
      "name": "SyntheticOrchard_EHR-Refresh",
      "stage": 3,
      "stage_label": "Tech Validation",
      "close_date": "2026-12-01",
      "fiscal_quarter": "FY27 Q2",
      "tcv_usd": 1000,
      "competitor": "Synthetic Rival A",
      "partner": "Synthetic Partner A",
      "owner": null,
      "architecture": "Fabricated sandbox exercise 1; validate a toy lab configuration."
    },
    {
      "deal_id": "SYN-DEAL-002",
      "name": "SyntheticOrchard Sandbox Expansion",
      "stage": 2,
      "stage_label": "Propose",
      "close_date": "2026-12-02",
      "fiscal_quarter": "FY27 Q2",
      "tcv_usd": 900,
      "competitor": null,
      "partner": null,
      "owner": "Casey Example",
      "architecture": "Fabricated sandbox exercise 2; validate a toy lab configuration."
    },
    {
      "deal_id": "SYN-DEAL-003",
      "name": "SyntheticOrchard Switch Trial",
      "stage": 2,
      "stage_label": "Propose",
      "close_date": "2026-12-03",
      "fiscal_quarter": "FY27 Q2",
      "tcv_usd": 800,
      "competitor": null,
      "partner": "Synthetic Partner A",
      "owner": null,
      "architecture": "Fabricated sandbox exercise 3; validate a toy lab configuration."
    },
    {
      "deal_id": "SYN-DEAL-004",
      "name": "SyntheticOrchard Chassis Trial",
      "stage": 3,
      "stage_label": "Tech Validation",
      "close_date": "2026-12-04",
      "fiscal_quarter": "FY27 Q2",
      "tcv_usd": 700,
      "competitor": null,
      "partner": null,
      "owner": null,
      "architecture": "Fabricated sandbox exercise 4; validate a toy lab configuration."
    },
    {
      "deal_id": "SYN-DEAL-005",
      "name": "SyntheticOrchard Software Trial",
      "stage": 3,
      "stage_label": "Tech Validation",
      "close_date": "2026-12-05",
      "fiscal_quarter": "FY27 Q2",
      "tcv_usd": 600,
      "competitor": null,
      "partner": "Synthetic Partner A",
      "owner": null,
      "architecture": "Fabricated sandbox exercise 5; validate a toy lab configuration."
    },
    {
      "deal_id": "SYN-DEAL-006",
      "name": "SyntheticOrchard Rack Trial",
      "stage": 4,
      "stage_label": "Biz Validation",
      "close_date": "2026-12-06",
      "fiscal_quarter": "FY27 Q2",
      "tcv_usd": 500,
      "competitor": null,
      "partner": null,
      "owner": null,
      "architecture": "Fabricated sandbox exercise 6; validate a toy lab configuration."
    },
    {
      "deal_id": "SYN-DEAL-007",
      "name": "SyntheticOrchard Access Trial",
      "stage": 2,
      "stage_label": "Propose",
      "close_date": "2026-12-07",
      "fiscal_quarter": "FY27 Q2",
      "tcv_usd": 400,
      "competitor": null,
      "partner": "Synthetic Partner A",
      "owner": null,
      "architecture": "Fabricated sandbox exercise 7; validate a toy lab configuration."
    },
    {
      "deal_id": "SYN-DEAL-008",
      "name": "SyntheticOrchard Support Trial",
      "stage": 2,
      "stage_label": "Propose",
      "close_date": "2026-12-08",
      "fiscal_quarter": "FY27 Q2",
      "tcv_usd": 300,
      "competitor": null,
      "partner": null,
      "owner": null,
      "architecture": "Fabricated sandbox exercise 8; validate a toy lab configuration."
    },
    {
      "deal_id": "SYN-DEAL-009",
      "name": "SyntheticOrchard Subscription Trial",
      "stage": 2,
      "stage_label": "Propose",
      "close_date": "2026-12-09",
      "fiscal_quarter": "FY27 Q2",
      "tcv_usd": 200,
      "competitor": null,
      "partner": "Synthetic Partner A",
      "owner": null,
      "architecture": "Fabricated sandbox exercise 9; validate a toy lab configuration."
    },
    {
      "deal_id": "SYN-DEAL-010",
      "name": "SyntheticOrchard Planning Trial",
      "stage": 1,
      "stage_label": "Qualify",
      "close_date": "2026-12-10",
      "fiscal_quarter": "FY27 Q2",
      "tcv_usd": 100,
      "competitor": null,
      "partner": null,
      "owner": null,
      "architecture": "Fabricated sandbox exercise 10; validate a toy lab configuration."
    }
  ],
  "install_base": [
    {
      "product_family": "Enterprise Switching",
      "value_usd": 100,
      "share_pct": 12.5,
      "role_note": "One fictional enterprise switching asset in the sandbox."
    },
    {
      "product_family": "Collaboration",
      "value_usd": 100,
      "share_pct": 12.5,
      "role_note": "One fictional collaboration asset in the sandbox."
    },
    {
      "product_family": "Security",
      "value_usd": 100,
      "share_pct": 12.5,
      "role_note": "One fictional security asset in the sandbox."
    },
    {
      "product_family": "Wireless",
      "value_usd": 100,
      "share_pct": 12.5,
      "role_note": "One fictional wireless asset in the sandbox."
    },
    {
      "product_family": "Compute",
      "value_usd": 100,
      "share_pct": 12.5,
      "role_note": "One fictional compute asset in the sandbox."
    },
    {
      "product_family": "Data Center Networking",
      "value_usd": 100,
      "share_pct": 12.5,
      "role_note": "One fictional data center networking asset in the sandbox."
    },
    {
      "product_family": "Enterprise Routing",
      "value_usd": 100,
      "share_pct": 12.5,
      "role_note": "One fictional enterprise routing asset in the sandbox."
    },
    {
      "product_family": "Observability",
      "value_usd": 100,
      "share_pct": 12.5,
      "role_note": "One fictional observability asset in the sandbox."
    }
  ],
  "plays": [
    {
      "title": "Synthetic exercise 1",
      "thesis": "Compare toy lab option 1 using fabricated requirements.",
      "deal_ids": [
        "SYN-DEAL-001"
      ],
      "stakeholders": [
        "Avery Example"
      ],
      "next_step": "Run sandbox check 1."
    },
    {
      "title": "Synthetic exercise 2",
      "thesis": "Compare toy lab option 2 using fabricated requirements.",
      "deal_ids": [
        "SYN-DEAL-002"
      ],
      "stakeholders": [
        "Blake Example"
      ],
      "next_step": "Run sandbox check 2."
    },
    {
      "title": "Synthetic exercise 3",
      "thesis": "Compare toy lab option 3 using fabricated requirements.",
      "deal_ids": [
        "SYN-DEAL-003"
      ],
      "stakeholders": [
        "Casey Example"
      ],
      "next_step": "Run sandbox check 3."
    },
    {
      "title": "Synthetic exercise 4",
      "thesis": "Compare toy lab option 4 using fabricated requirements.",
      "deal_ids": [
        "SYN-DEAL-004"
      ],
      "stakeholders": [
        "Drew Example"
      ],
      "next_step": "Run sandbox check 4."
    }
  ],
  "kpis": [
    {
      "label": "Total CRM Pipeline (10 Opps)",
      "value": "$5,500",
      "sub": "Sum of ten fabricated deal values"
    },
    {
      "label": "Total Install Base",
      "value": "$800",
      "sub": "8 fictional asset records"
    }
  ]
};

// A canned answer cannot hard-code ids that are generated at runtime, so the
// meeting roles build their answer out of the real context pack and the real
// notes. The guards in extract.ts and brief.ts then run for real against it.
type FakeContext = {
  researchReads?: { ids: string[]; focusAreas: string[] };
  researchUpdates?: Array<{
    id: string;
    finding: { text: string; quote: string; topic: string };
    /** The canonical excerpt the real model is shown and the checks read. */
    evidenceText?: string;
  }>;
  notes?: string;
  pack?: {
    account: { id: string; name: string };
    deals: Array<{
      deal_id: string;
      name: string;
      stage: number | null;
      next_step: string | null;
    }>;
    plays: Array<{ id: string; title: string; status: string }>;
    contacts: Array<{ id: string; name: string }>;
    open_action_items: Array<{ id: string; text: string }>;
    recent_meetings: Array<{ id: string; title: string }>;
    research: Array<{ id: string; title: string }>;
    documents?: Array<{ id: string; title: string }>;
  };
};

function quotableLines(notes: string): string[] {
  return notes
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*\u2022]\s*/, "").trim())
    .filter((l) => l.length >= 12);
}

// Cites the first ids it was given, so the citation check runs for real.
function fakeHandoff(ctx: { mode?: string; ids?: string[]; heading?: string }): unknown {
  const ids = ctx.ids ?? [];
  const opening =
    ctx.mode === "cover"
      ? `${ctx.heading ?? "While I am away"}. Please keep the dated follow-ups moving and send the briefs before each meeting.`
      : "Keep the quarterly cadence with the decision makers and do not let the open follow-ups lapse while the account changes hands.";
  return {
    opening,
    points: ids.slice(0, 3).map((id, i) => ({ text: `Synthetic point ${i + 1}: keep an eye on this record.`, refs: [id] })),
  };
}

// One tension, built from the real thesis and the first meeting's real notes,
// so the quote checks that run on a real answer run on this one.
function fakePlanCheck(ctx: { thesis?: string; meetings?: Array<{ id: string; notes: string }> }): unknown {
  const m = (ctx.meetings ?? []).find((x) => quotableLines(x.notes).length > 0);
  const claim = (ctx.thesis ?? "").split(/(?<=[.!?])\s+/)[0]?.trim() ?? "";
  if (!m || claim.length < 8) return { tensions: [], holds: "Nothing in the recent notes bears on the thesis." };
  const quote = quotableLines(m.notes)[0]!;
  return {
    tensions: [{ thesis_claim: claim.slice(0, 300), meeting_id: m.id, quote: quote.slice(0, 400), question: "Does this still hold after what was said in that meeting?" }],
    holds: "",
  };
}

// Built from the real notes and the real attendee names, so the guards that
// run on a real answer run on this one too.
function fakeRecap(ctx: { notes?: string; attendees?: string[] }): unknown {
  const lines = quotableLines(ctx.notes ?? "");
  const quote = lines[0] ?? (ctx.notes ?? "").trim().slice(0, 40);
  const to = (ctx.attendees ?? []).slice(0, 3);
  return {
    to,
    subject: "Thanks for today, and next steps",
    greeting: to.length ? `Hi ${to.map((n) => n.split(" ")[0]).join(", ")},` : "Hi all,",
    opening: "Thanks for the time today. Here is what I took away.",
    points: [{ text: quote.length > 300 ? `${quote.slice(0, 297)}…` : quote, quote }],
    next_steps: lines[1] ? [{ text: `We will follow up on this by [pick a day].`, quote: lines[1] }] : [],
    closing: "Shout if I have missed anything.",
  };
}

function fakeMeetingExtraction(ctx: FakeContext): unknown {
  const lines = quotableLines(ctx.notes ?? "");
  const pack = ctx.pack;
  const line = (i: number) => lines[Math.min(i, Math.max(lines.length - 1, 0))] ?? "";
  const firstDeal = pack?.deals.find((d) => d.stage === null || d.stage < 6) ?? pack?.deals[0];
  const firstPlay = pack?.plays[0];
  return {
    summary: (ctx.notes ?? "").trim().slice(0, 600) || "No notes.",
    action_items:
      lines.length > 0
        ? [
            {
              text: `Follow up: ${line(0).slice(0, 120)}`,
              owner: null,
              due: null,
              quote: line(0),
            },
          ]
        : [],
    deal_updates:
      firstDeal && lines.length > 0
        ? [
            {
              deal_id: firstDeal.deal_id,
              stage: Math.min((firstDeal.stage ?? 1) + 1, 6),
              next_step: `Confirm next step for ${firstDeal.name}`,
              notes: null,
              quote: line(1),
            },
          ]
        : [],
    play_updates:
      firstPlay && lines.length > 1
        ? [
            {
              play_id: firstPlay.id,
              status: null,
              next_step: `Advance "${firstPlay.title}"`,
              quote: line(2),
            },
          ]
        : [],
    contact_updates: [],
    // Asked for only when the team has a playbook; a line about money or
    // approval is the economic buyer or the process, anything else the pain.
    ...((ctx as { qualification?: boolean }).qualification && lines.length > 0
      ? (() => {
          const money = lines.find((l) => /budget|fund|approv|sign/i.test(l));
          const quote = money ?? line(0);
          const element = money ? (/approv|sign/i.test(money) ? "DP" : "E") : "I";
          return { qualification: [{ element, status: "partial", evidence: quote.slice(0, 200), quote }] };
        })()
      : {}),
  };
}

function fakeBrief(ctx: FakeContext): unknown {
  const pack = ctx.pack;
  const accountId = pack?.account.id ?? "unknown";
  const claim = (text: string, ids: Array<{ kind: string; id: string }>) => ({
    text,
    source_refs: ids,
  });
  const dealRefs = (pack?.deals ?? []).slice(0, 3).map((d) => ({ kind: "deal", id: d.deal_id }));
  const contactRefs = (pack?.contacts ?? []).slice(0, 3).map((c) => ({ kind: "contact", id: c.id }));
  const accountRef = [{ kind: "account", id: accountId }];
  const researchRef = (pack?.research ?? [])[0];
  const firstDeal = (pack?.deals ?? [])[0];
  return {
    // The conversation view, built from the same real ids as the sections, so
    // the replay walks the whole path: cited facts, a labelled hypothesis, a
    // connection that exists only when a deal does, and an uncertainty line.
    conversation: {
      purpose: firstDeal
        ? `Agree what happens next on ${firstDeal.name}, which has no dated next step on file.`
        : "Establish what this account needs next; the records carry no open deal.",
      facts: [
        ...(firstDeal ? [{ text: `${firstDeal.name} is at stage ${firstDeal.stage ?? "unset"} on file.`, source_refs: [{ kind: "deal", id: firstDeal.deal_id }] }] : []),
        ...(pack?.documents?.[0] ? [{ text: `They gave us “${pack.documents[0].title}”.`, source_refs: [{ kind: "document", id: pack.documents[0].id }] }] : []),
        ...(researchRef ? [{ text: `Research on file reports: ${researchRef.title}.`, source_refs: [{ kind: "research", id: researchRef.id }] }] : []),
      ].slice(0, 3),
      hypothesis: firstDeal
        ? {
            text: `They are waiting on an internal decision before committing to ${firstDeal.name}.`,
            unknown: "Nothing on file says who has to sign, or by when.",
            based_on: [{ kind: "deal", id: firstDeal.deal_id }],
          }
        : null,
      questions: ["Who has to agree before this moves?", "What date are you working back from?"],
      connection: firstDeal ? { text: `This meeting is about ${firstDeal.name}.`, source_refs: [{ kind: "deal", id: firstDeal.deal_id }] } : null,
      uncertainty: "The records may be behind: nothing here has been confirmed with them since the last meeting.",
    },
    situation: [claim(`${pack?.account.name ?? "This account"} has ${pack?.deals.length ?? 0} deals on file.`, accountRef)],
    deals_in_play: (pack?.deals ?? [])
      .slice(0, 3)
      .map((d) =>
        claim(`${d.name} is at stage ${d.stage ?? "unset"}${d.next_step ? `; next step is ${d.next_step}` : " with no next step recorded"}.`, [{ kind: "deal", id: d.deal_id }]),
      ),
    attendees: (pack?.contacts ?? []).slice(0, 3).map((c) => ({
      contact_id: c.id,
      name: c.name,
      role_note: "On the account record.",
      last_position: null,
      cares_about: null,
      source_refs: [{ kind: "contact", id: c.id }],
    })),
    // Cites a research note when one exists, so the demo exercises the whole
    // chain: a document id resolving to a title and a link that lands.
    changes_since_last:
      (pack?.research ?? []).length > 0
        ? [claim(`New research on file: ${pack!.research[0]!.title}.`, [{ kind: "research", id: pack!.research[0]!.id }])]
        : dealRefs.length > 0
          ? [claim("No changes recorded since the last meeting.", dealRefs.slice(0, 1))]
          : [],
    questions: [claim("What would have to be true for this to close on the current date?", [])],
    risks: dealRefs.length > 0 ? [claim("No competitor position recorded on the open deals.", dealRefs.slice(0, 1))] : [],
    proposed_next_step: {
      concern: "The deals on file have no agreed next step.",
      action: "Agree one dated next step per open deal before the call ends.",
      owner: null,
      target_date: null,
      blocker: null,
      evidence_ids: [...dealRefs, ...contactRefs].slice(0, 3).map((r) => r.id),
    },
  };
}

// Built out of the canned prose and the canned source list from
// runWebResearch, so checkResearchNote runs for real against it: a fake that
// cited a page the fake search did not return would fail the run, which is
// the point of running the guard here at all. What happens to a finding that
// fails is covered by tests/research.test.ts, not by the demo.
function fakeResearchNote(ctx: { prose?: string; sources?: string[]; companyName?: string; focusAreas?: string[]; budget?: boolean }): unknown {
  const areas = ctx.focusAreas ?? [];
  const prose = ctx.prose ?? "";
  const sources = ctx.sources ?? [];
  const sentences = prose
    .split(/\n+/)
    .map((l) => l.trim())
    // The opening entity line confirms who this is; it is not a finding.
    .filter((l) => l.length > 40 && !l.startsWith("Entity:"));
  const company = ctx.companyName ?? "This organisation";
  const peerAt = sentences.findIndex((s) => s.includes("a peer of similar size"));
  const finding = (i: number, over: Record<string, unknown>) => ({
    text: (sentences[i] ?? "A public source describes the organisation.").slice(0, 400),
    quote: sentences[i] ?? "",
    url: sources[i] ?? "https://www.example.com/",
    confidence: i === 0 ? "high" : "medium",
    date: null,
    topic: ["strategy", "leadership", "procurement"][i] ?? "other",
    ...over,
  });
  return {
    title: `${company}: capital plan, new CIO, and a recent award`.slice(0, 120),
    summary: `${company} has published a multi-year capital plan, changed its CIO this year, and is named on a recent public award covering data centre hardware and support.`,
    // One of each kind of read, so the brief has something to show.
    findings: [
      finding(0, { signal: "compelling_event", owner: "the CIO", fits: areas.slice(0, 1), so_what: areas[0] ? `The capital plan funds the work ${areas[0]} answers, on a published timetable.` : null }),
      finding(1, { signal: "trigger" }),
      finding(2, { fits: areas.slice(1, 2), so_what: areas[1] ? `A fresh award is the moment to raise ${areas[1]}.` : null }),
      ...(peerAt >= 0 ? [finding(peerAt, { topic: "peers", url: sources[2] ?? "https://www.example.com/" })] : []),
    ],
    // The named CIO, when the leadership finding names her.
    people: (() => {
      const at = sentences.slice(0, 3).findIndex((x) => x.includes("Dana Rivera"));
      return at >= 0 ? [{ name: "Dana Rivera", title: "Chief information officer", finding: at }] : [];
    })(),
    // The peer paragraph, when the prose has one, as a labelled peer.
    peers: peerAt >= 0 ? [{ name: "Synthetic Neighbour Authority", kind: "peer", doing: "Moved its data centre into a shared regional facility in April 2026 and published an AI use policy.", finding: 3 }] : [],
    peers_summary: peerAt >= 0 ? "Organisations like this one are consolidating data centres into shared facilities and putting AI policies in writing." : null,
    open_questions: ["No published refresh schedule for the core network.", "How the capital plan is split by year."],
    // Asked for when the team has a playbook: a finding that names the month
    // the fiscal year begins becomes the budget timing.
    budget: (() => {
      if (!ctx.budget) return null;
      const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
      const at = sentences.slice(0, 3).findIndex((s) => /fiscal year (?:begins|starts)/i.test(s));
      if (at < 0) return null;
      const named = /fiscal year (?:begins|starts) (?:in |on )?(\w+)/i.exec(sentences[at]!)?.[1]?.toLowerCase() ?? "";
      const month = months.indexOf(named);
      return { fiscal_year_start_month: month >= 0 ? month + 1 : null, calendar: sentences[at]!.slice(0, 300), finding: at };
    })(),
    entity: { name: company, domain: "example.com", ticker: null, parent: null, hq: null, url: sources[1] ?? null },
    buying_group: [
      { role: "Chief information officer", likely: "signer", basis: "Likely owns the technology half of the capital plan, as its new CIO.", question: "Who signs off technology spend under the capital plan, and when?" },
      { role: "Procurement office", likely: "influencer", basis: "Likely shapes the route to purchase, having run the recent award.", question: "Would new work go through the existing award or a new tender?" },
    ],
  };
}

// Four plays built from the pack's real ids, one of them reusing an existing
// play's exact title so the update path is exercised rather than described.
function fakePlanDraft(ctx: FakeContext): unknown {
  const pack = ctx.pack;
  const deals = pack?.deals ?? [];
  const contacts = pack?.contacts ?? [];
  const existing = pack?.plays[0];
  const accountId = pack?.account.id ?? "unknown";
  const ref = (id: string, kind: string) => ({ kind, id });
  const play = (title: string, thesis: string, dealIdx: number[], contactIdx: number[]) => {
    const linkedDeals = dealIdx.map((i) => deals[i]).filter(Boolean);
    const linkedContacts = contactIdx.map((i) => contacts[i]).filter(Boolean);
    const refs =
      linkedDeals.length > 0
        ? linkedDeals.map((d) => ref(d!.deal_id, "deal"))
        : linkedContacts.length > 0
          ? linkedContacts.map((c) => ref(c!.id, "contact"))
          : [ref(accountId, "account")];
    return {
      title,
      thesis,
      next_step: linkedDeals[0] ? `Agree a dated next step on ${linkedDeals[0].name}` : "Agree who owns this",
      owner_suggestion: linkedContacts[0]?.name ?? null,
      linked_deal_ids: linkedDeals.map((d) => d!.deal_id),
      linked_contact_ids: linkedContacts.map((c) => c!.id),
      source_refs: refs.slice(0, 4),
    };
  };
  const plays = [
    // Same title as a play already on file: this must come back as an update,
    // not a second play with the same name.
    play(existing?.title ?? "Hold the core platform", "Defend the position we already have and make the next decision ours to lose.", [0], [0]),
    play("Get every open deal a dated next step", "Most of the pipeline has no agreed next action, which is why it is not moving.", [0, 1], []),
    play("Map the decision", "We know the people we have met. We do not know who signs, or what they are measured on.", [], [0]),
    play("Turn the research into a conversation", "Public signals give us a reason to call that is about them rather than about us.", [], []),
  ];
  return {
    thesis: `${pack?.account.name ?? "This account"} has ${deals.length} deal${deals.length === 1 ? "" : "s"} on file and ${contacts.length} named ${contacts.length === 1 ? "person" : "people"}. The plan is to hold what we have, give every open deal an agreed next step, and find the people who actually decide.`,
    plays,
  };
}

// Built from the real paste, like every other canned answer here: it reads
// the first line as the title and picks names out of the text, so the code
// guards — the title must appear verbatim, every attendee must be quotable —
// stay meaningful under AI_FAKE rather than being waved through.
function fakeInvite(ctx: { text?: string; today?: string }): unknown {
  const text = ctx.text ?? "";
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const title = lines[0]?.slice(0, 200) || "Pasted meeting";
  // ISO first, then the way an invite actually writes a date.
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const written = /\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b/.exec(text);
  const mi = written ? MONTHS.indexOf(written[2]!.slice(0, 3).toLowerCase()) : -1;
  const writtenIso = written && mi >= 0 ? `${written[3]}-${String(mi + 1).padStart(2, "0")}-${written[1]!.padStart(2, "0")}` : null;
  const date = /(\d{4}-\d{2}-\d{2})/.exec(text)?.[1] ?? writtenIso ?? ctx.today ?? "2026-09-15";
  const time = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text);
  const zone = /\b(Pacific|Eastern|Central|Mountain|UTC|GMT|BST|CET|IST|JST)\b[a-z ]*/i.exec(text)?.[0]?.trim() ?? null;
  // Names, found the crude way a fake should: two capitalised words on a line
  // that also mentions attendance or carries an address.
  const attendees: Array<{
    name: string;
    email: string | null;
    quote: string;
  }> = [];
  for (const line of lines) {
    const email = /[\w.+-]+@[\w.-]+\.\w+/.exec(line)?.[0] ?? null;
    const name = /\b([A-Z][a-z]+ [A-Z][a-z]+)\b/.exec(line)?.[1];
    if (!name) continue;
    if (!email && !/attend|invit|guest|participant|required|optional|with\b/i.test(line)) continue;
    if (attendees.some((a) => a.name === name)) continue;
    attendees.push({ name, email, quote: line.slice(0, 400) });
  }
  return {
    title,
    held_at: date,
    held_time: time ? `${time[1]!.padStart(2, "0")}:${time[2]}` : null,
    time_zone: zone,
    attendees: attendees.slice(0, 50),
  };
}

export function fakeAnswer(role: Role, context?: unknown): unknown {
  const ctx = (context ?? {}) as FakeContext;
  switch (role) {
    // A written summary: one sentence per fact, up to three, citing it and
    // saying only what its label says, so the real checks pass.
    case "summary": {
      const facts = ((ctx as { facts?: Array<{ key: string; label: string }> }).facts ?? []).slice(0, 3);
      return { sentences: (facts.length ? facts : [{ key: "none", label: "Nothing" }]).map((f) => ({ text: `Synthetic summary: ${f.label}.`, refs: [f.key] })) };
    }
    // Email reads like notes to the fake: the same shape, the real quote checks.
    case "mail_extract":
      return fakeMeetingExtraction(ctx);
    case "import":
      // A playbook document: the neutral starter, named after the document's
      // first line, so a flow can see it was read.
      if (typeof (ctx as { playbookText?: unknown }).playbookText === "string") {
        const first = ((ctx as { playbookText: string }).playbookText.split("\n").find((l) => l.trim()) ?? "Imported playbook").trim().slice(0, 120);
        return { ...STARTER_PLAYBOOK, name: first };
      }
      return IMPORT;
    case "meeting_invite":
      return fakeInvite(ctx as { text?: string; today?: string });
    case "meeting_extract":
      return fakeMeetingExtraction(ctx);
    case "meeting_recap":
      return fakeRecap(ctx as { notes?: string; attendees?: string[] });
    case "brief":
      return fakeBrief(ctx);
    case "ask":
      // Ask is a tool loop, not one structured answer: lib/ask/run.ts walks a
      // scripted loop over the real tools under AI_FAKE and asks for nothing
      // here. This is what that script says when it has found nothing.
      return { text: "Nothing on file answers that yet.", citations: [] };
    case "handoff_draft":
      return fakeHandoff(ctx as { mode?: string; ids?: string[]; heading?: string });
    case "plan_check":
      return fakePlanCheck(ctx as { thesis?: string; meetings?: Array<{ id: string; notes: string }> });
    case "plan_draft":
      if ((ctx as { archetype?: { id: string; name: string } }).archetype) {
        const a = (ctx as { archetype: { id: string; name: string } }).archetype;
        return { archetype_id: a.id, hypothesis: `This account looks like ${a.name}. The records suggest early use without a policy.`, why: "Kept research shows experiments and no published AI policy." };
      }
      if (ctx.researchReads)
        // Read the first kept finding as a compelling event, the second as a
        // trigger, and the third as touching the first focus area.
        return {
          reads: ctx.researchReads.ids.map((id, i) => ({
            id,
            signal: i === 0 ? "compelling_event" : i === 1 ? "trigger" : null,
            owner: i === 0 ? "the CIO" : null,
            fits: i === 2 || i === 0 ? ctx.researchReads!.focusAreas.slice(0, 1) : [],
            so_what: (i === 2 || i === 0) && ctx.researchReads!.focusAreas[0] ? `This gives a reason to raise ${ctx.researchReads!.focusAreas[0]}.` : null,
          })),
        };
      if (ctx.researchUpdates)
        return {
          updates: [
            // A replay fixture, not a model that got something wrong: with
            // AI_FAKE_REPLAY=withheld-update the canned answer carries one
            // suggestion whose value is deliberately absent from the evidence,
            // so the browser flow can walk the withheld path. Everything the
            // app then does to it — the grounding check, the refusal, the
            // reason on screen — is the real code. Off by default, so the
            // ordinary fake answer stays entirely supportable.
            ...(process.env.AI_FAKE_REPLAY === "withheld-update" && ctx.researchUpdates[0]
              ? [{ type: "account", field: "hq", value: "Replayed Unsupported City", evidence_id: ctx.researchUpdates[0].id }]
              : []),
            ...ctx.researchUpdates.slice(0, process.env.AI_FAKE_REPLAY === "withheld-update" ? 11 : 12).flatMap<Record<string, unknown>>((e) => {
            // What the real model is given to ground itself in. It used to be
            // the paraphrase plus the report quote, which is not what the check
            // reads — so a fake run could pass or fail the grounding check for
            // reasons a real run never would.
            const text = e.evidenceText ?? `${e.finding.text} ${e.finding.quote}`;
            const person =
              e.finding.topic === "leadership"
                ? text.match(
                    /^([A-Z][\p{L}'’-]+(?: [A-Z][\p{L}'’-]+){1,3})(?:,\s*|\s+is\s+(?:the\s+)?)(chief (?:information|investment|executive|operating|technology|financial) officer)(?=[,.\s]|$)/iu,
                  )
                : null;
            if (person)
              return [
                {
                  type: "contact",
                  name: person[1],
                  title: person[2],
                  evidence_id: e.id,
                },
              ];
            return [
              {
                type: "follow_up",
                text: `Validate public signal with the customer: ${e.finding.text.slice(0, 500)}`,
                evidence_id: e.id,
              },
            ];
            }),
          ],
        };
      return fakePlanDraft(ctx);
    case "research":
    case "research_extract":
      return fakeResearchNote(
        (context ?? {}) as {
          prose?: string;
          sources?: string[];
          companyName?: string;
          focusAreas?: string[];
          budget?: boolean;
        },
      );
    default:
      throw new Error(`AI_FAKE has no canned answer for role "${role}"`);
  }
}
