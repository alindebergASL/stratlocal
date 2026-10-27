/** Accept only the exact supported list route, filter, and row anchor.
 * Never trim, repair, or pass arbitrary same-origin paths through. */
export function followUpReturn(value: unknown, userIds: string[]): string | null {
  if (typeof value !== "string") return null;
  const match = /^\/follow-ups(?:\?who=([A-Za-z0-9_%.-]+))?#action-([A-Za-z0-9_-]+)$/.exec(value);
  if (!match) return null;
  if (match[1]) {
    let who: string;
    try { who = decodeURIComponent(match[1]); } catch { return null; }
    if (encodeURIComponent(who) !== match[1] || !["me", "unowned", ...userIds].includes(who)) return null;
  }
  return value;
}
