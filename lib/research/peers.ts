// Peers and competitors, as kept research says: organisations like this one
// and what each is doing in public. A peer counts only while the finding it
// stands on is kept; the newest note with any kept peers speaks for the
// account (DECISIONS #90).
import { loadAcceptedResearch } from "./notes";
import { keptFindings, type Peer, type ResearchFinding } from "./schema";
import { findingHref } from "./anchor";
import { wrapUntrusted } from "../ai/prompts";

export type KeptPeer = Peer & { noteId: string; source: ResearchFinding; href: string };
export type PeerView = { summary: string | null; peers: KeptPeer[]; asOf: string };

export function keptPeers(accountId: string): PeerView | null {
  const notes = loadAcceptedResearch(accountId).sort((a, b) => b.meta.generated_at.localeCompare(a.meta.generated_at));
  for (const { doc, meta } of notes) {
    const kept = new Set(keptFindings(meta));
    const peers = (meta.peers ?? []).flatMap((p) => {
      const source = meta.findings[p.finding];
      return source && kept.has(source) ? [{ ...p, noteId: doc.id, source, href: findingHref(accountId, doc.id, p.finding) }] : [];
    });
    if (peers.length) return { summary: meta.peers_summary ?? null, peers, asOf: meta.generated_at };
  }
  return null;
}

/** For a prompt: wrapped, since it came off the public web, and citable by its finding's research id. */
export function peersForPrompt(accountId: string): string {
  const view = keptPeers(accountId);
  if (!view) return "";
  const lines = view.peers.map((p) => `- ${p.name} (${p.kind}): ${p.doing} [research_id ${p.noteId}#${p.finding}]`);
  return wrapUntrusted("peers_and_competitors", `${view.summary ? `${view.summary}\n` : ""}${lines.join("\n")}`, { as_of: view.asOf.slice(0, 10) });
}
