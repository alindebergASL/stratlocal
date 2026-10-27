// Deliberately narrow assertion grammar, not a general biography parser.
// Qualified, negated or ambiguous prose remains a discovery follow-up.
export function explicitCurrentRole(text: string, name: string, title: string): boolean {
  const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const n = escape(name.trim()), t = escape(title.trim());
  if (!n || !t) return false;
  // A PDF line wrap must not detach a qualifier or negation from its claim.
  // Only a leading assertion is eligible; never search inside arbitrary prose.
  const passage = text.replace(/\s+/g, " ").trim();
  if (/[?]|\b(former|formerly|previous|previously|retired|succeeded|left|until|not|never|no|neither|nor|denied|false|incorrect|untrue|wrong|might|could|would|if|alleged|reportedly|designate|nominee)\b|\bmay\s+(?:be|become|serve|have)\b|stepped down|served as|n't\b/i.test(passage)) return false;
  const forward = new RegExp(`^${n}(?:\\s*,\\s*|\\s+(?:is|serves as|was appointed|was named|has been appointed|has been named)\\s+(?:(?:the|current|new)\\s+)?)${t}(?=$|[.,;:]|\\s+(?:at|of|for)\\s)`, "iu");
  const reverse = new RegExp(`^(?:the\\s+)?${t}\\s+${n}(?=$|[.,;:]|\\s+(?:leads|oversees|manages|heads|is|serves)\\s)`, "iu");
  return forward.test(passage) || reverse.test(passage);
}
