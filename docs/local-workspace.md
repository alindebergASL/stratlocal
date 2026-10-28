# StrategyLocal workspace

This is a personal local workspace, not a cloud deployment or a clone of all upstream workflows. Accounts are the starting point. MyAgent research is brought in as files; no MyAgent API connection or subscription credentials are needed. No model is required for account editing, meetings, importing, source review, or proposal acceptance. Bedrock and Anthropic stay off by default.

## First workflow

1. Create/select an account. Open **Evidence & MyAgent** and import reference files or a MyAgent package.
2. In **Imports & tasks**, inspect the originals, extraction warnings, and account identities. Choose a target account explicitly for uncertain matches. Approving a name alias never overrides a conflicting CRM ID.
3. **Prepare proposals** links the sources and territory snapshot. Accept/reject account changes in **Review changes**. Accept/reject metric observations on the package page. Neither import nor model execution accepts account changes automatically.
4. Prepare a MyAgent request: enter the research question and select sources. Copy the prompt, download the request ZIP, or write it to the exchange folder. Hand it to MyAgent yourself, then import the response.
5. Create a meeting from the account. Select its evidence and meeting when drafting a brief. Capture meeting notes and follow-up actions. Proposed questions, hypotheses, and customer-confirmed answers are separate records; confirmations require speaker, time, and an exact source quotation.
6. Review a local model draft, edit it, and accept it. Accepting an account-plan draft explicitly replaces the account thesis. Other accepted drafts remain saved text for copying into notes/actions; nothing is sent or scheduled.

## Package contract (version 1)

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

## Optional watched exchange folder

Create a dedicated folder on your Mac and set `STRATEGY_EXCHANGE_HOST_DIR` in your Compose environment. Add `-f deploy/local/compose.exchange.yaml` to the base Compose command, then enable watching in **Settings**. Ensure the container user can write the mounted folder.

The app creates `Requests`, `Incoming`, and `Processed`. Prepared requests can be written to `Requests`; MyAgent response packages go into `Incoming`. Files must be stable for five seconds. `.part`, `.tmp`, hidden files, and symlinks are ignored. Valid imports move to `Processed` only after extraction succeeds. Failed files remain in `Incoming`; edit the file contents to submit a corrected package. Duplicate content does not create duplicate tasks. The exchange directory is a server-configured mount, not a path supplied by a document.

## Optional local models on a Mac

Requirements: Node 22, repository dependencies (`npm ci`), Xcode command-line tools. Apple Foundation Models additionally require macOS 26+, an SDK with FoundationModels, supported Apple Intelligence hardware, enabled Apple Intelligence, and downloaded system models. Ollama must be installed/running separately with the desired model already downloaded. The app never downloads models or switches to an external model on failure.

```sh
bash deploy/host/install.sh
node deploy/host/server.mjs
```

The installer creates a private token and compiled Swift helper under `~/.strategylocal-models`. The Node bridge runs in the foreground on **127.0.0.1:4242**, talks to Ollama at **127.0.0.1:11434**, and invokes the native helper for Apple models and macOS Keychain. Keep it running while using models. Stop it with Ctrl-C. On older SDKs the helper can still handle Keychain, but reports Apple models unavailable.

For a local Next development server, set `MODEL_BRIDGE_URL=http://127.0.0.1:4242` and `MODEL_BRIDGE_TOKEN_FILE` to the absolute token path. For Docker Desktop, set `MODEL_BRIDGE_TOKEN_PATH` to that file and run:

```sh
docker compose -f deploy/local/compose.yaml -f deploy/local/compose.models.yaml --env-file deploy/local/.env up --build -d
```

The optional gateway accepts only authenticated model operations and forwards to the fixed Mac host endpoint. The app remains on its internal Docker network; the gateway publishes no host port. If Docker Desktop cannot reach the loopback-bound host helper, the Settings page reports it unavailable. Do not expose the helper on a public interface; use the local development configuration until the Mac networking path has been validated.

**External AI**, under Settings → Advanced, is disabled by default in both app and helper. Enable it explicitly, then store provider credentials in Keychain through that page. Credentials are not stored in SQLite or workspace backups. Each external task has an immutable context preview and requires a separate checkbox approving that dispatch. Disabling cancels queued/running external tasks and aborts active helper requests; already transmitted text cannot be recalled. Inherited cloud workflows remain disabled by `STRATEGY_LOCAL_ONLY=1`; this switch must stay enabled.

## Persistence, backup, and recovery

The existing SQLite database now also stores package mappings, provenance, metrics, model tasks, drafts, and confirmations. A timestamped SQLite snapshot is written before upgrading an existing database to migration `048_local_workspace`; original files are not rewritten. Use [the full backup workflow](../deploy/local/README.md#backup) before upgrading and for routine backups: it captures SQLite and `data/docs`, including immutable originals and request packages. Restore into a new directory/volume and verify before switching. Mac Keychain credentials and bridge tokens are intentionally separate; reinstall/reconfigure them after migration to a new Mac.

The application owns a durable import/model task queue: one active lease, heartbeat, cancellation, idempotent request IDs, and at most three attempts after interrupted leases. It resumes after app restart. Terminal failures remain visible; fix inputs and submit a fresh request. The separate maintenance worker still owns its pre-existing maintenance queue. This is one personal installation; never put a live SQLite database on a shared/synced drive. User attribution is retained for later export/multi-user work, but partner synchronization is not implemented.

Validation on Linux covers import and queue behavior, mocked model boundary/approval tests, TypeScript, production build, and browser flow. Actual Apple inference, Keychain authorization, and Docker Desktop-to-Mac connectivity require a Mac acceptance run; they are not claimed validated by the Linux tests.
