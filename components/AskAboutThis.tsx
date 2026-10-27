import { ButtonLink } from "./ui";
import { askAboutHref } from "./AskAbout";

// "Ask about this" on a record's own page: a conversation that reads the
// record first and takes questions to be about it.
export function AskAboutThis({ accountId, kind, id }: { accountId: string | null; kind: "deal" | "play" | "meeting" | "contact" | "action_item"; id: string }) {
  return (
    <ButtonLink href={askAboutHref(accountId, `${kind}:${id}`)} variant="quiet" size="sm" testId="ask-about-this">
      Ask about this
    </ButtonLink>
  );
}
