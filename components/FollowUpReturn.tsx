
import { listUsers } from "@/lib/auth";
import { followUpReturn } from "@/lib/followUpReturn";
export function FollowUpReturn({ value }: { value: unknown }) {
  const href = followUpReturn(value, listUsers().map((u) => u.id));
  return href ? <a href={href} className="mb-3 inline-flex min-h-11 items-center text-accent underline">← Return to Follow-ups</a> : null;
}
