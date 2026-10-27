// Things ⌘K can do, not just places it can go. Each one lands on the screen
// that does it, with the form already open: the server action there stays
// the real check, and nothing runs from the palette itself.
export type Command = { id: string; label: string; detail: string; href: string };

const ACCOUNT_PATH = /^\/accounts\/([^/?#]+)/;

export function commandsFor(pathname: string): Command[] {
  const out: Command[] = [
    { id: "cmd-task", label: "Add a task", detail: "Your own, or for anyone on the team", href: "/follow-ups?add=1#own-work-group" },
    { id: "cmd-account", label: "New account", detail: "Add a customer account", href: "/accounts#new-account" },
  ];
  const m = ACCOUNT_PATH.exec(pathname);
  if (m && m[1] !== "new") {
    const base = `/accounts/${m[1]}`;
    out.unshift(
      { id: "cmd-research", label: "Research this account again", detail: "Public sources, kept only once you review them", href: `${base}/research?again=1` },
      { id: "cmd-import", label: "Import a report or document", detail: "From your sales tool, or from the customer", href: `${base}/import` },
      { id: "cmd-plan-doc", label: "Open the plan as a document", detail: "To read, print or share", href: `${base}/plan` },
    );
  }
  return out;
}
