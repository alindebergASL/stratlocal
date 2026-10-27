// "Where it stands" on an account's Overview (DECISIONS #100): two or three
// sentences a seller would say about the account, assembled from the records
// already on the page. No model writes them, so each clause is only as true
// as the record behind it, and each one links there.
import { fmtDay, fmtMoneyShort } from "../format";

export type Clause = { text: string; href?: string };
export type Sentence = Clause[];

export type StandsInput = {
  accountId: string;
  today: string;
  openDeals: number;
  pipelineUsd: number;
  biggest: { id: string; name: string; stage: string; closeDate: string | null; nextStep: string | null; waived: boolean } | null;
  withoutNextStep: number;
  lastMeeting: { id: string; title: string; date: string } | null;
  nextMeeting: { id: string; title: string; date: string } | null;
  livePlays: number;
  topPlay: { id: string; title: string } | null;
  thesis: boolean;
  lead: { label: string; text: string; href: string } | null;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function whereItStands(i: StandsInput): Sentence[] {
  const base = `/accounts/${i.accountId}`;
  const out: Sentence[] = [];

  // The money and the deal that matters most.
  if (i.openDeals === 0) out.push([{ text: "No open deals", href: `${base}/deals` }, { text: "." }]);
  else {
    const s: Sentence = [{ text: `${fmtMoneyShort(i.pipelineUsd)} open across ${plural(i.openDeals, "deal")}`, href: `${base}/deals` }];
    if (i.biggest) {
      s.push({ text: "; the biggest, " }, { text: i.biggest.name, href: `${base}/deals/${encodeURIComponent(i.biggest.id)}` });
      s.push({ text: ` is at ${i.biggest.stage}${i.biggest.closeDate ? `, closing ${fmtDay(i.biggest.closeDate)}` : ", with no close date"}` });
      s.push({ text: i.biggest.nextStep ? `, next: ${i.biggest.nextStep}` : i.biggest.waived ? "" : ", with no next step agreed" });
    }
    s.push({ text: "." });
    if (i.withoutNextStep > (i.biggest && !i.biggest.nextStep && !i.biggest.waived ? 1 : 0))
      s.push({ text: " " }, { text: `${plural(i.withoutNextStep, "open deal")} without a next step`, href: `${base}/deals?next=none` }, { text: "." });
    out.push(s);
  }

  // When we last spoke and when we speak next.
  const talk: Sentence = [];
  if (i.lastMeeting) talk.push({ text: "Last met " }, { text: `${fmtDay(i.lastMeeting.date)} (${i.lastMeeting.title})`, href: `${base}/meetings/${i.lastMeeting.id}` });
  else talk.push({ text: "No meeting on file yet" });
  if (i.nextMeeting) talk.push({ text: "; next " }, { text: `${fmtDay(i.nextMeeting.date)} (${i.nextMeeting.title})`, href: `${base}/meetings/${i.nextMeeting.id}` }, { text: "." });
  else talk.push({ text: "; " }, { text: "nothing booked", href: `${base}/meetings` }, { text: "." });
  out.push(talk);

  // The plan, and the outside reason to act if research found one.
  const plan: Sentence = [];
  if (i.livePlays > 0 && i.topPlay) plan.push({ text: `${plural(i.livePlays, "live play")}, led by ` }, { text: i.topPlay.title, href: `${base}/plays/${i.topPlay.id}` }, { text: "." });
  else plan.push({ text: i.thesis ? "A thesis but no live plays" : "No plan yet", href: `${base}/plays` }, { text: "." });
  if (i.lead) plan.push({ text: ` ${i.lead.label}: ` }, { text: i.lead.text.length > 140 ? `${i.lead.text.slice(0, 137)}…` : i.lead.text, href: i.lead.href });
  out.push(plan);
  return out;
}
