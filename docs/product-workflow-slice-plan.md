# Product workflow slice: prepare, decide, follow through

## Status and authority

Planning deliverable requested by the product owner after agreeing with the product-design findings. This document specifies a proposed implementation slice; it is not deployment approval. No product implementation is included in this planning step.

Existing working branch: `fix/persona-usability`, based on `2a577d347234f65961865e5cb9844b3abdb33b32`. The earlier usability changes and field-label fix are still uncommitted. Preserve them; do not reset, overwrite, or claim the new design is already implemented. Prior unit evidence is 1,022 passing tests, not proof of this future slice. Production remains on the prior release.

Evidence: `/home/ubuntu/strategy-product-review-20260924/REVIEW.md` and its retained screenshots/DOM snapshots; underlying usability research is in `docs/persona-usability-research.md`. The design assessment used synthetic data, not human-user research or live customer data.

## Outcome

A professional can open Today, identify relevant work, prepare or resume a meeting, explicitly review changes, and reach the resulting follow-up without having to understand the application's internal record model.

Product direction: **prepare → decide → follow through**. These are a way to organize existing work, not a new mandatory wizard or a persisted meeting lifecycle.

Primary audience assumption: account professionals preparing for conversations and managing follow-through. Managers retain the account directory, Pipeline and existing comparison fields. No new product positioning or feature suite is needed.

## Scope: one vertical journey

Change the first-screen hierarchy and handoff behavior on Today, account and meeting pages. Make only the minimal Follow-ups adjustments needed to land on and act on the right record. Improve the short activity preview on Today using existing audit evidence. Preserve the full underlying detail.

Do not redesign every route. No schema migration, new external service, AI prioritization, automatic research, new permissions, global theme rewrite, or persisted phase state is intended. If existing data cannot support a proposed statement, use truthful fallback copy rather than broaden the backend or invent a signal.

## 1. Today becomes a working agenda

### Proposed first-screen structure

- Page title/date and clearly labelled **account scope**.
- One emphasized task with a recorded reason and a primary link into the work.
- Compact, independently labelled groups: **Meetings**, **Proposed changes**, **Due work**. On desktop, supporting groups can sit alongside the main task; on phone, the chosen task precedes the supporting groups.
- Account directory follows the working agenda. Keep the existing stable comparison fields and meaningful zero values; no columns that disappear with fixture content.
- A compact **Recent activity** preview follows, with full history reachable.

### Deterministic emphasis, not a priority score

Proposed default selection order: a meeting in today's scheduled window; otherwise the oldest overdue work; otherwise work due today; otherwise pending proposed changes; otherwise the next scheduled meeting within the existing seven-day window; otherwise a recent scheduled meeting missing notes. If there is no queued work, offer existing account/start actions with a scoped empty message.

This is a visible navigation default, not an assertion about business importance. Supporting groups remain available even when they do not supply the primary action. Use explicit reasons such as a scheduled date/time, recorded due date, or pending review count. Stable ties use date/time where applicable, then account/entity label and ID; proposal groups remain deterministic rather than claiming urgency. Preserve the existing time-zone and meeting-window partition logic initially; label it as scheduled timing, never evidence that a call actually occurred.

The main meeting link reads **Prepare brief** if none exists and **Read brief** if saved; opening either does not generate content. Due work links to the record to review/update, not a one-click completion action. Keep deal next steps and play next steps distinguishable from assigned follow-ups.

### Data gap to address deliberately

`listAttention` currently returns past-due work only, not work due today. Add a bounded pure read for due-today work, or factor the existing query without changing its other callers' semantics. Use the app's calendar day, exclude archived/closed records, preserve explicit units, and do not change an existing `< today` contract silently.

Today is filtered by **account owner** (`lib/queries/owner.ts`), whereas `/follow-ups` is filtered by **action assignee**. Do not label scoped account work “your tasks” unless the assignee actually matches. Customer follow-up links may land directly on their account's existing `#action-…` anchor. If linking into `/follow-ups`, include the correct assignee/unowned scope so the record is visible; do not reuse Today’s `who` values on that route. Keep Own work accessible without pretending it is a customer account.

## 2. Account becomes the bridge into work

- Preserve account identity, meaningful context and the two-column overview with a distinct **Research** section.
- Use one relevant primary action at the top, consistent with Today. Provide contextual secondary actions without repeating the same pending-review banner as another high-emphasis action strip.
- Keep meetings, Plan, Deals, People and full history reachable through the established sections/anchors. Do not merge an account thesis with a play thesis.
- Reduce duplicate borders/heading bands only in the touched first-screen area. Make page purpose strongest, section headings second, and metadata quiet. No global reskin.
- Rare archive/maintenance actions may move into an accessible labelled disclosure, but frequent editing must remain discoverable. Keep confirmations and keyboard access; no hover-only icon controls.

For genuinely new accounts, offer a short starting choice through existing actions: prepare for a meeting or build account context. For research-only, play-only or meeting-only accounts, show the relevant existing work rather than a generic “nothing here” checklist. Research entry opens the existing flow; costs and data-sharing boundaries remain visible before execution.

## 3. Meeting becomes a task-focused workspace

Replace “saved brief always leads” with an understandable initial task focus, while preserving all sections and existing URLs.

### Focus rules

- An explicit, valid incoming section link or the user's selection wins over an inferred default.
- Archived/merged records lead with their truthful read-only state and retain evidence/destination links.
- Otherwise pending meeting proposals suggest **Review changes**; absent those, a meeting still in the scheduled upcoming window suggests **Brief**.
- After the scheduled window, no saved notes suggests **Notes**; saved notes with open follow-ups suggests **Follow-ups**; otherwise lead with retained notes/summary and available actions.
- Empty queues do not imply a completed meeting, and a past calendar date does not mean “Met.” Use date/schedule wording unless an actual recorded outcome exists.

Implement this as presentation/navigation, not a new state machine. Preserve native section anchors for `#brief`, `#notes`, `#review`, `#follow-ups` and summary. Do not unmount the notes editor when selecting another section; preserve stable identity through save/refresh. No repeated auto-scroll/focus reset after a mutation. Browser Back restores prior location and scope without adding duplicate history entries.

The main task must be visually clear without recreating the narrow review panel. Review remains full-width, explicit accept/reject stays per decision, and source notes remain reachable. The user can read an old brief at any time without regeneration.

For a sparse brief, replace repeated negative placeholders in the entry view with a concise, factual gap summary. Keep material uncertainty visible, and retain the complete brief, sources, qualifiers and print/export content. No invented missing-field fix links: each link must lead to a real existing input/action. Defer changes to brief generation itself.

## 4. Close the loop without declaring false completion

After an explicit save or proposal decision, show the actual result using existing persisted state: what was saved/applied, what proposals remain, and what open follow-ups still need attention. If follow-up owner/date is missing, expose that gap rather than inventing it or blocking all progress.

A created follow-up must be reachable immediately, with the correct owner scope and entity ID. Reload must retain text, assignment, date and meeting association. Switching owner or completing a follow-up remains an explicit mutation with existing conflict safeguards. Preserve source references and account/play identity.

On `/follow-ups`, show populated groups before irrelevant empty-group education. Keep the existing Add a follow-up entry and Own work destination; reducing empty chrome must not eliminate the way to create the first personal task.

## 5. Recent activity speaks in events, not schema lists

Keep this bounded to the Today preview and a pure presentation helper. Do not replace or rewrite the audit log.

- Map only supported recorded events into concise descriptions, such as “Meeting added,” “Follow-up due date changed,” or “Proposed changes applied.” A meeting record being added does not prove a meeting occurred.
- Show known entity/account identity; attribute an actor only when reliably recorded. Grouped day-level edits may involve multiple people and do not justify invented ordering or causation.
- Preserve existing accepted-batch grouping; one batch must not explode into dozens of preview rows.
- Allow an item to expose exact before/after fields or navigate to the relevant existing history. Unknown, truncated or unsupported events get a truthful fallback, not an AI-generated explanation.
- Do not claim facts were verified merely because findings were retained.

## Research: deliberately preserved

Keep the full dossier, topic cards, source dates/links, original audience qualifiers, confidence/uncertainty distinctions and audit history. The account preview can be concise, but research depth stays available. Essential unverified-evidence labels and pre-action cost/data disclosures remain visible at the decision point. Repetitive educational prose may become secondary; trust-critical information may not.

Research page redesign, note-picker redesign, Pipeline/filter redesign, broad noun renaming, dynamic removal of zero columns, scoring and new analytics are outside this slice.

## Implementation order and review checkpoints

### A. Preserve the verified foundation

Before new implementation, capture a file/hash manifest of the existing usability work and isolate it as a reviewable foundation commit/PR on the established branch path. Run the required exact-head gates before publishing it. Do not deploy merely to establish a baseline. Create the workflow slice on top only after the dependency is explicit; no reset or accidental bundling of unreviewed design into an old approval.

### B. Define behavior before styling

Add pure rules for task selection/focus and supported activity descriptions, plus fixtures for timing, scopes, missing data and unknown events. Reuse existing query contracts. Add the bounded due-today read with tests where needed. No generalized workflow engine.

### C. Build the visible journey in the real app

Implement Today, account handoff, then meeting focus and follow-up return path. Apply hierarchy/spacing changes only where they serve that journey. Use one application writer and one integrator. No separate mock application and no restoration of the rejected preview.

**Visual checkpoint:** show the real candidate's Today, account and meeting first screens, plus one complete synthetic task journey. Explain what becomes easier, not how many components changed. This is the point for the product owner's product judgment before broader refinements.

### D. Verify and package

One independent technical review on the final bounded diff, parent verification of any material fixes, and a GLM design delta review grounded in rendered evidence with parent screenshot inspection. Reuse unchanged evidence instead of commissioning another broad research/design audit. Open scoped PR(s) with dependency order and exact tested commits. Do not merge/deploy under this planning instruction; deployment requires explicit approval.

## Likely implementation surfaces

Verified existing files:

- `app/page.tsx`, `app/TodayOverview.tsx`: agenda and short activity preview.
- `lib/queries/today.ts`, `lib/queries/attention.ts`, `lib/queries/owner.ts`: current meeting, activity and account-scope semantics.
- `lib/queries/meetings.ts`: existing assignee-filtered `listOpenFollowUps`.
- `app/accounts/[id]/page.tsx`: account context and duplicate prompts.
- `app/accounts/[id]/meetings/[mid]/page.tsx`: currently `briefFirst = !!brief || upcoming`; date-only Upcoming/Met wording; task focus/layout.
- `app/follow-ups/page.tsx`: assignee scope, Own work ordering and landing behavior.
- `components/MeetingBrief.tsx`, `components/NotesPanel.tsx`, `components/ActionItems.tsx`: inspect only relevant entry rendering/state-preservation seams; preserve mutation and export contracts.
- Existing regression families: `glance`, `attention`, `meetingTime`, `clock`, `owner`, `followUps`, `activity`, `postMeeting`, `notesAttempt`, `notesConflictClarity`, `briefFollowUp`, `personaUsability`, layout and handoff browser flows.

New pure helper/test files may be introduced if they prevent duplicated behavior. Read the repository's installed Next.js guide before editing route/component behavior, per AGENTS.md.

## Acceptance and proof

### Behavior fixtures

Cover: meeting today; upcoming meeting with/without saved brief; missing meeting time; past scheduled meeting without notes; pending proposals; zero pending with open follow-ups; due today/overdue/undated work; no queued work; new/research-only/play-only accounts; mixed account owners and different action assignees; unowned/Own work; archived/merged references; unknown activity event; stale concurrent edits; loading, failure and retry of explicit actions.

Use fixed app-timezone clocks, including day-boundary cases. Test deterministic ordering and exact count/row agreement before truncating a visible preview; if capped, show a truthful total and a working view-all path.

### Browser gates

- Desktop 1440/1280 and phone 390/320: relevant task, reason and action visible without having to traverse administration/empty-state scaffolding; overflow checks paired with screenshot inspection.
- Keyboard: task navigation, menus/disclosures, proposal decisions and follow-up editing; focus remains visible and DOM order agrees with visual order.
- End-to-end: Today → meeting → saved notes → fake-AI proposals → explicit accept/reject → assigned follow-up → correct scoped landing → reload → Back to original context.
- Confirm no duplicate task/section editors, no lost unsaved notes, no GET-triggered generation or business writes, no altered approval semantics, no date-only “meeting complete” claim.
- Print/export and full dossiers retain information omitted from entry summaries.
- Include dense multi-account fixtures, not only one attractive happy-path screenshot.

### Technical/release gates

Focused tests, full suite, typecheck, production build, privacy/diff checks, authenticated production-build browser fixture, exact-head CI and independent review. Fake AI and disposable synthetic data only. No customer data, production writes or live provider calls. Record exact commit/hash provenance; new tests must not weaken existing state/authority assertions for visual convenience.

**Done means:** the complete journey works and is visibly more coherent in the real application, failures preserve the user's work, source/trust detail remains accessible, and the release candidate has exact-head evidence. Green tests alone or completing a list of styling edits is not sufficient.
