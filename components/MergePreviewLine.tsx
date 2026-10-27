// What a merge is about to do to these two records, in one line.
//
// A merge cannot be undone. The picker that offers the candidate is
// deliberately not gated — a person knows two records are one thing when no
// rule ever will — so the safety is here instead: say what will happen to this
// particular pair before the press, rather than what merges do in general.
//
// The numbers come from the same planner the merge applies, so this cannot
// drift from the behaviour. It carries no payload (see MergePreview): it is
// rendered inside a closed ActionForm, which serialises its children whether
// or not anyone opens it.
import type { MergePreview, PreviewResult } from "@/lib/proposals/merge";

function count(n: number, one: string, many = `${one}s`): string | null {
  return n > 0 ? `${n} ${n === 1 ? one : many}` : null;
}

function sentence(p: MergePreview): string {
  const brings = [
    count(p.dealsAdded ?? 0, "deal"),
    count(p.peopleAdded ?? 0, "person", "people"),
    count(p.attendeesAdded ?? 0, "attendee"),
    count(p.followUps, "follow-up"),
  ].filter((x): x is string => x !== null);

  const parts: string[] = [];
  if (brings.length > 0) parts.push(`brings ${brings.join(", ")} here`);
  if (p.notes === "keep-both") parts.push("keeps both sets of notes");
  if (p.fieldsFilled.length > 0) parts.push(`fills ${p.fieldsFilled.map((f) => f.replace(/_/g, " ")).join(" and ")}`);
  parts.push(`archives “${p.loserLabel}”`);
  // Sentence case, and nothing left implied: if a merge would move nothing at
  // all, saying so is more use than a list of zeroes.
  const body = parts.length === 1 ? `Only ${parts[0]} — it has nothing else to bring` : parts.join(", ");
  return `${body.charAt(0).toUpperCase()}${body.slice(1)}.`;
}

export function MergePreviewLine({ result, label }: { result: PreviewResult; label?: string }) {
  if (!result.ok) {
    return (
      <p className="text-micro text-danger" data-testid="merge-preview">
        {label ? `${label}: ` : ""}
        cannot be merged — {result.why}
      </p>
    );
  }
  return (
    <p className="text-micro text-ink-muted" data-testid="merge-preview">
      {label && <strong className="text-ink">{label}: </strong>}
      {sentence(result.preview)}
      {result.preview.notCopied.length > 0 && <span className="text-ink-faint"> Not carried: {result.preview.notCopied.join("; ")}.</span>}
    </p>
  );
}
