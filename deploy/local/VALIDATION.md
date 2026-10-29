# Validation

## Meeting evidence and confirmations — 2026-10-29

- Production build and TypeScript pass. Forty-nine focused tests pass across discovery records, source selection, browser-local timestamp conversion, existing imports/context, duplicate protection, and intake. Cases include source-account membership, exact quotation/location checks, archived or merged targets, preserved question/hypothesis classifications, offset timestamps, invalid dates and daylight-saving gaps, bounded previews, and paginated locations.
- Chromium passes the complete synthetic workflow. New checks select evidence by filename and section, preview the passage, reject a mismatched quotation without saving a confirmation, clear quotations on location changes, save a valid answer with a source link, reset the discovery form, and attach the original using account/meeting dropdowns. A source-preview request for an unlinked account returns 404. Existing intake, request history, proposal, model, and external-AI-disabled checks also pass.
- Documentation links and diff checks pass. No migration or additional configuration is needed. Validation uses synthetic data on Linux; this update does not establish the truth of imported claims or constitute a physical-Mac deployment test. The existing dynamic-filesystem tracing build warnings remain.

## Account workflow and import recovery — 2026-10-29

- Production build and TypeScript pass. Seventy-seven focused tests pass across attention cues, request-history account/user scoping and pagination, import recovery, repeat-import conflicts, existing proposal acceptance, contact matching, overview/context, normalization, readiness, and intake.
- Chromium passes the full synthetic workflow, including reopening the exact saved intake prompt, Markdown/ZIP downloads, current account-tab indication, pending changes reached from Needs attention, acceptance clearing that cue, and the request-history page. Existing evidence, local-model draft, meeting, and disabled-external-AI checks also pass.
- Recovery tests cover queued/running cancellation, expired leases, the three-interruption limit, legacy stuck packages, original file/job reuse, unauthorized and active-task retry refusal, stale workers, and completed parsing preservation. Repeat-package tests cover overlapping contact/play creates, distinct emails, intervening manual edits, archived/merged records, and separate accounts.
- Documentation links and diff checks pass. These changes add no migration or environment settings. Tests use synthetic data and temporary databases; Docker Desktop and physical-Mac deployment were not rerun for this update. The build retains the existing dynamic-filesystem tracing warnings in the file-download and exchange-folder paths.

## Deployment readiness and research coverage — 2026-10-29

- Production build/TypeScript, 38 focused Vitest tests, and six gateway/setup/snapshot Node tests pass. Coverage includes partial versus unknown research coverage, mismatched source identities, changed deal identifiers, explicit distinct-deal confirmation, forwarding request bodies/cookies/Origin, draining a 2 MB download, and backup/restore behavior.
- Chromium passes the fresh-account workflow, accepted overview/People records, the new coverage panel, and preparing a follow-up MyAgent request for research gaps. Changed-ID protection is also tested against an existing account.
- Docker Engine 28.4: disposable containers verified the fixed gateway across an internal app network and browser bridge. A probe to the published loopback port verified POST data, Origin, and cookies. The upstream app had only its internal network and no published host port. Test resources were removed afterward.
- Compose v2.40.3 validates base, exchange-only, models-only, combined, and restore configurations. App stays internal; web alone publishes loopback and has no data or secret mounts. The restored app gets a separate web gateway on port 3001.
- Docker networking was tested with a synthetic HTTP upstream. The production application was built and browser-tested outside Docker; the complete production Docker image build and physical-Mac migration have not been rerun here. Follow the installation checks, including the temporary-gateway migration, on the deployment machine.

## Flexible imports

- Production build/TypeScript and 33 focused normalization, account-context, workspace, and intake tests pass. Tests cover unique heading/exact-quote resolution, ambiguous and mismatched citations, descriptive contact roles, email omission, and owner-scoped retry of failed imports.
- Chromium acceptance passes with a Markdown heading locator and descriptive customer role in the synthetic input, including proposal acceptance and the People/overview workflow.
- Normalization preserves originals and records warnings. It uses deterministic local rules, with no model or external service calls. Corroborating an email against packaged JSON does not independently verify that address.

## Account overview and customer contacts

- Production build/TypeScript and 50 focused tests pass, covering overview/contact proposals, accepted persistence, repeat preparation, legacy JSON contact recovery, source-account mismatches, seller/customer separation, conflicting titles, existing imports, and account merge behavior.
- Chromium acceptance verifies accepting imported account metadata, a researched overview, and a customer contact; the overview and People page show the accepted data. The existing request, model, and meeting workflow also passes.
- Migration `049_account_research_summary` adds a nullable summary column separate from the account thesis. Exact structured-summary/contact provenance is retained through the imported manifest; legacy contact proposals cite their JSON evidence.
- Validation uses temporary databases and synthetic regression fixtures. Neither MyAgent/Salesforce access nor the truth of imported claims is established by these checks.

## Expanded import review and intake depth

- Production build, TypeScript, and 27 focused import-detail/intake/workspace tests pass. Rendering checks cover readable deal fields, missing-data labels, escaped source markup, and bounded source previews with original-file links.
- Chromium acceptance passes, including opening an imported source preview and inspecting its original-download link before proposal creation.
- Both the in-app intake prompt and standalone Markdown template request broader account research and explicit retrieval coverage. Actual MyAgent research quality and connector access still require source review; these tests do not verify external claims.

## Intake and installation documentation update — 2026-10-28

- Intake implementation (`383f39d`): TypeScript, production build, and 24 focused intake/workspace tests passed. The Chromium workflow also passed intake preparation on an empty account, Markdown and ZIP download checks, and the existing import/planning flow. Salesforce and MyAgent were not called; preparation is local.
- Reproduce focused tests with `npm test -- tests/localIntake.test.ts tests/localWorkspace.test.ts` on Node 22. The browser test still requires a production build and Chromium.
- Installation instructions now distinguish container health from host HTTP reachability, document the existing temporary gateway, preserve that gateway during upgrades, and flag the same port-publication limitation for restore trials. The gateway is not integrated into the tracked Compose configuration.
- This documentation update checks commands and UI labels against tracked files; it does not constitute a new Docker Desktop or physical-Mac acceptance run.

## Setup-guide audit — 2026-10-28

- Checked the instructions against the tracked scripts, schema, UI, Dockerfile, and Compose files. Removed stale foundation-only instructions and unconfigured development-server fallback advice.
- Docker Compose v2.40.3 successfully resolves the base, exchange-only, models-only, combined, and restore configurations. Verified secret and gateway-script paths resolve relative to `deploy/local`.
- Docker Engine 28.4.0 with `node:22-bookworm-slim`, UID 10001: a synthetic host-owned 600 bind-mounted secret fails with EACCES; a 444 file within a private 700 host directory is readable. No real credential was used. The guide and optional secret-path configuration now use that layout.
- Backup-wrapper regression tests cover only-app-running, both-running with snapshot failure, and initially-stopped cases. Shell syntax checks pass.
- These checks do not validate Docker Desktop file-sharing behavior, the complete Mac image build/start, Swift compilation, Apple inference, or Keychain. The revised guide provides explicit checks and stop conditions for each unverified dependency.


## Local workspace implementation — 2026-10-28

- Production build and TypeScript pass on Node 22.
- 19 focused tests pass for immutable evidence, identity conflicts/aliases, scoped metrics, PDF pages, PowerPoint order and notes, archive safeguards, MyAgent requests, selected model context, external approval, visible provider failures, citations, queue recovery/cancellation, watched-folder failures, same-origin checks, and internal-content classification.
- Chromium acceptance passes against a temporary database: login, account creation, ZIP import and mapping, proposals, linked evidence, MyAgent request package, exact model context preview, synthetic local-model completion, accepted account-thesis update, meeting notes, and discovery question. Territory/meeting/settings pages render without browser errors; external AI starts disabled.
- Full suite run: 1,657 passed and two pre-existing failures (`setup.test.ts` AWS credential/timeout expectation and `writer.test.ts` date-sensitive deal-move assertion). Two additional focused regressions were added and pass afterward.
- Host/gateway JavaScript syntax checks pass. Apple inference, Swift compilation with the macOS SDK, Keychain authorization, Docker Desktop connectivity, and Mac network isolation remain unverified here. The browser test uses a synthetic local bridge, not a native model.

Reproduce: `npm run build`, `npm run typecheck`, `npm test -- tests/localWorkspace.test.ts`, then `node e2e/local-workspace.mjs` with Chromium installed (or set `PLAYWRIGHT_CHROMIUM_PATH`). See [the workspace guide](../../docs/local-workspace.md).

## Earlier foundation baseline

Completed in Linux workspace using Node 22:
- TypeScript check passed.
- Next.js production build passed after replacing a development-only node_modules symlink with local dependencies.
- Production standalone server started with a fresh synthetic database; login, initial user bootstrap, local cookie, authenticated home and local CSP passed.
- Cloud-provider denial test passed with dummy credentials present.
- SQLite queue persistence, deduplication, conflicting request rejection, single worker lease, recovery and stale-owner fencing passed.
- Backup/restore round trip preserved synthetic database row and original document bytes. Tampered payload and existing destination were rejected.

Docker CLI/daemon is unavailable in this workspace. Dockerfile execution, Compose launch, Apple silicon native dependencies, internal-network isolation and Mac backup bind mounts remain unverified. At this earlier foundation stage, local models and package import had not yet been implemented; the workspace update above supersedes that limitation.

Full regression suite: 1,630 passed, one failed (185 files passed, one failed). The remaining failure is the existing `tests/setup.test.ts` S3 timeout expectation: this workspace returns ENETUNREACH instead of a timeout. It was also present in the reviewed baseline. The two standalone Node test suites additionally passed.

Commands:
```sh
npm run typecheck
STRATEGY_LOCAL_ONLY=1 NEXT_TELEMETRY_DISABLED=1 npm run build
npx vitest run
node --test tests/localQueue.node-test.mjs tests/localSnapshot.node-test.mjs
node deploy/local/smoke-example.mjs
```
