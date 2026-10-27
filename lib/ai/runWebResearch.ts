// The one call that leaves AWS.
//
// Bedrock has no server-side web search, so research runs against the
// Anthropic API directly. What makes that acceptable is this file's input
// type: it can carry the account's public identity and the question someone
// typed, and there is no field a deal, a person, a meeting note, a play or an
// install-base row could be put in. The compiler enforces DECISIONS #3 here,
// so nobody has to remember it at the call site.
//
// This module must not import from lib/queries or lib/meetings. There is a
// test that reads this file and checks exactly that.
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getDirectClient } from "./client";
import type { StageUsage } from "./cost";
import { fakeEnabled } from "./fake";
import { ROLES } from "./models";
import { AiRefusal } from "./runStructured";
import type { SourceEnvelope } from "../research/schema";

export type ResearchDepth = "standard" | "deep";

// Bounded on purpose: the focus box is free text and the only thing stopping
// someone pasting a customer's private detail into it is its size and this
// check. What is actually sent is stored on the run as input_summary.
export const WebResearchInput = z
  .object({
    companyName: z.string().trim().min(1).max(200),
    hq: z.string().trim().max(200).nullish(),
    // The organisation's own web domain, as an earlier run confirmed it.
    // Public identity, like the name: it pins the research to one entity.
    domain: z.string().trim().max(120).nullish(),
    region: z.string().trim().max(120).nullish(),
    focusQuestion: z
      .string()
      .trim()
      .max(300)
      .nullish()
      .refine((v) => !v || !/[\w.+-]+@[\w-]+\.[\w.]+/.test(v), {
        message: "Do not put an email address in the research question; it is sent to a web search.",
      }),
    avoidTitles: z.array(z.string().trim().max(120)).max(10).default([]),
    // The team's own focus areas — a short list of what it sells, and the
    // only part of its direction that may leave AWS (DECISIONS #3). Never its
    // goals, targets or anything about a customer.
    teamFocus: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
    // A fixed ask, written here, for when the organisation's money is set.
    // Only a yes or no leaves the box: never the team's own wording.
    budgetTiming: z.boolean().default(false),
    depth: z.enum(["standard", "deep"]),
  })
  .strict();

export type WebResearchInput = z.input<typeof WebResearchInput>;

export type WebResearchResult = {
  text: string;
  // key -> the URL the tool actually returned. Storing the value rather than
  // the model's spelling means a stored URL is never model-authored.
  sources: Map<string, string>;
  /** urlKey -> the search tool's page_age, where it gave one. */
  pageAges?: Map<string, string>;
  evidence?: SourceEnvelope[];
  // Provider completion only; category coverage is assessed independently.
  capture?: { status: "complete" | "partial"; reasons: string[] };
  searches: number;
  fetches: number;
  turns: number;
  budgetExhausted: boolean;
};

export const BUDGETS: Record<ResearchDepth, { searches: number; fetches: number; maxTokens: number; breadth: string }> = {
  standard: {
    searches: 8,
    fetches: 5,
    maxTokens: 24000,
    breadth: "Standard depth. Cover every dossier category with the strongest available evidence; prioritize missing categories over redundant sources.",
  },
  deep: {
    searches: 15,
    fetches: 10,
    maxTokens: 32000,
    breadth: "Deep. Cover every dossier category, then drill into missing categories and unresolved material details: procurement records, contract expiries, modernization milestones and governance.",
  },
};

const MAX_CONTINUATIONS = 3;
const MAX_OUTPUT_BYTES = 512 * 1024;
const MAX_FETCH_CONTENT_TOKENS = 30000;

const SYSTEM = `You research a named organization from public sources for a seller who is preparing to work the account. You have web search and page fetch. Write prose with the URL you read inline next to each claim. Do not write JSON.

Begin by confirming the exact organization: its legal name, primary web domain, stock ticker if it is listed, parent organization if any, and headquarters. Write them as one opening "Entity:" line with the URL that confirms them. If two organizations share the name, say which one this is and why. Everything after is about that entity.

Produce a full evidence-linked account dossier, not a one-page briefing or a list of URLs. Use clear sections, multiple distinct supported facts where available, dates, entity scope and concrete detail. Do not compress rich evidence into two headline datapoints. Do not pad with repetition. Cover every category below; an explicit evidence gap is better than omitting a section.

1. Organization and entity scope (org): mission, operating model, scale, geography, sites, legal entities, subsidiaries and divisions. Identify the exact account before researching it; attribute each fact to its actual entity. For universities, distinguish the named campus from its university system, other campuses and healthcare operations, and disambiguate similarly named institutions. System-wide budgets, contracts or leaders are not automatically campus-specific.
2. People and governance (leadership): named executives, technology and finance leaders, boards, reporting lines, buying authority, appointment dates and leadership changes. Separate documented authority from inferred influence.
3. Money (financial): revenue or operating budget, fiscal year, appropriations, funding, grants, capital plans, debt and financial pressure. Distinguish proposed, approved and spent money and each entity's scope.
4. Strategic programs and milestones (strategy): published priorities, modernization or consolidation programs, investments, expansion, acquisitions and closures; named owners, dates, progress and upcoming milestones where evidenced.
5. Technology and vendors (technology): infrastructure, data center, cloud, networking, cybersecurity, enterprise applications and data/AI direction. Name vendors, integrators and partners only with public evidence. Explicitly distinguish evidenced installed/deployed technology from planned, tendered, piloted, historical or merely mentioned technology; a job skill or partnership alone does not prove installed base.
6. Procurement, contracts and renewals (procurement): buying process, portals, signatories, live/recent tenders, awards, cooperative purchasing, suppliers, scope, amounts, contract periods, renewal options and expiry dates. Do not infer a renewal from an undated vendor reference.
7. Risks, change and hiring (risk): regulatory, funding, operational, competitive and security pressures, reorganizations and hiring signals. Label job-posting dates and inferred signals; do not treat vacancies as committed spend.
8. Peers and competitors (peers): three to five organizations like this one (for a public body, peers of similar size and mission; for a business, its direct competitors), and what each is publicly doing on the same ground: programs, technology choices, consolidation, AI and data initiatives, notable contracts. Name each and label it peer or competitor; give dates and cite sources. These are facts about the other organization, scoped to it.

If the organization is publicly listed, two sources are named targets: its latest annual report or 10-K (or local equivalent), for risk factors touching AI, cybersecurity, power or data-center capacity, and any such risk that is new since the prior year's filing; and its latest earnings call or investor presentation, for dated executive statements on AI, technology and capital spending. Cite the filing or transcript itself. A public body's equivalents are its budget documents, board minutes and audit reports.

Look for a reason to act now: a dated event that forces a decision (a deadline, a contract or support end, a mandate, a funded program with a start date) and who owns it, and recent changes such as new leaders or announcements. Say when you found none.

Research category by category within the supplied whole-run tool budget. Start with high-value official sources covering several categories; use subsequent bounded queries/fetches on missing categories and material unresolved questions, not an arbitrary shallow search count or source quota. Track what is evidenced versus missing. Stop tools when the allowance is used and write all supported detail already collected; do not ask for extra tool rounds. End with specific open questions and limitations. Keep process narration brief and clearly labeled, separate from dossier sections.

Source discipline, and these are the rules that matter:
- Prefer primary sources: the organization's own site, annual reports and investor material, regulatory filings, procurement portals, press releases, leadership bios, published strategy documents. Then trusted trade press. Then job postings and conference talks.
- Every claim carries the URL you actually read or that the search returned, written inline. Never cite a URL a tool did not give you, and never reconstruct one from memory.
- Label each claim's confidence: high = an official source, or two credible ones agreeing; medium = one credible source, or several indirect signals; low = inferred from weak or adjacent evidence.
- Never invent a vendor, a contract, a budget, a person or a date. If you could not find something, say so plainly and add it to what is still open. "Not found in public sources" is a useful answer; a guess is not.
- Say when something is old. A three-year-old press release is evidence about three years ago.
- Report what is published. Do not speculate about what the organization needs or should buy.`;

export function userMessage(input: z.output<typeof WebResearchInput>): string {
  const budget = BUDGETS[input.depth];
  const lines = [
    `Organization: ${input.companyName}`,
    input.hq ? `Headquarters: ${input.hq}` : null,
    input.domain ? `Website: ${input.domain} (confirmed by earlier research; use it to stay on this entity)` : null,
    input.region ? `Region: ${input.region}` : null,
    "",
    budget.breadth,
    `Tool budget for the whole run: at most ${budget.searches} web searches and ${budget.fetches} page fetches. Spend fetches on the highest-value pages rather than on breadth.`,
  ];
  if (input.focusQuestion) {
    lines.push("", `Lead with this question, then cover all dossier categories: ${input.focusQuestion}`);
  }
  if (input.teamFocus.length > 0) {
    lines.push(
      "",
      `The seller's team works on: ${input.teamFocus.join("; ")}. Where the organization's public activity bears on these, find it and say so; do not invent a connection, and still cover everything else.`,
    );
  }
  if (input.budgetTiming) {
    lines.push(
      "",
      "Also find when the organization's money is set: its fiscal year start, when budget requests are submitted and approved, the adopted budget or capital plan, and any funding programmes or grant windows, each with its date.",
    );
  }
  if (input.avoidTitles.length > 0) {
    lines.push(
      "",
      `Research already on file covers the ground below. Do not repeat it; look for what is newer or what it did not answer:\n${input.avoidTitles.map((t) => `- ${t}`).join("\n")}`,
    );
  }
  return lines.join("\n");
}

// ---- URL provenance ---------------------------------------------------------

// A comparison key, not a display value. The fragment goes because citation
// URLs carry #:~:text= anchors and would otherwise never match the search
// result they came from. The scheme is left out so an http result and an
// https citation of the same page are one source.
export function urlKey(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  // Anything that is not a web page has no business being stored and rendered
  // as a link: a javascript: or data: URL from a hostile page is an attack.
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  const host = u.host.toLowerCase().replace(/^www\./, "");
  const path = u.pathname.replace(/\/+$/, "");
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !/^(utm_|mc_)/i.test(k) && !/^(gclid|fbclid|msclkid|igshid|ref|ref_src)$/i.test(k))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return `${host}${path}${params ? `?${params}` : ""}`;
}

type ContentBlock = Anthropic.Messages.ContentBlock;

// Collects every URL a tool actually returned in one message's content.
export function harvestUrls(content: ContentBlock[], into: Map<string, string>, ages?: Map<string, string>): { searches: number; fetches: number; exhausted: boolean } {
  let searches = 0;
  let fetches = 0;
  let exhausted = false;
  const add = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const key = urlKey(raw);
    if (key && !into.has(key)) into.set(key, raw);
  };
  for (const block of content as unknown as Array<Record<string, unknown>>) {
    if (block.type === "server_tool_use") {
      if (block.name === "web_search") searches += 1;
      if (block.name === "web_fetch") fetches += 1;
      continue;
    }
    if (block.type === "web_search_tool_result") {
      const c = block.content;
      if (Array.isArray(c)) {
        for (const r of c as Array<Record<string, unknown>>) {
          add(r.url);
          const key = typeof r.url === "string" ? urlKey(r.url) : null;
          if (ages && key && typeof r.page_age === "string" && r.page_age.trim() && !ages.has(key)) ages.set(key, r.page_age.trim().slice(0, 60));
        }
      } else if ((c as Record<string, unknown> | null)?.error_code === "max_uses_exceeded") {
        exhausted = true;
      }
      continue;
    }
    if (block.type === "web_fetch_tool_result") {
      const c = block.content as Record<string, unknown> | null;
      if (c?.type === "web_fetch_result") add(c.url);
      else if (c?.error_code === "max_uses_exceeded") exhausted = true;
      continue;
    }
    if (block.type === "text") {
      for (const cite of (block.citations as Array<Record<string, unknown>> | null) ?? []) {
        if (cite.type === "web_search_result_location") add(cite.url);
      }
    }
  }
  return { searches, fetches, exhausted };
}

// Fetch document indices are conversation-wide, in returned document order.
// Keep invalid URLs as null slots so later indices never shift to another page.
function registerDocument(block: Record<string, any>, documents: Array<string | null>): void {
  if (block.type === "web_fetch_tool_result" && block.content?.type === "web_fetch_result" && block.content.content) {
    const url = block.content.url;
    documents.push(typeof url === "string" && urlKey(url) ? url : null);
  }
}

function citationUrl(cite: Record<string, any>, documents: Array<string | null>): string | null {
  let url: unknown;
  if (cite.type === "web_search_result_location") url = cite.url;
  else if (["char_location", "page_location", "content_block_location"].includes(cite.type) && Number.isInteger(cite.document_index) && cite.document_index >= 0)
    url = documents[cite.document_index];
  // Never resolve prose markers, guessed URLs, document titles, or unknown
  // citation types. Only provider envelopes and returned fetch documents count.
  return typeof url === "string" && urlKey(url) ? url : null;
}

import { sourceTitle } from "@/lib/research/sourceTitle";

// Keep only actual source text/citation envelopes, never the generated answer.
export function harvestEvidence(content: unknown[], previousDocuments: Array<string | null> = []): SourceEnvelope[] {
  const documents = [...previousDocuments];
  const out: SourceEnvelope[] = [];
  for (const raw of content) {
    const b = raw as Record<string, any>;
    if (!b || typeof b !== "object") continue;
    registerDocument(b, documents);
    if (b.type === "web_fetch_tool_result" && b.content?.type === "web_fetch_result") {
      const c = b.content;
      const s = c.content?.source;
      if (typeof c.url === "string" && urlKey(c.url) && (s?.type === "text" || s?.type === "plain_text") && typeof s.data === "string")
        out.push({
          url: c.url,
          text: s.data.slice(0, 24000),
          location: "Fetched document",
          ...(sourceTitle(c.content?.title) ? { citation: { url: c.url, title: sourceTitle(c.content.title) } } : {}),
        });
    }
    if (b.type === "text" && Array.isArray(b.citations))
      for (const c of b.citations) {
        const url = c && typeof c === "object" ? citationUrl(c, documents) : null;
        if (url && typeof c.cited_text === "string")
          out.push({
            url,
            text: c.cited_text.slice(0, 6000),
            location: c.type,
            citation: { type: c.type, url, ...(sourceTitle(c.type === "web_search_result_location" ? c.title : c.document_title) ? { title: sourceTitle(c.type === "web_search_result_location" ? c.title : c.document_title) } : {}), ...(Number.isInteger(c.document_index) ? { document_index: c.document_index, start_char_index: c.start_char_index, end_char_index: c.end_char_index, start_page_number: c.start_page_number, end_page_number: c.end_page_number, start_block_index: c.start_block_index, end_block_index: c.end_block_index } : {}) },
          });
      }
  }
  return out.slice(0, 40);
}

// Text blocks may be separate cited clauses, not just tool narration. The
// API has no unambiguous final/narration discriminator: retain all of them.
function reportText(content: ContentBlock[], documents: Array<string | null>, sources: Map<string, string>): string {
  const parts: string[] = [];
  for (const block of content) {
    registerDocument(block, documents);
    if (block.type !== "text") continue;
    const urls = new Set<string>();
    for (const cite of block.citations ?? []) {
      const url = citationUrl(cite, documents);
      if (url) { urls.add(url); sources.set(urlKey(url)!, url); }
    }
    // Scoped to this block, not adjacent prose; this is attribution, NOT
    // verification that every statement in the block follows from the source.
    const citations = [...urls].map((url) => `\n[Provider citation for this text block: ${url}]`).join("");
    if (block.text || citations) parts.push(block.text + citations);
  }
  return parts.join("\n\n");
}

// ---- the run ----------------------------------------------------------------

/** What one finished turn has gathered so far, for a checkpoint. */
export type ResearchProgress = { text: string; sources: Map<string, string>; pageAges?: Map<string, string>; evidence: SourceEnvelope[]; searches: number; fetches: number; turns: number };

/** One thing the run did, as it did it: a search it made or a page it read. */
export type ResearchStep = { kind: "search" | "read"; detail: string };

// What a tool-use block says it is doing, in a line a person can follow.
export function stepOf(block: Record<string, unknown>): ResearchStep | null {
  if (block.type !== "server_tool_use") return null;
  const input = (block.input ?? {}) as Record<string, unknown>;
  if (block.name === "web_search" && typeof input.query === "string") return { kind: "search", detail: input.query.slice(0, 200) };
  if (block.name === "web_fetch" && typeof input.url === "string") {
    try {
      const u = new URL(input.url);
      return { kind: "read", detail: `${u.host}${u.pathname === "/" ? "" : u.pathname}`.slice(0, 200) };
    } catch {
      return null;
    }
  }
  return null;
}

export async function runWebResearch(raw: WebResearchInput, stages: StageUsage[], onTurn?: (progress: ResearchProgress) => void, onStep?: (step: ResearchStep) => void): Promise<WebResearchResult> {
  const input = WebResearchInput.parse(raw);
  const spec = ROLES.research;
  if (fakeEnabled()) return fakeWebResearch(input, stages, onStep);

  const budget = BUDGETS[input.depth];
  const client = getDirectClient();
  const user = userMessage(input);
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: user }];
  const sources = new Map<string, string>();
  const pageAges = new Map<string, string>();
  let searches = 0;
  const evidence: SourceEnvelope[] = [];
  let fetches = 0;
  let budgetExhausted = false;
  const documents: Array<string | null> = [];
  const reportParts: string[] = [];
  let reportBytes = 0;
  let turns = 0;

  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
    const searchesLeft = Math.max(budget.searches - searches, 0);
    const fetchesLeft = Math.max(budget.fetches - fetches, 0);
    if (searchesLeft === 0 && fetchesLeft === 0 && turn > 0) {
      budgetExhausted = true;
      break;
    }
    // max_uses is per request, so a fresh 8 would be granted on every
    // continuation. The remaining budget is what gets passed.
    const tools = [
      {
        type: "web_search_20260318" as const,
        name: "web_search" as const,
        max_uses: searchesLeft,
      },
      {
        type: "web_fetch_20260318" as const,
        name: "web_fetch" as const,
        max_uses: fetchesLeft,
        citations: { enabled: true },
        max_content_tokens: MAX_FETCH_CONTENT_TOKENS,
      },
    ];

    const stream = await client.messages.stream({
      model: spec.model,
      max_tokens: budget.maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: input.depth === "deep" ? "xhigh" : "high" },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools,
      messages,
    });
    // As each search or fetch is issued, so a person watching can see the
    // run working rather than a spinner for several minutes.
    if (onStep) stream.on("contentBlock", (block) => {
      const step = stepOf(block as unknown as Record<string, unknown>);
      if (step) onStep(step);
    });
    const final = await stream.finalMessage();
    // A received response is billable even if our validation rejects it.
    // Tool results (including encrypted content) are not the final report.
    stages.push({
      name: turn === 0 ? "web_research" : `web_research_continue_${turn}`,
      provider: spec.provider,
      model: spec.model,
      usage: final.usage,
    });

    // Harvest before anything else: a later turn's message does not contain
    // an earlier turn's tool results, so this is the only chance.
    turns = turn + 1;
    const newEvidence = harvestEvidence(final.content, documents);
    const part = reportText(final.content, documents, sources);
    reportBytes += Buffer.byteLength(part, "utf8") + (part && reportParts.length ? 2 : 0);
    if (reportBytes > MAX_OUTPUT_BYTES) {
      throw new Error("The research answer was larger than this app will accept.");
    }
    if (part) reportParts.push(part);
    const text = reportParts.join("\n\n");
    const counted = harvestUrls(final.content, sources, pageAges);
    evidence.push(...newEvidence);
    searches += counted.searches;
    fetches += counted.fetches;
    budgetExhausted = budgetExhausted || counted.exhausted;

    if (final.stop_reason === "refusal") throw new AiRefusal(final.stop_details?.category ?? null);

    if (final.stop_reason === "pause_turn" && turn < MAX_CONTINUATIONS) {
      // Appended, not replaced. web_fetch will only fetch a URL already in
      // the conversation, so dropping the previous turn's search results
      // makes every later fetch fail with url_not_in_prior_context.
      messages.push({ role: "assistant", content: final.content });
      // Saved before the next turn is paid for: a restart from here on keeps
      // what these turns found instead of losing it all.
      onTurn?.({ text, sources, pageAges, evidence, searches, fetches, turns });
      continue;
    }

    if (final.stop_reason === "max_tokens" && text.length === 0) {
      throw new Error("The research answer ran out of room before it said anything. Try a narrower question.");
    }
    const reasons: string[] = [];
    if (final.stop_reason === "max_tokens") reasons.push("max_tokens");
    if (final.stop_reason === "pause_turn") reasons.push("continuation_limit");
    if (budgetExhausted) reasons.push("tool_budget_exhausted");
    return {
      text,
      sources,
      pageAges,
      evidence,
      searches,
      fetches,
      turns,
      budgetExhausted,
      capture: { status: reasons.length ? "partial" : "complete", reasons },
    };
  }
  return {
    text: reportParts.join("\n\n"),
    sources,
    pageAges,
    evidence,
    searches,
    fetches,
    turns,
    budgetExhausted,
    capture: { status: "partial", reasons: ["tool_budget_exhausted"] },
  };
}

// ---- fake -------------------------------------------------------------------

// Not a runStructured call, so AI_FAKE needs its own branch here. The prose
// and the source list are canned, but the provenance and quote guards then
// run against them for real.
export const FAKE_SOURCES = ["https://www.example.com/newsroom/capital-plan", "https://www.example.com/about/leadership", "https://procurement.example.gov/awards/2026-114"];

async function fakeWebResearch(input: z.output<typeof WebResearchInput>, stages: StageUsage[], onStep?: (step: ResearchStep) => void): Promise<WebResearchResult> {
  // Paced only when a browser flow wants to watch the steps arrive.
  const pause = Number(process.env.AI_FAKE_RESEARCH_MS ?? 0);
  for (const step of [
    { kind: "search" as const, detail: `${input.companyName} capital plan` },
    { kind: "search" as const, detail: `${input.companyName} chief information officer` },
    { kind: "read" as const, detail: "www.example.com/newsroom/capital-plan" },
  ]) {
    onStep?.(step);
    if (pause > 0) await new Promise((r) => setTimeout(r, pause));
  }
  const text = [
    `Entity: ${input.companyName}, website ${input.domain ?? "www.example.com"}, not listed, no parent organisation (${FAKE_SOURCES[1]}).`,
    "",
    `${input.companyName} published a capital plan in July 2026 covering facilities and technology through 2029 (${FAKE_SOURCES[0]}). Confidence high: it is their own newsroom.`,
    "",
    // Only when asked for budget timing, so other flows read as before.
    ...(input.budgetTiming ? [`Its fiscal year begins in July, and the board adopts the budget each June after departments submit requests in February (${FAKE_SOURCES[0]}).`, ""] : []),
    `Dana Rivera, chief information officer, started in May 2026, having previously run infrastructure at a regional operator (${FAKE_SOURCES[1]}). Confidence high.`,
    "",
    `A public award notice in March 2026 covers data centre hardware and three years of support, with the incumbent integrator named (${FAKE_SOURCES[2]}). Confidence medium: the notice does not list the equipment.`,
    "",
    `Synthetic Neighbour Authority, a peer of similar size, moved its data centre into a shared regional facility in April 2026 and published an AI use policy (${FAKE_SOURCES[2]}). Confidence medium.`,
    "",
    "Still open: no published refresh schedule for the core network, and nothing public about how the capital plan is broken down by year.",
  ].join("\n");
  const sources = new Map<string, string>();
  for (const url of FAKE_SOURCES) {
    const key = urlKey(url);
    if (key) sources.set(key, url);
  }
  stages.push({
    name: "web_research_fake",
    provider: ROLES.research.provider,
    model: "fake",
    usage: { input_tokens: 0, output_tokens: 0 },
  });
  return {
    text,
    sources,
    pageAges: new Map([[urlKey(FAKE_SOURCES[0]!)!, "July 15, 2026"]]),
    searches: 3,
    fetches: 1,
    turns: 1,
    budgetExhausted: false,
  };
}
