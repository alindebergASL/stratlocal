import { fmtDay } from "@/lib/format";

/** Assignment is independent of the optional extracted display label. */
export function followUpMetadata(item: { owner: string | null; ownerUserId: string | null; due: string | null; meetingTitle: string | null }, owners: { id: string; name: string }[] = []): string {
  const owner = item.ownerUserId
    ? (owners.find((o) => o.id === item.ownerUserId)?.name ?? "Assigned owner")
    : (item.owner?.trim() || "no owner");
  return [owner, item.due ? `due ${fmtDay(item.due)}` : "no date", item.meetingTitle].filter(Boolean).join(" · ");
}
