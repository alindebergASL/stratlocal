// Plan keeper's questions as the cards the page shows. Pure: the page reads
// the questions and hands them in.
import type { PlanQuestion } from "../assistants/planKeeper";
import type { PlanCard } from "@/components/PlanQuestions";

export function planCards(questions: PlanQuestion[]): PlanCard[] {
  return questions.map((q): PlanCard => {
    const accountHref = `/accounts/${q.account_id}/plan`;
    if (q.payload) {
      return {
        kind: "thesis",
        id: q.id,
        accountName: q.account_name,
        accountHref,
        claim: q.payload.thesis_claim,
        quote: q.payload.quote,
        meetingTitle: q.payload.meeting_title,
        meetingHref: `/accounts/${q.account_id}/meetings/${q.payload.meeting_id}#notes`,
        question: q.payload.question,
        thesis: q.account_thesis ?? "",
        version: q.account_version,
      };
    }
    return {
      kind: "play",
      id: q.id,
      accountName: q.account_name,
      accountHref,
      playTitle: q.play_title ?? "",
      playHref: `/accounts/${q.account_id}/plays/${q.subject_id}`,
      status: q.play_status ?? "",
      why: q.text,
      nextStep: q.play_next_step,
      version: q.play_version ?? 0,
    };
  });
}
