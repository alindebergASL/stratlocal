# UX audit, slice 2

Scope: the five confirmed families from the bounded audit of slice 1, on
synthetic data only. No customer identifiers, production data or credentials
are referenced here or in the code this describes. Evidence is a synthetic
account built by the browser flows, a replayed fault injected in the browser,
and the theme tokens read out of `app/globals.css`.

Ranked by what it costs the person using it.

## 1 (P1) An ambiguous write was reported as a refusal

**Source.** A synthetic decision on one proposal, with the reply thrown away
*after* the server answered 200 (`route.fetch()` then `route.abort`). The
account record persisted; the card said "Nothing was applied. That did not
reach the server. Nothing was applied; try again."

**Why it matters.** The claim was false, and the remedy it offered — try again —
is a second write on top of one that already landed. `ProposalReview`,
`NoteReview` (which had no transport catch at all, so a dropped connection
rejected inside the transition and said nothing) and `ResolveResearch` (which
reported a refusal and a lost reply with the same sentence) all shared it.

**Fix.** A fourth outcome, `unknown`, in the single and the bulk path and in
the outer banner. It claims neither success nor a no-write, offers no resend,
and offers a status recheck: `GET /api/proposals/<id>`, a read of the row the
server holds, which resolves the card to accepted, rejected, or still pending.
An explained application 4xx refusal keeps the acknowledgement tick and
selection unchanged. Server/gateway 5xx, timeouts, unreadable replies and
unrecognised 2xx outcomes remain unknown. Affected bulk and note/resolution
mutations stay locked until readback or an explicit full-page reload. `useAiRun`
already reconnected honestly and is untouched. Accept/conflict/acknowledgement
guards are unchanged.

**Retest.** `e2e/ux-recovery.mjs` (single and bulk), `tests/uxRecovery.test.ts`.
Expected: server status 200, no "Nothing was applied" on screen, "Outcome
unknown" present, no Accept button left to press, recheck resolves to
`accepted`, and the written record appears on the account exactly once.

## 2 (P2) Readability and a confidence hierarchy that outranked the finding

**Source.** `--color-ink-faint` `#9aa0b4` on `--color-surface-sunk` `#f0f0f7` is
2.30:1, for text carrying source dates, evidence labels and the "before" side
of every diff. The palette was violet/indigo throughout.

**Fix.** Central tokens only: warm neutral grounds, graphite ink, a deep teal
accent, and every ink at or above 4.5:1 on all three grounds.
`tests/contrastTokens.test.ts` measures each token pair and fails below the
threshold, and rejects a surface or ink that leans blue-violet. In
`FindingRow`, the finding is the body text and the source link is beside it;
the model's coloured confidence pill is now quiet metadata reading "Model
confidence: <value>". Its "model's own estimate, not verification" qualification
remains in the supporting-evidence disclosure without repeating several lines
under every mobile finding. Orange
still means a gap or a caution, red an error, green a confirmed action; the
source-excerpt vs report-excerpt distinction and source dates are unchanged.

## 3 (P2) Navigation overflowed the page at 320

**Source.** 16px of page-wide horizontal overflow at 320 on both the account
and research routes; `NavLinks` was an unwrappable five-link row with a
min-content width the header could not go below.

**Fix.** The nav wraps, is labelled, and keeps `aria-current` and every link;
the header's right-hand group wraps too. Frequent small controls (`sm`
buttons, the evidence disclosure, the source link) got padding rather than a
bigger font, so the target grew and the type did not.

**Retest.** `e2e/ux-recovery.mjs` measures `scrollWidth - clientWidth` at 320
and 390 on both routes; the existing `widths` flow covers every route at 390.
200% zoom and 1024/1440 are the parent's measurement.

## 4 (P2) Empty sections claimed room for work that does not exist

**Source.** A new synthetic account renders full-height panels for meetings,
people, install base and documents with nothing in any of them.

**Fix.** An opt-in `empty` on `Section` and one `.section-empty` rule in
`app/globals.css`. The heading, the count, the add action, the forms and the
anchors all stay and nothing moves into hidden DOM; only the padding of a
section that knows it is empty shrinks. Populated tables and forms are
untouched, and the account's two-column layout (research near the top on
mobile, its own column on desktop) is unchanged.

## 5 (P2) Review selection and run cost

**Source.** `NoteReview` starts with every finding ticked and had no count and
no select-all/clear, so a long note was unticked one row at a time.
`ResearchForm` carried the whole scope-and-cost sentence in the smallest type
beside the Run button.

**Fix.** A "N of M findings selected" count with Select all and Clear
selection, both disabled while a save is in flight, alongside the checkboxes
which are disabled then too. The default is still everything kept, a
re-review still starts from the saved subset, and the controls say that
nothing is saved until Accept/Save and that keeping is not verification.
`ResearchForm` puts the two scopes in a labelled fieldset with each one's
search-charge figure, and says that the figure is search only and a floor
rather than a total, because model usage depends on what the pages hold. Deep
is still the default, and the backend budgets and providers are unchanged. No
new confirmation dialog. Bulk accept keeps its count, its scope and the
evidence acknowledgement.

## Candidate, not reproduced

- **Intentional coercion is not claimed.** Every finding here is consistent
  with ordinary development: an error path written for the common case, a
  palette chosen before contrast was measured, a default that is right for the
  work. Nothing suggests a design meant to push a person towards spending.
- **The deep default is disclosed and preserved.** It was already the default
  and remains so, with its cost now stated before the run rather than after.
- **Archive safeguards retained.** Nothing in this slice touches archive,
  restore or the merged-away tombstone rules, and the existing archive
  confirmations are as they were.
- **Double-apply was not observed.** The ambiguous path was a false *message*;
  no duplicate record was produced by the original code. The new browser flow
  asserts the record appears exactly once after reconciliation so that it
  stays that way.

## Limits of this audit

Synthetic fixtures only. This is not an accessibility certification. Parent
browser measurements passed for account/research at 320, 390, 1024 and 1440px,
24 keyboard-focus samples, and CSS zoom 200% reflow. Native browser zoom and
screen-reader walkthroughs were not separately tested. Five rendered contrast
samples passed (including evidence disclosure text at 6.40:1, previously
2.30:1); token tests cover the central palette, not every translucent overlay.

The executed `ux-recovery` browser flow passed: malformed 200; post-commit 502;
bulk response loss, mutation lockout and GET reconciliation; exact-once
follow-up persistence; note selection preservation on uncertainty and known
refusal; and a non-skipped malformed-200 resolution check with preserved input.
The full unit suite, privacy, typecheck and build passed during integration;
final exact-head CI, independent review and data-preserving deployment are
reported on the release PR rather than inferred from this audit. No production
fault injection or paid/live research was used.
