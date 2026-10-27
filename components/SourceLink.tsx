// Shared render boundary for untrusted public-source URLs (client-safe).
export function safeSourceUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === "https:" || u.protocol === "http:") && !u.username && !u.password;
  } catch {
    return false;
  }
}
export function SourceLink({ url, children }: { url: string; children?: React.ReactNode }) {
  return safeSourceUrl(url) ? (
    <a href={url} target="_blank" rel="noreferrer noopener" className="break-words text-accent underline">
      {children ?? url}
    </a>
  ) : (
    <span className="break-all text-ink-muted">{children ?? url} (link unavailable)</span>
  );
}
