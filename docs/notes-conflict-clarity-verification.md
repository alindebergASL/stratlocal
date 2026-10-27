# Notes conflict clarity and scoped Follow-ups

## Scope

- Notes conflicts show the full, React-escaped saved document alongside actor/time metadata. Empty saved notes are explicitly explained.
- Keep theirs adopts that displayed snapshot into the local editor, including its version, without a server write, extraction, or navigation. Subsequent partner edits still cause a conflict.
- Snapshot text is offered only when its row version equals the refused save's conflict version; a race with another write withholds adoption and explains how to retry.
- Follow-ups summaries and empty states describe Mine, the named colleague, or unassigned work. An explicit own-user ID selects Mine.
- Missing or account-mismatched notes targets are refused, including Keep both no-op requests.

No schema, dependencies, provider routing, budget, deployment configuration, or customer data changes.

## Verification

Synthetic fixtures only; no production AI calls.

- `npm test`: 78 files, 931 tests passed.
- `npm run typecheck`, `npm run privacy`, `npm run build`, and `git diff --check`: passed. The privacy scanner is a known-identifier/artifact check, not a substitute for manual diff review.
- `E2E_SKIP_BUILD=1 E2E_PORT=3231 npm run e2e -- meeting-notes follow-ups partner-freshness two-people`: all four flows passed against the built standalone application and fresh databases.
- Separate parent-owned browser acceptance: exact saved preview text; local draft retention until explicit adoption; no adoption POST/navigation; clean editor and unchanged partner server notes; later-edit conflict; filtered colleague visibility; unassigned scope; usable Add action; no page errors. Desktop 1440px and mobile 390px screenshots inspected, no horizontal overflow.
- Partner-freshness flow verifies dirty notes survive explicit refresh and still conflict against their original version.

## Review and failure disposition

An independent technical review found no actionable production security or logic defect. Its blocking finding was a new test's attribute-order-dependent selector. The parent changed this to inspect the Mine anchor's actual href/current state; the reviewed targeted group and full suite subsequently passed. A suggested snapshot-race case was added and passed. Reused-panel conflict clearing was source-reviewed, not separately browser-proven.

Initial browser failures were test-harness defects: FormData stores textarea newlines as CRLF, and Next client navigation is asynchronous. The preview test now compares the exact stored SQLite text (and separately checks visible line preservation); tab tests wait for the chosen tab's current state rather than immediately reading the old page. All assertions remain substantive and passed on rerun.

No automated pre-fix RED run is claimed; the prior browser review supplied the original reproductions. Release and CI results are recorded on the pull request and in private deployment receipts, not inferred from this local verification.
