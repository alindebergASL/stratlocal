import Link from "next/link";
import type { ResolvedFocus } from "@/lib/ask/focus";
import { Icon } from "./icons";

// What a new conversation will be about, said before the question is asked,
// and what a conversation is about, on its own page.
export function AskAbout({ about, prefix = "About" }: { about: ResolvedFocus; prefix?: string }) {
  return (
    <p className="mb-2 flex min-w-0 items-center gap-1.5 text-label text-ink-muted" data-testid="ask-about">
      <Icon name="ask" className="size-4 shrink-0" />
      <span className="shrink-0">{prefix}</span>
      <Link href={about.href} className="truncate font-semibold text-ink hover:text-accent">{about.label}</Link>
    </p>
  );
}

export function askAboutHref(accountId: string | null, focus: string): string {
  return accountId ? `/accounts/${accountId}/ask?focus=${encodeURIComponent(focus)}` : `/ask?focus=${encodeURIComponent(focus)}`;
}
