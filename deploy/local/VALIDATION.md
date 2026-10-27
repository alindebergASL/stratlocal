# Validation

Completed in Linux workspace using Node 22:
- TypeScript check passed.
- Next.js production build passed after replacing a development-only node_modules symlink with local dependencies.
- Production standalone server started with a fresh synthetic database; login, initial user bootstrap, local cookie, authenticated home and local CSP passed.
- Cloud-provider denial test passed with dummy credentials present.
- SQLite queue persistence, deduplication, conflicting request rejection, single worker lease, recovery and stale-owner fencing passed.
- Backup/restore round trip preserved synthetic database row and original document bytes. Tampered payload and existing destination were rejected.

Docker CLI/daemon is unavailable in this workspace. Dockerfile execution, Compose launch, Apple silicon native dependencies, internal-network isolation and Mac backup bind mounts remain unverified. Local model support and package import are not implemented by this stage.

Full regression suite: 1,630 passed, one failed (185 files passed, one failed). The remaining failure is the existing `tests/setup.test.ts` S3 timeout expectation: this workspace returns ENETUNREACH instead of a timeout. It was also present in the reviewed baseline. The two standalone Node test suites additionally passed.

Commands:
```sh
npm run typecheck
STRATEGY_LOCAL_ONLY=1 NEXT_TELEMETRY_DISABLED=1 npm run build
npx vitest run
node --test tests/localQueue.node-test.mjs tests/localSnapshot.node-test.mjs
node deploy/local/smoke-example.mjs
```
