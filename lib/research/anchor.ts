// A finding's address: the note it is in and its stored index, never its
// position in whatever list is being rendered.
//
// The research page has owned `findingAnchor` since the read-only finding
// route shipped, and the two other callers built the same URL by hand in a
// template literal. The meeting brief is now a third, and a brief's citation
// has to land on the exact sentence it cited — so the anchor and the link that
// carries it live in one place rather than three.

export function findingAnchor(noteId: string, index: number): string {
  return `finding-${noteId}-${index}`;
}

/** The read-only route for one exact finding. */
export function findingHref(accountId: string, noteId: string, index: number): string {
  return `/accounts/${accountId}/research?note=${noteId}&finding=${index}#${findingAnchor(noteId, index)}`;
}
