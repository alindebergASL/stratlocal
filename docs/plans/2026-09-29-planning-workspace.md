# Planning workspace slice

## Outcome and acceptance test
Capture a loose thought immediately, find it again, and turn it into actionable work without navigating a hierarchy. Bring meetings and tasks forward; preserve the rich account research/history. One contextual agent action: Prepare this meeting. No production deployment or paid live provider runs in this slice.

## Starting point
Base ed3b8cf62d1f9277a5433d3d6592a1b2a45024b8 on the repository default branch claude/gracious-hamilton-dkejf1. Existing Own work account, action_items, follow-ups list, meeting creation, source-backed brief generation, durable AI run records, and proposal review are reusable. Home only shows attention/due work, creation is buried, and task-to-account/meeting connection needs a deliberate supported path.

## Implementation
1. Reuse action_items and Own work for title-only quick capture; add a clear Tasks destination (retain /follow-ups deep links), optional details (owner/date/account/meeting), and visible Add task/Add meeting on Today, tasks, and contextual account/meeting surfaces. Plain text entry does not silently infer deadlines or launch an agent.
2. Put upcoming meetings and open tasks at the top of Today and expose account-scoped planning near the account header. Keep account-scope vs task-assignee scope explicit. Unscheduled standalone tasks must stay discoverable; do not make them dependent on due dates. Avoid duplicate competing overview panels.
3. Support attaching a standalone task later to an account and/or its meeting without recreating its ID or losing metadata/history. Validate references, live account/meeting status, concurrent edit version, and preserve source provenance; never silently transplant meeting-origin evidence. Use existing transaction/audit patterns. Add optional notes only if the existing schema lacks them and with an additive migration.
4. Prepare this meeting runs the existing guarded brief pipeline from the planning surface with inline progress, errors, and a useful result/link. Persisted run state should survive reloads without duplicate execution. Retain source citations and proposed-not-committed semantics. Provide an editable preparation brief using existing schema, clear human-edit provenance, and concurrency protection. Do not replace evidence with ungrounded text or make agent drafts into tasks without confirmation.
5. Keep existing notes -> proposed actions review reachable. No autonomous sending, calendar integration, general chatbot, research redesign, new framework, or invented governance.

## Verification
- Unit tests for task capture, optional metadata, standalone->account/meeting link, missing/archived/cross-account reference rejection, version conflicts, history/ID preservation, and brief edits/run state.
- Desktop and phone browser flow: create title-only task, navigate/reload and find it, connect later, create upcoming meeting from overview, run preparation (explicit synthetic AI replay), inspect/edit/reload result, record notes and review proposed actions without auto-accept.
- Existing targeted follow-up, ownership, brief, meeting-notes, phone/layout and privacy regressions; full unit suite, typecheck, production build.
- Independent review followed by exact-head verification and a scoped PR. Preview screenshots/local synthetic preview only unless an existing approved preview facility is available. Production unchanged; deployment approval remains separate.

## Data and execution boundaries
Synthetic fixtures only in repo, docs, logs, screenshots, and PRs. Do not read or copy production/customer databases or secrets. No live provider spend. One implementation writer, one independent technical review context, parent browser/acceptance gate. Report actual test results and replay/live/unavailable status explicitly.
