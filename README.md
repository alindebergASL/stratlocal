# StrategyLocal

Local account-intelligence workspace for macOS, based on the reviewed Strategy Next.js/TypeScript + SQLite application.

**Start here: [Mac container setup](deploy/local/README.md)**

**Bedrock is not required. Cloud AI is off by default.** Prompt MyAgent separately, then bring its results into this local workspace. [Import MyAgent JSON for review or keep research documents as references](docs/myagent-import.md).

## Foundation pilot

- Loopback-only browser access and persistent local storage.
- Local login, cloud-AI blocking, and isolated container networking.
- Durable maintenance-job queue and backup/restore tools.
- Original Strategy account-planning UI and data model.

Single-account structured JSON imports now work without AI. Apple Foundation Models, Ollama, and multi-document MyAgent package imports remain future work.

## Validation

Production build, TypeScript, real login, queue recovery, and backup/restore checks passed in a Linux workspace. The regression suite had 1,630 passes and one pre-existing S3 connectivity test failure. Docker launch, Apple silicon execution, and network isolation on a physical Mac remain unverified.

See [validation details](deploy/local/VALIDATION.md), [pilot overview](START-HERE.md), and [upstream documentation](docs/UPSTREAM-README.md).

See the [import review and roadmap](docs/local-import-roadmap.md) for current identity safeguards, local document-upload behavior, and the territory/engagement import acceptance criteria.

## Source provenance

This project starts from alindebergASL/strategy commit `590acd78141ec0f8ef4599fd4e5e337019a7440b`, with local-foundation changes. It is a source snapshot, not a fork preserving upstream Git history.
