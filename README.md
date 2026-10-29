# StrategyLocal

A personal local account-planning workspace for macOS. MyAgent supplies research through prompts and imported files. Local models can help draft summaries, plans, meeting briefs, and follow-ups.

**Start here: [Mac container setup](deploy/local/README.md) · [Workspace and model guide](docs/local-workspace.md)**

Already installed? Follow [update and verify](deploy/local/README.md#update-an-existing-installation). For an empty account, use [new account intake](docs/local-workspace.md#new-account-intake-request) to prepare one MyAgent request for Salesforce active deals and web research, with Markdown or ZIP download.

**Bedrock is not required. External AI is off by default**, with optional per-task use under Settings → Advanced. Accounts, imports, source review, meetings, and manual planning work without any AI provider.

- Account-centered navigation, territory snapshots, and separate sourced metric observations.
- Reviewed MyAgent packages and a configurable shared exchange folder.
- Immutable originals with PDF page, PowerPoint slide/speaker-note, and document-section citations.
- Explicit account matching, proposal review, and separate questions, hypotheses, and customer confirmations.
- Optional Ollama and Apple Foundation Models bridge; no automatic external fallback.
- Durable import/model jobs, local SQLite storage, and backup/restore tools.

The [workspace guide](docs/local-workspace.md) documents the version-1 package contract, workflows, model setup, and limitations. This is one local installation; never share a live SQLite database between Macs.

## Validation

The production build, TypeScript, focused import/model/queue tests, and a real Chromium workflow pass in Linux. The full inherited suite still has two pre-existing failures: an AWS credential/timeout expectation and a date-sensitive brief assertion. Actual Apple inference, Keychain access, Docker Desktop-to-Mac connectivity, and physical-Mac network isolation require Mac validation.

See [validation details](deploy/local/VALIDATION.md). Run the local browser regression after a build with `node e2e/local-workspace.mjs` (Chromium at `/usr/bin/chromium`, or set `PLAYWRIGHT_CHROMIUM_PATH`). It uses a fresh temporary database and a synthetic model bridge; it does not validate a native model.

## Architecture and integration

- [Review findings and implementation implications](docs/REVIEW-FINDINGS.md)
- [MyAgent capabilities, evidence ledger and integration design](docs/MYAGENT-INTEGRATION.md)
- [Local application roadmap and acceptance gates](docs/LOCAL-ROADMAP.md)

## Source provenance

This project starts from alindebergASL/strategy commit `590acd78141ec0f8ef4599fd4e5e337019a7440b`, with local-foundation changes. It is a source snapshot, not a fork preserving upstream Git history. The original repository is unchanged. [Upstream documentation](docs/UPSTREAM-README.md) describes inherited capabilities, not local setup requirements.
