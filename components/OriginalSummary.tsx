import { Eyebrow } from "./ui";

// The model's own summary of a note, said to be exactly that.
//
// A note is accepted finding by finding: the ones a person ticks become the
// account's evidence and the ones they do not are refused. The summary is
// neither — it was written in one pass over everything the run found, before
// anybody read any of it, so it can state a claim that was then rejected. Both
// pages rendered it as an unqualified paragraph beside the kept findings,
// which is the one reading it must not have: the rejected sentence came back
// as the account's answer, in the app's own voice, with the untick still
// showing correctly two lines below.
//
// It is not deleted or rewritten to fix that, for the reason DECISIONS #8
// gives and one more specific to research: a summary trimmed to the kept
// findings would be a paragraph nobody wrote, and the kept findings are
// already on the screen underneath. It is kept whole, in the model's words,
// under a label saying whose words they are and that review did not pass over
// them.
//
// One component for both pages. The same policy written twice is the same
// policy drifting — and this one is a sentence, so the drift would be a page
// that still quietly presents unreviewed prose as reviewed.
export function OriginalSummary({ summary, kept, total, className = "" }: { summary: string; kept: number; total: number; className?: string }) {
  const text = summary.trim();
  if (text === "") return null;
  return (
    <aside data-testid="original-summary" className={`mt-2 border-l-2 border-line pl-3 ${className}`}>
      <Eyebrow>Original model summary · not reviewed</Eyebrow>
      <p className="mt-1 whitespace-pre-wrap text-label text-ink-muted">{text}</p>
      <p className="mt-1 text-micro text-ink-faint">
        {kept === 0
          ? `Written by the model before review and kept as it was. Nothing in this note was accepted — none of its ${total} finding${total === 1 ? " was" : "s were"} kept — so none of this is the reviewed answer.`
          : `Written by the model before review and kept as it was, so it can repeat claims that were not accepted. ${kept} of ${total} finding${total === 1 ? "" : "s"} ${kept === 1 ? "was" : "were"} kept; what was kept is the reviewed answer.`}
      </p>
    </aside>
  );
}
