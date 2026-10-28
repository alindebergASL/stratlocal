# StrategyLocal — local foundation pilot

Start with [Mac setup instructions](deploy/local/README.md).

No Bedrock or other cloud AI account is needed. Cloud AI is off by default. Prompt MyAgent separately and use the [local import workflow](docs/myagent-import.md) for structured JSON or reference documents.

This is a source snapshot of the reviewed Strategy version plus a separate local deployment. It is not yet the finished account-package import application. The existing root README describes the upstream cloud application; use `deploy/local/README.md` for this pilot.

Included: Docker configuration, persistent storage, local login, cloud-AI refusal, system fonts, offline network configuration, durable maintenance-job queue, backup/restore tooling and tests.

Validated: production build, TypeScript, real login, cloud-AI gate, queue recovery, backup/restore. Full suite: 1,630 passed and one existing S3 connectivity expectation failed in this environment. Docker and physical Mac acceptance remain unverified.

Next milestone: launch this container on the M4 Pro and pass the Mac acceptance checklist, then implement deterministic package validation and reviewable import proposals. Apple/Ollama model adapters follow the provider boundary work.
