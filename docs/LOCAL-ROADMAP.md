# Local application roadmap

This roadmap separates the implemented foundation from intended functionality. Target hardware is an Apple-silicon MacBook Pro with 24 GB RAM. MyAgent's role and evidence limits are in [MyAgent integration](MYAGENT-INTEGRATION.md); engineering constraints are in [review findings](REVIEW-FINDINGS.md).

| Stage | Deliverable | Acceptance boundary |
| --- | --- | --- |
| 1. Foundation | Existing app in a local container; private persistence, login, offline policy, maintenance queue, backup/restore | Implemented and workspace-tested; physical Mac checklist remains pending |
| 2. Package proposals | Deterministic JSON manifest validation and staging, independent of AI providers | Import both synthetic revisions, replay without duplicates, reject corruption, preserve user edits, recover interruption |
| 3. Evidence/document mapping | Original files plus page/section citations; account and territory scope; structured planning-field mappings | Trace each proposal back to evidence; display extraction warnings; no silent truncation |
| 4. Local intelligence | Native Ollama and Apple model bridge with explicit capabilities | Confirm available models on the actual Mac, resource use, cancellation, structured-output validation, no cloud fallback |
| 5. Workflow refinement | Account/territory views and meeting/action workflows using accepted evidence | Complete a useful account-planning journey with review and durable saved state |
| 6. Optional collaboration | Shared-package retrieval, Webex requests, then separately authored-edit sync | Authenticate each user; verify real downloads and replay; resolve conflicting edits; never sync live SQLite |

## Immediate sequence

1. Start the published container on the Mac and complete the [Mac acceptance checks](../deploy/local/README.md#mac-acceptance-checks-still-required).
2. Freeze a versioned import contract using the existing synthetic fixtures without changing their original IDs or bytes.
3. Implement deterministic staging and reviewable proposals in the existing TypeScript app. Add meaningful duplicate, corruption, stale/base-conflict and interrupted-commit tests.
4. Only then add document extraction and model-assisted work, routed through the same review boundary.

Native model processes will live outside the Linux container. Their future authenticated local bridge will require a deliberate exception to the current container network policy; setting an Ollama URL alone is not sufficient. Benchmark on the actual machine before choosing model sizes or promising throughput.

## Completion language

Track export generation, validation, delivery, user download, import staging, and accepted state separately. A message saying a file exists is not file delivery. A recorded request mapping is not proof of a fresh-session artifact retrieval. A unit simulation is not a physical two-device test.

Do not add recurring polling, cloud model calls, account connections, or a separate native client as implicit parts of this roadmap.
