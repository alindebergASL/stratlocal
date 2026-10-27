// Only display metadata, never a source identity or a verification signal.
// Refuse oversized metadata rather than presenting a made-up shortened title.
export function sourceTitle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const title = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return title.length > 0 && title.length <= 600 ? title : undefined;
}
