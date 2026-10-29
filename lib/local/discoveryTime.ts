/** Convert a browser-local input without silently shifting a nonexistent time. */
export function discoveryTimestamp(value: string): string | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!parts) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) ||
      date.getFullYear() !== Number(parts[1]) || date.getMonth() + 1 !== Number(parts[2]) || date.getDate() !== Number(parts[3]) ||
      date.getHours() !== Number(parts[4]) || date.getMinutes() !== Number(parts[5]) || date.getSeconds() !== Number(parts[6] ?? 0)) return null;
  return date.toISOString();
}
