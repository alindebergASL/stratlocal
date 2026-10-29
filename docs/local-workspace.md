# StrategyLocal workspace

This is a personal local workspace, not a cloud deployment or a clone of all upstream workflows. Accounts are the starting point. MyAgent research is brought in as files; no MyAgent API connection or subscription credentials are needed. No model is required for account editing, meetings, importing, source review, or proposal acceptance. Bedrock and Anthropic stay off by default.

## First workflow

Complete [base Mac setup](../deploy/local/README.md) first. The steps below describe the current local UI; model drafting is optional and requires the separate model checks.

1. Create/select an account. If you need initial research, start with [new account intake](#new-account-intake-request) below; existing evidence is not required. If you already have reference files or a MyAgent package, open **Evidence & MyAgent** and import them.
2. In **Imports & tasks**, inspect the originals, extraction warnings, and account identities. Choose a target account explicitly for uncertain matches. Approving a name alias never overrides a conflicting CRM ID.
3. **Prepare proposals** links the sources and territory snapshot. Accept/reject account changes in **Review changes**. Accept/reject metric observations on the package page. Neither import nor model execution accepts account changes automatically.
4. Prepare a MyAgent request: enter the research question and select sources. Copy the prompt, download the request ZIP, or write it to the exchange folder. Hand it to MyAgent yourself, then import the response.
5. Create a meeting from the account. Select its evidence and meeting when drafting a brief. Capture meeting notes and follow-up actions. Proposed questions, hypotheses, and customer-confirmed answers are separate records; confirmations require speaker, time, and an exact source quotation.
6. Optionally, with a configured local model, review a model draft, edit it, and accept it. Accepting an account-plan draft explicitly replaces the account thesis. Other accepted drafts remain saved text for copying into notes/actions; nothing is sent or scheduled.

## Continue work on an account

The **Needs attention** panel on an account's Overview links to pending changes, overdue and due-today follow-ups, open opportunities missing a next step, and the current or next meeting. It reads saved records, respects next-step waivers, and excludes archived records and merged meetings/deals. Follow-up dates use the app's configured timezone. The panel previews up to five due follow-ups, with a link to the full list.

In **Evidence & MyAgent**, **Saved MyAgent requests** shows your five most recent requests for that account. Use **Open saved request** to read or copy the full prompt and download its original ZIP; Markdown downloads are also available in the list. **View all saved requests** appears when there are more than five, with pages of twenty. The history includes only requests prepared by your signed-in user. Preparing or downloading a request does not establish that it was sent to MyAgent. Saved prompts keep the account details they were prepared with; create a new request after changing the account identity or research scope.

## Meeting evidence and customer confirmations

To attach an imported original to a meeting, open its evidence page, choose **Target account**, then choose **Meeting (optional)** and select **Link original**. The meeting picker lists only active meetings for that account and clears when you change accounts. Leave the meeting empty to link account evidence only. Saved meeting links appear beside the linked account.

On a meeting, expand **Discovery questions & customer confirmations**. A **Proposed question** or **Hypothesis** can be saved without source attribution; neither becomes a customer-confirmed answer automatically. To record something the customer actually confirmed:

1. Select **Customer-confirmed answer**, enter the question, answer, and speaker.
2. Choose **Confirmation time** in your browser's timezone, which the form displays. The app saves a timestamp with a timezone; saved records display the app timezone beside their time. Invalid dates and nonexistent daylight-saving times are rejected.
3. Choose **Source file**, then its **Page, slide, or section**. Only evidence already linked to this account is offered. The source preview loads locally; no model or external service is called. If there are more than 100 readable locations, use **More locations** or **Previous locations**.
4. Copy an exact quotation into **Exact source quotation**, up to 1,000 characters. A passage preview shows up to 12,000 characters; **Open full source in a new tab** opens the complete extracted location and original-download link. Changing the file or location clears the quotation. Unreadable files require a readable transcript or replacement source before they can support a confirmation.
5. Select **Save discovery record**. The server checks the account, active meeting, source membership, timestamp, and exact quotation. A saved answer shows its quotation and **Inspect confirmation source** link. The form resets after a successful save.

These checks establish where the quotation came from, not whether its author was correct or the customer actually confirmed it. That classification remains your explicit choice. Stale forms cannot add records or evidence links to archived or merged accounts/meetings.

## New account intake request

The account **Overview** now separates general account information from your account plan. Accepted `report.account.summary` appears as the researched overview, with legal entity, headquarters, region, segment, and CRM identifier. Linked briefing/research files are shown directly on the overview, with the newest preview open. Research remains source-attributed material, not customer-confirmed answers.

Customer people belong in `report.contacts`; `report.team` remains the internal seller team. Preparing proposals includes customer-contact and overview proposals; accept them in **Review changes** to populate People and the account overview. For previously imported packages, use **Prepare overview & people proposals** on the account overview or import page. This also recognizes `contacts` or `stakeholders_and_executives` arrays in identity-matched JSON evidence (including first_name/last_name). It does not infer people from free text, arbitrary nested structures, or seller-team records. Ambiguous/merged/cross-side matches, invalid fields, and conflicting titles produce import warnings; existing populated contact fields remain unchanged. Repeating preparation does not duplicate pending or accepted changes, and rejected identical proposals stay rejected.

Older files without `report.account.summary` still display their briefing as research, but need a new package with that field to populate the accepted overview. New requests include that field's instructions and a customer contacts array. Existing prompts and originals are not rewritten. This update adds an account-summary database column; take the documented backup before rebuilding.

At the bottom of an account’s **Evidence & MyAgent** page, use **Prepare a MyAgent request for new account intake**. It works before you have imported evidence. The request uses the saved account name and CRM ID; you can add an optional website, research focus, selected originals, and exchange-folder delivery.

Select **Prepare new account intake request** to review a complete Salesforce-plus-web prompt covering active opportunities, stakeholders, activities, commercial history, public priorities, technology/procurement research, engagement hypotheses, and meeting preparation. The prompt specifies the compatible response ZIP format and keeps unsupported CRM fields in evidence rather than inventing mappings.

On the request page, use **Copy request**, **Download prompt (.md)**, or **Download request & selected originals**. Give the result to MyAgent yourself; preparing it does not call Salesforce, MyAgent, or an AI provider. Import MyAgent’s returned ZIP into the account and review its mappings and proposals. Correct the saved name/CRM ID under Account Details before preparing a request if they identify the wrong organization.

For your first intake:

1. Check the saved account identity, then open **Evidence & MyAgent** and scroll to the bottom intake section. If it is missing, follow [update an existing installation](../deploy/local/README.md#update-an-existing-installation).
2. Optionally enter the account website and additional research focus. Leave evidence unselected for an empty account. Leave exchange-folder delivery unchecked unless you have configured that option.
3. Select **Prepare new account intake request**. Review the generated account name, CRM ID, and research scope.
4. Copy the request or download its Markdown file. If you selected originals, download the request ZIP to include them. Give the prompt and relevant files to MyAgent in a session with authorized Salesforce and web connectors. StrategyLocal itself does not need those connector credentials.
5. Ask MyAgent to follow the prompt and return the ZIP containing root `manifest.json` and the referenced evidence files. The prompt requests active deals plus web research; it requires MyAgent to report missing access, incomplete searches, and ambiguous account matches. Resolve those gaps before treating the package as complete. A text description of a ZIP is not a downloadable package.
6. Return to the same account and import the actual response ZIP. Review account mappings, extraction warnings, sources, and proposed changes before accepting them. Retain the distinction between customer-confirmed evidence and proposed questions or hypotheses.

A standalone [Markdown prompt template](MyAgent_StrategyLocal_Account_Package_Prompt.md) is also available. Replace every account-name placeholder; supply the Salesforce account ID only if verified, and have MyAgent use the actual retrieval date in the returned manifest. The in-app request automatically fills the saved identity and embeds its matching manifest template.

## Package contract (version 1)

### Coverage and duplicate-deal review

Each mapped account's import review shows a **Research coverage & next steps** panel. It compares the number of structured deals with identity-matched JSON evidence containing `pipeline_telemetry.total_open_pipeline_opportunities_count` or `coverage.opportunities.total_matching`. A mismatch is visible as partial or conflicting coverage; an absent total remains unknown. Reported totals are not independently verified, and monetary amounts are not converted into account metrics. **Prepare MyAgent follow-up for gaps** creates an editable local request with the full intake instructions. Hand it and relevant originals to MyAgent yourself.

If an incoming deal has a different identifier but the same normalized name as an existing deal (including archived deals), proposal preparation stops before changing anything. The review lists both identifiers. Correct mistaken IDs, or explicitly check the distinct-opportunities confirmation only when these truly are separate opportunities. The app never merges them by name. This check does not detect every renamed or similarly named duplicate, so review changed identifiers carefully.

If two local packages propose creating the same customer contact or play before either is accepted, acceptance checks the current saved records again. A later matching creation becomes a conflict with instructions to review/update the existing record or restore it if archived. It does not merge or overwrite the record. Contacts with different supplied email addresses remain distinct under the existing identity rules. Review a conflict to decide whether the records represent the same person or play; this check cannot establish identity from a name alone.

### Flexible input handling

The importer resolves noncanonical source locations when a unique extracted heading or an exact quotation identifies a section. The saved review manifest records the resolved location and a warning explains the adjustment; original file bytes remain unchanged. Ambiguous locations and quotations absent from the source still block import. An explicit canonical location with a mismatched quotation is not silently redirected.

For customer people, recognized role spellings are normalized. Descriptive roles are retained in notes with no inferred buying authority, rather than causing the whole contact to be dropped. Invalid email addresses are omitted while the person remains reviewable. For manifest contacts, an email must also appear on a matching contact in the package's JSON evidence to enter the People proposal; otherwise it stays only in the original and a warning asks you to verify it manually. This corroboration is not independent verification of the source. Other malformed fields and account identity conflicts still require correction.

After updating the app, open a failed or cancelled import and select **Retry import** to rerun its preserved original with the current parser. Retrying reuses the original file and task, resets its attempt count, and requires the task to have stopped; wait for a running cancellation to finish. This also recovers imports left queued by older versions after their task failed or was cancelled. Only the user who uploaded the import can retry it. For an already processed package whose contacts were skipped, use **Prepare overview & people proposals** instead. Existing accepted records are not rewritten automatically. Inspect import warnings and proposed changes before accepting them.

The import review includes a package overview (as-of date, source namespace, account/file/metric counts), readable account fields, and expandable opportunities, seller-team records, installed-base records, and proposed plays. Expand **Research, stakeholders & source detail** files to read the source briefing, customer contacts, activity history, research, and limitations before accepting changes. Source previews show up to 12,000 characters per file and link to all extracted sections and the original. Missing structured records are labeled as not supplied, rather than treated as proof that none exist. The original reported JSON remains available for inspection.

New intake requests ask for a substantive account assessment, a retrieval coverage ledger, all accessible active opportunities, detailed priority-deal reviews, stakeholder relationships, broader business/funding/procurement research, and a proposed 30/60/90-day plan. Prepare a new request to get the updated prompt; previously saved requests and imported packages retain their original contents. Added detail depends on MyAgent's source access and evidence, and the app does not invent missing information.

If a Salesforce records JSON fails with **Account account needs account.name** (or the newer explanatory message), check which file you selected. A raw records export such as `Iowa_Salesforce_Records.json` is evidence inside the response package, not necessarily a structured account report. Import the complete response ZIP with `manifest.json` at its root and all referenced evidence files. If MyAgent supplied only separate files, ask it to assemble the response ZIP according to the intake prompt, with the exact saved account name in `accounts[].report.account.name`. Do not simply rename Salesforce `Name` fields or add a guessed identity to bypass account matching. A standalone structured report uses `account.name` at its root; the actual JSON must be inspected to determine whether it matches that contract.

A ZIP contains root `manifest.json` and source files at the paths it names. JSON-only single-account reports also work. PDF, PPTX, DOCX, HTML, Markdown, and text originals can be imported as reference evidence. PPTX extraction includes slide order and speaker notes; PDF extraction cites pages. OCR and full deck generation are not included.

```json
{
  "version": 1,
  "namespace": "myagent",
  "as_of": "2026-10-01",
  "artifacts": [{"path": "sources/brief.md", "audience": "internal", "author_labels": ["R", "I"]}],
  "accounts": [{
    "key": "orchard",
    "report": {"account": {"name": "Synthetic Orchard Lab", "crm_id": "SYN-001"}, "team": [], "deals": [], "install_base": [], "plays": []},
    "sources": [{"path": "sources/brief.md", "locator": "section:1", "quote": "Synthetic evidence"}]
  }],
  "territory": {"name": "Synthetic West", "account_keys": ["orchard"], "reported_member_count": 1},
  "metrics": [{
    "key": "wallet-2026", "account_key": "orchard", "measure": "wallet", "value": 100,
    "unit": "USD", "period_start": "2026-01-01", "period_end": "2026-12-31",
    "definition": "Synthetic estimated addressable spend, not bookings",
    "source": {"path": "sources/brief.md", "locator": "section:1"}
  }]
}
```

Structured report fields follow [the existing MyAgent JSON contract](myagent-import.md). Omit unknown records rather than inventing IDs. Narrative-only material is reference evidence; it does not become structured facts automatically. Locators are `page:1`, `slide:1`, `slide:1:notes`, and `section:1`. Exact quotes and named locators are checked against extracted text. Omit a locator if unknown, then inspect the resulting source page. Author labels and audience are assertions from the supplied material, not proof of accuracy. Mark internal content `internal` even when its filename says “Executive Briefing.” Document instructions are never installed as skills or executed.

Wallet, pipeline, bookings, and installed base are separate observations with units, period, definition, scope, and source. Omitting `account_key` on a metric means a reported territory observation, which requires `territory`. Territory totals are not added to account figures. Inconsistent reported member counts are warnings; no geographic count is inferred from prose.

Uploads are limited to 25 MB compressed, 100 MB expanded, 20 MB per ZIP member, and 500 entries. ZIP traversal, encrypted members, symlinks and duplicate paths are rejected. Original bytes are kept with SHA-256 hashes even when text extraction fails. Text omissions are visible. Model context is deliberately limited to 9,000 source characters, up to 3,000 per segment, with omissions shown before execution.

## Optional exchange folder and local models

Follow [the checked, step-by-step optional Mac setup](local-model-setup.md). It includes prerequisites, private secret-file permissions, two-way exchange-folder checks, Apple/Ollama availability, host and Docker bridge checks, and commands for enabling both options together. Native Mac execution is still unverified; a failed check is a stop condition, not an instruction to expose the helper or enable cloud AI.

The helper is a foreground process and must stay running for model tasks. MyAgent is still a manual exchange. External AI stays disabled unless explicitly enabled in Advanced settings and separately approved for each task.

## Persistence, backup, and recovery

The existing SQLite database now also stores package mappings, provenance, metrics, model tasks, drafts, and confirmations. A timestamped SQLite snapshot is written before upgrading an existing database to migration `048_local_workspace`; original files are not rewritten. Use [the full backup workflow](../deploy/local/README.md#backup) before upgrading and for routine backups: it captures SQLite and `data/docs`, including immutable originals and request packages. Restore into a new directory/volume and verify before switching. Mac Keychain credentials and bridge tokens are intentionally separate; reinstall/reconfigure them after migration to a new Mac.

The application owns a durable import/model task queue: one active lease, heartbeat, cancellation, idempotent request IDs, and at most three attempts after interrupted leases. It resumes after app restart. Terminal failures remain visible. Use **Retry import** for the same preserved original after a transient interruption or parser update; upload a corrected package when its content needs changing. Failed model tasks require a fresh preview/request. The separate maintenance worker still owns its pre-existing maintenance queue. This is one personal installation; never put a live SQLite database on a shared/synced drive. User attribution is retained for later export/multi-user work, but partner synchronization is not implemented.

Validation on Linux covers import and queue behavior, mocked model boundary/approval tests, TypeScript, production build, and browser flow. Actual Apple inference, Keychain authorization, and Docker Desktop-to-Mac connectivity require a Mac acceptance run; they are not claimed validated by the Linux tests.
