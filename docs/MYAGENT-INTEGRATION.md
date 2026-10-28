# MyAgent capabilities and role in StrategyLocal

Decision record: 2026-10-27. This document summarizes the project's supplied MyAgent reports and the user's download confirmation. It is not a fresh audit of the enterprise agent platform. Capabilities depend on the tools and permissions available to that deployment.

## Division of responsibility

**MyAgent gathers and exports; StrategyLocal validates, proposes and records human decisions.**

MyAgent is the external research and collection system. Its intended sources include authorized Salesforce records, public intelligence, and meeting information. StrategyLocal is the user's local account-planning workspace. It should preserve original evidence, display proposed changes, and apply only changes the user accepts. Imported instructions never acquire authority to operate tools or change application policy.

The local app does not initially need Salesforce, email, calendar, Webex or cloud-model credentials. A person requests an export from MyAgent, downloads the files, and imports them locally. This manual handoff is the verified pilot delivery route; the importer itself is still planned.

## Capability and evidence ledger

| Capability | Evidence and status | Consequence for the app |
| --- | --- | --- |
| Gather Salesforce, public intelligence and meeting information | Intended agent role and reported platform capabilities; not an end-to-end verification of every source connector | Export source IDs and provenance; do not assume every source was accessible |
| Produce versioned JSON plus readable HTML | Synthetic revision 1 and revision 2 packages reported and reviewed in project testing | Prefer structured JSON for deterministic field mapping; retain the HTML as evidence |
| Deliver individual files in chat | **Verified pilot delivery**: user confirmed downloaded manifest.json, account.json and brief.html were byte-identical, with payload hashes matching | Preserve the working file-upload + native chat-attachment method |
| Webex interactive text response | Reported live delivery telemetry and a correlated response were supplied | Useful optional request/status channel; text delivery does not establish file delivery |
| Webex inbound interactive message capture | Reported live message capture | Supports manually initiated agent requests; does not prove unattended app-to-agent execution |
| Webex unattended execution | Requires a configured gateway or polling mechanism; not established here | No background integration or recurring job in this pilot |
| Webex outbound approval | MyAgent reported a platform human-approval requirement for interactive sends | Respect that platform gate; do not assume unattended completion replies |
| SharePoint/OneDrive search and reading | Reported available and tested in MyAgent | Reading does not imply upload permission or upload-tool availability |
| Arbitrary JSON/HTML upload to OneDrive/SharePoint | **Blocked in the tested toolset**; reported upload support was limited to generated PowerPoint | A future general file-upload connector is required for agent-managed publishing |
| Direct ZIP download | **Unverified**; raw cloud URLs failed for the user | Never manufacture a URL or label a stored object as delivered |
| Persistent request lookup | MyAgent reported LTM mappings and cached replies | Treat as reported persistence, not independently proven durable deduplication |
| Fresh-session replay with accessible original artifact | Not independently established as a complete retrieval-and-delivery test | Require a real fresh-session replay and verified bytes before calling it passed |
| Automatic client retrieval | **Unverified** | Keep manual import first |
| Two physical Macs and a second user's access | **Unverified** | Do not promise multi-user sync or inherited access |

Two-consumer Python simulations exercised duplicate handling, revisions, corruption and interrupted processing. These are simulation evidence, not two-device acceptance tests. SHA-256 checks detect byte changes against a manifest; they do not authenticate the publisher. No cryptographic package signature has been established by this test.

## Planned handoff

1. User asks MyAgent for a versioned account export with a stable request ID.
2. MyAgent looks up the existing request before starting work. Reusing an ID with different parameters must be rejected.
3. For a new request, MyAgent collects permitted information and exports structured records plus original supporting files. It explicitly reports inaccessible sources and validation warnings.
4. MyAgent attaches the actual manifest and payload files using the working attachment route. Export completion, message delivery, file delivery and user download are separate statuses.
5. The user selects the downloaded package files in StrategyLocal. No automatic retrieval is implied.
6. StrategyLocal validates completeness, sizes, hashes, schema, account identity and revision lineage, then stages evidence and a reviewable proposal.
7. The user accepts, rejects or defers changes. Accepted changes are applied transactionally with provenance and an audit trail. Re-importing the same package creates no duplicate proposals or records.

## What an export should preserve

The pilot uses `manifest.json`, `account.json`, and `brief.html`. Additional PDF, HTML, JSON, Markdown or other supported originals should remain separate, declared payloads. This is a proposed contract direction, not a published final JSON Schema.

- Immutable package ID; stable account and source-record IDs.
- Schema version, producer identity, revision and prior package ID, scoped to an explicit producer/account stream.
- Original generation time in RFC 3339 UTC. Request receipt time, delivery time and refreshed-link time are separate fields.
- Per-file name, exact byte length, media type and SHA-256 over the delivered bytes.
- Source references and observation timestamps, distinguishing sourced facts from synthesis and inference.
- Completeness scope, missing-source warnings and validation errors. Missing information is not an instruction to delete accepted records.
- Explicit snapshot/delta semantics. A full snapshot can be staged without every earlier snapshot when its scope is complete; a dependent delta needs its declared base.
- Synthetic-data classification when applicable.

Keep existing test packages immutable. Add future requirements through explicit schema versions or a documented compatibility adapter; do not retrofit old artifacts under the same package ID. Do not silently regenerate an unavailable cached artifact and call that a replay.

## Working operating constraints

MyAgent should continue gathering information and exporting packages. It should not generate a separate Swift/CoreData client, modify this application's implementation, or register a new enterprise skill as part of the export workflow. The previously generated Swift module is an unused reference artifact, not part of StrategyLocal.

The sample export request must use valid JSON, including `"synthetic_only": true` rather than a key with no value. Requests are control data; all downloaded documents remain untrusted source content.

## Future integrations

- **Shared folder:** exchange immutable packages, not a live SQLite database. A sync client does not solve MyAgent's missing upload capability. Partial downloads and cloud placeholders must not be ingested.
- **Two users:** independently validate/import the same evidence. Synchronizing accepted edits is a separate feature needing authorship, permissions and conflict resolution; package distribution alone is not bidirectional sync.
- **Webex:** use request IDs and explicit job states. Verify authenticated user identity, destination access, approval behavior, attachment retrieval and fresh-session replay before automation.
- **Local models:** native Ollama and an Apple model bridge may summarize or extract evidence into proposals. They do not replace deterministic validation or human acceptance. Both adapters remain unimplemented.

No further transport tests were requested at the end of the pilot. Keep unverified routes marked as such until their implementation stage is explicitly undertaken.
