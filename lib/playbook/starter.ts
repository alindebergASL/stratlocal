// A neutral starting playbook for executive AI conversations: no company, no
// product, no person. A team replaces it with its own, imported or edited in
// the app; it is here so a new team has something to start from, and so tests
// and screens have a playbook that names nobody.
import type { PlaybookInput } from "./schema";

export const STARTER_PLAYBOOK: PlaybookInput = {
  name: "AI outcome starter",
  summary:
    "Customers already pay for AI inside the applications they use and in the public cloud. Lead with what they are trying to achieve, show how the investments they have made can be secured, connected and observed, and bring the right place to run each workload to the table only once the outcome is clear.",
  roles: [
    { id: "ae", name: "Account executive", responsibilities: "Business outcomes, executive sponsor, qualification, economic case.", owns: "Opens the room, runs discovery, secures the next commitment." },
    { id: "se", name: "Solutions engineer", responsibilities: "Architecture, coexistence, workload placement, feasibility, security.", owns: "Technical criteria, readiness, the technical half of the workshop." },
    { id: "partner", name: "Partner or territory lead", responsibilities: "Relationship continuity, buying routes, history on the account.", owns: "Paper process and local follow-through." },
  ],
  steps: [
    { id: "intel", name: "Pre-meeting intelligence", timebox: "90 to 120 minutes", output: "Intelligence brief", owner_role: "ae", detail: "Published strategy, budget timing, leadership priorities in their own words, and what is already installed.", checklist: ["Strategic plan and mandates read", "Budget calendar found", "Leaders' own words captured", "Installed base reviewed"] },
    { id: "archetype", name: "Classify and hypothesise", timebox: "15 minutes", output: "Two-sentence hypothesis", owner_role: "ae", detail: "Place the account in an archetype and write what you believe is true and want to test.", checklist: ["Archetype chosen", "Hypothesis written", "Aligned between AE and SE"] },
    { id: "agenda", name: "Meeting architecture", timebox: "3 to 5 business days before", output: "Three-question agenda", owner_role: "ae", detail: "Agree the agenda with the customer in advance. No product slides in the first meeting.", checklist: ["Agenda sent", "Attendees confirmed", "Roles agreed internally"] },
    { id: "discovery", name: "Executive discovery", timebox: "60 minutes", output: "Discovery notes, qualification tagged", owner_role: "ae", detail: "Four movements: outcomes, current footprint, gaps and readiness, how decisions get made.", checklist: ["All four movements covered", "Next commitment secured"] },
    { id: "readout", name: "Outcome readout", timebox: "48 hours", output: "One-page outcome brief and a forwardable note", owner_role: "ae", detail: "Their words back to them, and an invitation for line-of-business leaders to a working session.", checklist: ["Readout sent", "Workshop invitation forwarded"] },
    { id: "roadmap", name: "Joint roadmap and action plan", timebox: null, output: "Three-phase roadmap and dated action plan", owner_role: "se", detail: "Scored use cases become phases, with dates tied to the customer's budget and approval calendar.", checklist: ["Use cases scored", "Phases agreed", "Dated milestones shared"] },
    { id: "capture", name: "Capture and refresh", timebox: "Within 24 hours, then quarterly", output: "Qualification in the CRM, refreshed intelligence", owner_role: "ae", detail: "Record qualification, check in with the champion monthly, refresh intelligence each quarter.", checklist: ["Qualification recorded", "Champion check-in booked", "Quarterly refresh booked"] },
  ],
  archetypes: [
    { id: "exploring", name: "Exploring", posture: "Early experiments, no formal policy, unsanctioned use.", pain: "Data leaving through unapproved tools; feeling behind.", entry_point: "Visibility and safe use: find what is in use and set guardrails." },
    { id: "app-adopter", name: "Buying AI in apps", posture: "AI arrives inside the applications they already pay for.", pain: "No view of prompts and data flows; unclear return.", entry_point: "Govern and observe what they have bought before buying more." },
    { id: "builder", name: "Building their own", posture: "Custom models and retrieval on their own data, in one or more clouds.", pain: "Egress costs, data residency, multi-cloud security.", entry_point: "Connect and secure their own builds; review where each workload should run." },
    { id: "stuck-in-pilots", name: "Stuck in pilots", posture: "Many pilots, few in production.", pain: "Pilot fatigue, audit scrutiny, unbudgeted run costs, skills.", entry_point: "Measure and operate: cost, performance and the path to production." },
    { id: "scaling", name: "Scaling", posture: "A dedicated AI function and several production systems.", pain: "Cost per inference at scale, agent security, sovereignty.", entry_point: "Scale and control: the right place to run at volume." },
  ],
  movements: [
    { id: "outcomes", name: "Mission outcomes", purpose: "What they are trying to achieve and how they will measure it." },
    { id: "footprint", name: "Current AI footprint", purpose: "What is already in use, bought or built." },
    { id: "gaps", name: "Gaps and readiness", purpose: "What stands between today and the outcome." },
    { id: "decisions", name: "Decision dynamics", purpose: "Who decides, how, with what money and by when." },
  ],
  questions: [
    { id: "q-outcome", text: "Which two outcomes would make this year a success for you, and how would you measure them?", movement_id: "outcomes", meddpicc: "M", personas: [], archetypes: [] },
    { id: "q-mandate", text: "Which mandates or published priorities shape what you can and cannot do with AI?", movement_id: "outcomes", meddpicc: "I", personas: ["CIO"], archetypes: [] },
    { id: "q-inuse", text: "Where is AI already in use today, sanctioned or not?", movement_id: "footprint", meddpicc: "I", personas: ["CISO", "CIO"], archetypes: ["exploring", "app-adopter"] },
    { id: "q-built", text: "What have you built on your own data, and where does it run?", movement_id: "footprint", meddpicc: null, personas: ["CIO"], archetypes: ["builder", "scaling"] },
    { id: "q-blocker", text: "What has stopped your pilots reaching production?", movement_id: "gaps", meddpicc: "I", personas: [], archetypes: ["stuck-in-pilots"] },
    { id: "q-criteria", text: "What would a solution have to prove before you would trust it with sensitive data?", movement_id: "gaps", meddpicc: "DC", personas: ["CISO"], archetypes: [] },
    { id: "q-buyer", text: "Who owns the budget for this, and when is it set?", movement_id: "decisions", meddpicc: "E", personas: [], archetypes: [] },
    { id: "q-process", text: "Walk me through how a decision like this gets approved, step by step.", movement_id: "decisions", meddpicc: "DP", personas: [], archetypes: [] },
    { id: "q-paper", text: "Which purchasing routes or contract vehicles do you prefer to use?", movement_id: "decisions", meddpicc: "P", personas: [], archetypes: [] },
    { id: "q-champion", text: "Who else here would want this to succeed, and why?", movement_id: "decisions", meddpicc: "CH", personas: [], archetypes: [] },
    { id: "q-alternatives", text: "What else are you considering, including doing nothing?", movement_id: "decisions", meddpicc: "CO", personas: [], archetypes: [] },
  ],
  workshop: [
    { id: "targets", name: "Confirm targets", minutes: 10, focus: "Priorities and baseline measures from the first meeting.", lead_role: "ae" },
    { id: "use-cases", name: "Line-of-business use cases", minutes: 30, focus: "Map each department's workflows, backlog and the data they need.", lead_role: "ae" },
    { id: "placement", name: "Workload placement", minutes: 20, focus: "Where each use case should run, and why.", lead_role: "se" },
    { id: "readiness", name: "Security and readiness", minutes: 20, focus: "Network, identity, data protection and the gaps to close.", lead_role: "se" },
    { id: "prioritise", name: "Prioritise and plan", minutes: 10, focus: "Score the top use cases; agree owners and dates.", lead_role: "ae" },
  ],
  placement: {
    options: [
      { id: "saas", name: "In an application" },
      { id: "cloud", name: "Public cloud" },
      { id: "on-prem", name: "On premise" },
    ],
    criteria: [
      { id: "sensitivity", name: "Data sensitivity or residency rules", weight: 5, scores: { saas: -2, cloud: -1, "on-prem": 2 } },
      { id: "latency", name: "Needs low latency near the data", weight: 3, scores: { saas: -1, cloud: 0, "on-prem": 2 } },
      { id: "volume", name: "Steady, high volume of use", weight: 4, scores: { saas: -1, cloud: -1, "on-prem": 2 } },
      { id: "speed", name: "Needs to start quickly", weight: 3, scores: { saas: 2, cloud: 1, "on-prem": -1 } },
      { id: "skills", name: "Few in-house skills to run it", weight: 2, scores: { saas: 2, cloud: 1, "on-prem": -2 } },
    ],
  },
  budget_hints: "Find the customer's fiscal year start, when budgets are submitted and approved, and any funding programmes or grant windows with dates.",
};
