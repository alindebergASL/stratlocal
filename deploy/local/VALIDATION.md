# Validation

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
