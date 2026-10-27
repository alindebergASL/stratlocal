# Contextual commitments — PR1 validation

Base: released `5c61f58ec7764e1b708cf5c91ca3c1ca3b684495`.

## Product behavior
- A deal or play's written next step can explicitly become a follow-up. The confirmation keeps editable text, requires a deliberate assignee/unassigned choice and date/no-date choice, and never changes the source planning text.
- Deterministic source-content identity and an immediate SQLite transaction make repeated confirmation recover one record. Unrelated source edits do not create another identity. A changed next step produces a distinct basis and stale drafts are refused without clearing their fields.
- Recorded source follow-ups remain visible with status, assignee and date. Current-basis records replace the create control, including completed/archived records. Planning prose is not itself assigned work.
- Follow-ups show explicit source provenance separately from mutable meeting/play membership. Missing, archived and merged references are labeled without inventing replacement origins or exposing a foreign account's title.
- Source navigation from Follow-ups includes a validated return link retaining assignee scope and exact task anchor. Arbitrary external and unsupported return URLs are rejected.
- Existing SourceRef storage is reused; no migration or provider call is introduced.

## Executed evidence
- Production build, typecheck, privacy and whitespace checks passed during verification.
- Parent production-build synthetic browser journey: 11 checks passed (cancel is read-only; refusal retains fields; two-tab confirmations produce one record; existing work replaces the create control; assignment/date/source persist; source round trip restores scope and row; phone fits; explicit no-date handling; play provenance; stale-source preservation; no runtime errors).
- Focused tests cover validation, authentication, source/account state, provenance immutability, safe return URLs and retry semantics. Full-suite and exact-head CI results belong to the PR checks.
- Independent technical review covered all 15 production files, with SHA-256 hashes verified by the parent. It found one P2: manual meeting membership had been labeled as immutable source. A merge regression reproduced this red-first; the fix labels it Current meeting and the focused tests/typecheck pass. Delta confirmation accompanies the second slice's review.
- Parent also found duplicate identity changed after unrelated source edits; a red-first regression now verifies that this recovers the original task instead.

## Boundaries
Synthetic data and fake AI only. Browser writes were confined to disposable local fixtures. No production data, live-provider calls, merge or deployment. These are operational workflow tests, not new authorization-role guarantees or live extraction-quality validation.
