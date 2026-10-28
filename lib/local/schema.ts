export const LOCAL_SCHEMA = `
CREATE TABLE local_artifacts (
 id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE, filename TEXT NOT NULL,
 mime TEXT NOT NULL, storage_path TEXT NOT NULL, byte_size INTEGER NOT NULL,
 segments_json TEXT NOT NULL, warnings_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE local_artifact_links (
 artifact_id TEXT NOT NULL REFERENCES local_artifacts(id), account_id TEXT NOT NULL REFERENCES accounts(id),
 meeting_id TEXT NOT NULL DEFAULT '', document_id TEXT NOT NULL REFERENCES documents(id),
 audience TEXT NOT NULL DEFAULT 'unspecified', author_labels_json TEXT NOT NULL DEFAULT '[]',
 PRIMARY KEY(artifact_id, account_id, meeting_id)
);
CREATE TABLE local_packages (
 id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE, filename TEXT NOT NULL, storage_path TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'queued', manifest_json TEXT, artifacts_json TEXT NOT NULL DEFAULT '{}',
 warnings_json TEXT NOT NULL DEFAULT '[]', error TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE local_account_mappings (
 package_id TEXT NOT NULL REFERENCES local_packages(id), source_key TEXT NOT NULL,
 account_id TEXT NOT NULL REFERENCES accounts(id), alias_approved INTEGER NOT NULL DEFAULT 0,
 approved_by TEXT NOT NULL, approved_at INTEGER NOT NULL,
 PRIMARY KEY(package_id, source_key)
);
CREATE TABLE local_aliases (
 source_namespace TEXT NOT NULL, source_name TEXT NOT NULL, source_crm_id TEXT NOT NULL DEFAULT '',
 account_id TEXT NOT NULL REFERENCES accounts(id), approved_by TEXT NOT NULL, approved_at INTEGER NOT NULL,
 PRIMARY KEY(source_namespace, source_name, source_crm_id)
);
CREATE TABLE local_territories (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE local_territory_members (
 territory_id TEXT NOT NULL REFERENCES local_territories(id), account_id TEXT NOT NULL REFERENCES accounts(id),
 as_of TEXT NOT NULL, PRIMARY KEY(territory_id, account_id, as_of)
);
CREATE TABLE local_metrics (
 id TEXT PRIMARY KEY, package_id TEXT NOT NULL REFERENCES local_packages(id), item_key TEXT NOT NULL,
 account_id TEXT REFERENCES accounts(id), territory_id TEXT REFERENCES local_territories(id),
 measure TEXT NOT NULL, value REAL NOT NULL, unit TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL,
 definition TEXT NOT NULL, source_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 decided_by TEXT, decided_at INTEGER, UNIQUE(package_id, item_key)
);
CREATE TABLE local_jobs (
 id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, payload_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued', progress TEXT NOT NULL DEFAULT 'Waiting', owner TEXT, lease_until INTEGER,
 attempts INTEGER NOT NULL DEFAULT 0, cancel_requested INTEGER NOT NULL DEFAULT 0, result_json TEXT, error TEXT,
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX local_jobs_status ON local_jobs(status, created_at);
CREATE TABLE local_drafts (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL UNIQUE REFERENCES local_jobs(id), account_id TEXT NOT NULL REFERENCES accounts(id),
 meeting_id TEXT REFERENCES meetings(id), task TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
 content TEXT NOT NULL, sources_json TEXT NOT NULL, omissions_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL, accepted_by TEXT, accepted_at INTEGER, reviewed_content TEXT
);
CREATE TABLE local_confirmations (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), meeting_id TEXT NOT NULL REFERENCES meetings(id),
 question TEXT NOT NULL, answer TEXT, speaker TEXT, confirmed_at TEXT, source_json TEXT,
 state TEXT NOT NULL DEFAULT 'question', created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE local_requests (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), prompt TEXT NOT NULL,
 artifact_ids_json TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE local_folder_receipts (
 sha256 TEXT PRIMARY KEY, filename TEXT NOT NULL, package_id TEXT NOT NULL REFERENCES local_packages(id), moved_at INTEGER
);
`;
