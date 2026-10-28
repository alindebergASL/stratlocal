# Review findings and implementation implications

Recorded 2026-10-27. Baseline: upstream Strategy `590acd78141ec0f8ef4599fd4e5e337019a7440b`; local foundation published at `1a581db5a4f3287b07d8e1018e7fa10c63092734`. This is a scoped engineering assessment, not a claim that the application is production-qualified or free of security defects.

## Reuse the existing application

The Next.js/TypeScript + SQLite application already contains account planning, contacts, opportunities, meeting workflows, documents, proposal review and change history. Extend those concepts rather than create a second native application or a parallel account database. Preserve the principle: agent proposes, system validates, user ratifies, application commits.

## Findings that determine the next work

| Finding | Location or evidence | Required response |
| --- | --- | --- |
| Import starts an AI run before the detached import job | `lib/import/run.ts`, `startRun` and `runDetached` | Give deterministic package parsing a provider-independent path; the local cloud-AI gate must not block valid JSON imports |
| Existing AI/import execution is detached from the request process | `lib/ai/guard.ts`, `lib/import/run.ts` | Migrate intended long-running work to durable jobs; adding a maintenance queue alone does not migrate existing flows |
| The provider seam is Anthropic/Bedrock-specific | `lib/ai/client.ts`, `lib/ai/runStructured.ts`, `lib/ai/models.ts` | Introduce explicit provider capabilities before adding local adapters; no silent cloud fallback |
| PDF extraction merges pages | `lib/documents/text.ts` | Preserve page/section anchors for traceable citations; report scanned/no-text documents explicitly |
| JSON text extraction has a 400,000-character limit | `lib/documents/text.ts` | Do not use truncated text as an authoritative package payload; validate the original bytes and disclose extraction limits |
| The existing proposal layer is valuable | `lib/proposals/apply.ts` | Reuse review and conflict checks; imports must not directly overwrite accepted state |
| Native Swift template does not fit the selected stack | Earlier supplied reference artifact; not shipped as an implementation | Keep unused. Its summarized/reviewed behavior was insufficient evidence of complete validation and atomicity; use TypeScript application services |
| Upstream continued changing during the review | Upstream reached `399ca168d01a6b0a57eafd1bc66a315d5a4b926a`, 22 commits beyond the reviewed baseline | Pin provenance and review later changes deliberately; do not imply this snapshot includes current upstream features |

## Foundation implemented

The separate local deployment adds a loopback port, persistent private volume, local HTTP login configuration, explicit cloud-AI refusal, system fonts, browser connection restrictions, a network-isolated worker, and backup/restore commands. The queue has durable request IDs, a single active lease and stale-owner fencing. Only a local integrity-check handler is currently enabled; long-running handlers still need heartbeat/cancellation behavior.

The configured app network is internal and the worker has no network. These are configuration facts; Docker isolation on the target Mac has not been exercised. The app is intended for localhost and should not be exposed as a public service with this cookie/deployment configuration.

## Verification boundary

- Production build and TypeScript passed in the development workspace.
- Fresh synthetic database bootstrap, production-server login, authenticated home and CSP were exercised.
- Cloud provider denial, queue deduplication/recovery/fencing, and backup/restore with corruption rejection passed.
- Regression suite: 1,630 passed, one failed. The failure was the existing S3 network test expecting a timeout while this workspace returned ENETUNREACH. It is not a passing test or a new local-foundation regression.
- Docker image execution, Apple silicon native dependency behavior, Mac isolation and physical two-user operation remain unverified.

See [detailed foundation validation](../deploy/local/VALIDATION.md). Existing upstream status documents describe their own historical work; they do not establish local-pilot acceptance.

## Import correctness requirements

Before implementing package import, define and test these behaviors:

1. Validate all required files, exact sizes, hashes, schema and account identity before proposal creation. Reject unsafe paths, symlinks, oversized content and ambiguous duplicate filenames.
2. Distinguish identical replay from package-ID reuse with changed content. Compare a stored manifest/content fingerprint as well as the package ID.
3. Scope revision ordering by account and producer stream. A higher revision is not proof of authority; conflicting branches require review.
4. Commit import ledger, evidence references and proposal creation atomically. An interrupted job must not leave accepted records partially changed.
5. Apply accepted proposals against their recorded base state. Preserve intervening user edits and expose conflicts.
6. Treat missing records as absent evidence unless the contract explicitly declares an authoritative deletion scope. Never infer deletion from failed collection.
7. Render imported HTML without active scripts or remote fetches. Preserve the original separately from its safe display representation.
8. Preserve evidence anchors and extraction warnings. Generated summaries remain attributable proposals, not source facts.

## Document coverage

Planning inputs discussed during discovery include structured account JSON, HTML dossiers and dashboards, PDF executive briefs, Markdown playbooks, and PowerPoint briefings. These imply both per-account and territory-wide evidence. Do not force every document into a single account or assume every HTML dashboard is a complete account snapshot. Source documents remain outside this public repository; examples committed later should be synthetic.
