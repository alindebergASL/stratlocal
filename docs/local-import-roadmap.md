# StrategyLocal import review and next milestones

## Implemented in this review

- Customer-document upload stays available when AI is unavailable, including local-only mode. It preserves the original and readable text without an AI run or account proposals.
- Unavailable report extraction returns HTTP 503 before storing a report. The current run infrastructure still requires an available provider even for recognized JSON exports; offline structured report import is future work.
- Report extraction checks the selected account before creating proposals. Different names, conflicting CRM IDs, or an ID already assigned to another account fail the entire run. The original remains available for inspection. Name comparison tolerates only case and whitespace; aliases need explicit future support. A failure cannot be bypassed with Accept all because no proposals are created.

## Next product journey

Import originals → review parsing and classification → resolve account identities → review sourced proposals → accept selected changes → prepare an engagement → capture customer confirmations → update the account plan.

### 1. Evidence-preserving parsing

Keep immutable originals with hashes and versioned extraction results. Preserve PDF pages, PowerPoint slides and speaker notes, Markdown headings, and HTML sections/table coordinates. Add structured source locators to proposal and accepted-record provenance. Report unreadable pages and truncated content explicitly; never describe incomplete extraction as complete. Markdown exists today; PowerPoint ingestion and structured PDF page citations do not.

### 2. Territory packages and account resolution

A document can describe multiple accounts. Store the original once and link its sections to accounts, territories and engagements through explicit relationships. Show identity conflicts before assignment; never infer a merge from an acronym or a copied console ID. Keep imported external IDs namespaced by source. Territory membership needs an effective date so later membership changes do not rewrite historical totals.

### 3. Metrics and claims

Represent wallet, bookings, pipeline and installed base separately, each with value, currency/unit, period/as-of date, scope, source locator and definition. Distinguish source-reported totals from computed totals and avoid double counting. Preserve contradictory observations for review. Current generic extracted KPI cards are not persisted as structured metric proposals.

Store author-supplied evidence labels separately from verification status. Preserve the document's stated audience and allow a reviewed classification; a filename alone cannot make an internal strategy document customer-ready.

### 4. Engagements and confirmation

Extend existing meetings, briefs, attendees and actions. Link original briefing documents and decks to the meeting, retain slide notes and role assignments, and distinguish planned discovery questions, seller hypotheses and customer-confirmed answers. Confirmation needs a speaker/source, timestamp and supporting excerpt. Model extraction alone must not establish verification.

### 5. Local execution

Implement deterministic package validation and reviewable imports without requiring an AI provider. Connect import jobs to durable execution before claiming restart recovery; the current queue only runs maintenance. Add local model adapters after the import contract works without a model. Keep unavailable features visibly explained.

## Acceptance fixtures to add

The motivating document examples were described by the user; their originals were not included in the reviewed source archive. Use synthetic equivalents in committed tests and keep customer originals out of fixtures.

- An account name refers to one organization while a console ID belongs to another: unresolved conflict, no proposals or merge.
- A territory says 11 states/territories but enumerates 12: preserve the list and flag the inconsistency.
- A PDF named Executive Briefing states Internal Account Strategy: retain internal audience classification.
- Labels `[R]`, `[C]`, `[S]`, `[I]`: retain them as author labels without assigning independent verification.
- Import a playbook containing operational instructions: retain workflow/template content; do not install skills, send messages, update CRM or schedule tasks.
- Import the same package twice: no duplicate records. Import a revised package: reviewable changes with original evidence retained.
- Interrupt an import or reject a proposal: no partial account updates. An unresolved identity conflict blocks bulk acceptance.
- Save a proposed discovery question: no customer answer exists until a separate, sourced confirmation is recorded.
- Restore a backup into a separate installation: accounts, original bytes, evidence links and job state remain consistent.

## Deployment validation still required

Run the Mac checklist in `deploy/local/README.md`: Apple silicon build/start, authentication, persistence, loopback exposure, outbound isolation, browser requests, and backup/restore. Prior validation statements in `VALIDATION.md` belong to the original pilot; new checks must be reported separately.

## Review validation (2026-10-27, Pacific)

On Node 22.23.4, the import-focused suite passed all 11 tests, TypeScript passed, and the two standalone queue/snapshot tests passed. The privacy scanner passed its known-identifier/artifact checks.

The production Turbopack build passed with a fresh generated cache and local networking available. The standalone smoke test passed bootstrap login, local session-cookie behavior, authenticated home, and the local Content Security Policy. The first sandboxed build failed on local port binding; a webpack fallback also exposed an existing `node:crypto` client-import incompatibility through `lib/format.ts`. The supported default build was the successful validation path; webpack compatibility was not changed.

The full regression run completed with 1,635 passing tests and two failures in unchanged code:

- `tests/setup.test.ts`: the S3 timeout test received a credentials-provider error rather than its expected network-timeout message. It depends on the runner's AWS configuration.
- `tests/writer.test.ts`: the briefing loses a same-day deal change during the Pacific evening. `lib/meetings/contextPack.ts` uses UTC midnight for its cutoff while `todayISO()` uses the app timezone. Follow-up: use timezone-aware calendar-day boundaries for both email and deal-change windows, with fixed-clock tests covering evening and daylight-saving transitions.

Sandboxed network tests initially timed out; those integration suites passed when rerun with local networking available. No customer data or live provider credentials were needed for these checks.
