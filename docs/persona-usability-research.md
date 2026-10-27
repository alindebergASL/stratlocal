# Persona usability: research and verification

This is a bounded follow-up to synthetic operational-persona dogfooding of source `2a577d347234f65961865e5cb9844b3abdb33b32`. It is not human-user research, a WCAG conformance claim, or verification of live model/source quality. The prior release remains live; this candidate requires a separate release decision.

## Findings and decisions

### Review needs its own workspace
The saved-brief desktop layout placed Review inside the narrower Notes column (398 CSS px at a 1440 px viewport). Review is now a sibling section below the existing Brief/Notes workspace (1120 px in the same fixture). The keyed Notes editor stays mounted, native anchors remain, and a source-notes link makes the relationship explicit. No acceptance path, proposal scope or conflict check was changed.

WCAG does **not** require a particular desktop layout. The relevant requirements are meaningful reading order and reflow; full-width review is our design decision. GOV.UK's check-answers pattern supports reviewing information before committing, not automatic acceptance of AI proposals.

### Empty states must describe available actions and the correct record
The play screen previously said to tick deals “below” even when controls were collapsed or the account had no selectable deals. The candidate distinguishes active available deals, no active choices, and archived plays; it links to actual Edit play or account Deals destinations. Archived linked deals/people remain represented and checked, preserving them on unrelated saves.

Account thesis and Play thesis are explicitly named. Saving a play does not populate, erase or imply an account thesis. Empty linked-choice groups explain why there are no choices instead of displaying an unexplained blank region.

### Activity labels should use the user's vocabulary
A presentation-only field-label map replaces internal names such as `owner_user_id`, `held_at`, and `raw_notes`. Create, changed-value and overflow-name summaries share it. Unknown fields remain visible via a readable fallback. Original audit events, old/new values, author/time, record links, value-size markers and history retention are unchanged.

### Citation identity must not imply corroboration
The generic “source (date)” label was hardcoded. Separately, evidence capture discarded titles supplied by provider citation/document envelopes. New capture retains a bounded title from those envelopes; rendering uses it only for same-URL source-bound evidence, alongside the host. Older notes fall back to their actual host/path/query/fragment, not invented titles or new research calls. Destinations are unchanged. Invalid or credential-bearing source URLs are not linked or printed as identities.

Captured title text is display metadata, never a lookup key or evidence of truth. Source-bound and generated-report excerpts remain distinguished; model confidence and publication-date unknowns remain. Provider routing, budgets and call count are unchanged. This is tested with offline envelopes, not live research requests.

## Primary-source basis

Nine UX/accessibility sources were read and quoted passages verified against retained extracts; provider documentation and installed SDK definitions were also checked.

- [W3C: Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html): preserve information/functionality when content reflows. The 320 CSS-pixel check is a reflow proxy, not proof of every browser zoom mode.
- [W3C: Meaningful Sequence](https://www.w3.org/WAI/WCAG22/Understanding/meaningful-sequence.html): retain understandable programmatic reading order.
- [W3C: Labels or Instructions](https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html): label required user input accurately; instructions cannot replace missing controls.
- [W3C: Link Purpose in Context](https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html): links should identify their purpose, considering programmatic context.
- [GOV.UK: Check answers](https://design-system.service.gov.uk/patterns/check-answers/): review before confirmation; links should return to the relevant information.
- [GOV.UK: Checkboxes](https://design-system.service.gov.uk/components/checkboxes/): meaningful choice/group labels and hints.
- [IBM Carbon: Empty states](https://carbondesignsystem.com/patterns/empty-states-pattern/): explain the state and provide a relevant next action when one exists.
- [GOV.UK: Writing for user interfaces](https://www.gov.uk/service-manual/design/writing-for-user-interfaces): use language users understand rather than internal system terms.
- [DWP: Timeline](https://design-system.dwp.gov.uk/components/timeline): activity descriptions should communicate what happened; no new timeline framework is introduced here.
- [Claude: Web search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool) and [web fetch](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool): provider envelopes expose source/title metadata. These documents justify metadata retention, not claims of independent verification.

## Verification so far

- 1018 unit tests across 89 files passed, including 26 new focused usability tests.
- Production build/typecheck passed.
- 28 before and 28 after page/viewport states (1440, 1280, 390, 320 CSS px): no horizontal page overflow. Database fingerprints unchanged across read-only capture.
- 31 synthetic task checks: keyboard deal linking, save/reload, cancel/no mutation, separate account/play theses, activity terminology, exact citation navigation, dirty-note preservation.
- 36 synthetic edge checks: captured search/fetch titles, long titles/URLs, missing dates, unchanged evidence caveats, archived linked deals/people preserved through an unrelated save, archived-only empty-choice guidance.
- Existing post-meeting, handoff and layout browser flows passed. Additional permanent Review geometry assertions are included; exact-head CI and independent review are release gates, not assumed results.

The detailed research memo, full primary-source extracts, citation ledger, scripts, screenshots and receipts are retained in the operator evidence directory `strategy-usability-20260924`. No customer data is included in this document or its fixtures.
