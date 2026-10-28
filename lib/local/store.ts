import { z } from "zod";
import { db } from "../db";

export const LocalSettings = z.object({
  provider: z.enum(["ollama", "apple"]).default("ollama"),
  model: z.string().max(160).default(""),
  watchEnabled: z.boolean().default(false),
  externalEnabled: z.boolean().default(false),
});
export type LocalSettings = z.infer<typeof LocalSettings>;
export function localSettings(): LocalSettings {
  const row = db()
    .prepare("SELECT value FROM settings WHERE key='local_workspace'")
    .get() as { value: string } | undefined;
  return LocalSettings.parse(row ? JSON.parse(row.value) : {});
}
export function saveLocalSettings(input: unknown, userId: string) {
  const settings = LocalSettings.parse(input);
  db()
    .prepare(
      "INSERT INTO settings(key,value,updated_by,updated_at) VALUES('local_workspace',?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at",
    )
    .run(JSON.stringify(settings), userId, Date.now());
  if (!settings.externalEnabled)
    db()
      .prepare(
        "UPDATE local_jobs SET cancel_requested=1 WHERE kind='draft' AND status IN ('queued','running') AND json_extract(payload_json,'$.provider') IN ('bedrock','anthropic')",
      )
      .run();
  return settings;
}
export type Artifact = {
  id: string;
  sha256: string;
  filename: string;
  mime: string;
  storage_path: string;
  byte_size: number;
  segments_json: string;
  warnings_json: string;
  created_at: number;
};
export type PackageRow = {
  id: string;
  sha256: string;
  filename: string;
  storage_path: string;
  state: string;
  manifest_json: string | null;
  artifacts_json: string;
  warnings_json: string;
  error: string | null;
  created_by: string;
  created_at: number;
};
export type Job = {
  id: string;
  request_key: string;
  kind: string;
  payload_json: string;
  status: string;
  progress: string;
  owner: string | null;
  lease_until: number | null;
  attempts: number;
  cancel_requested: number;
  result_json: string | null;
  error: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
};
export function artifact(id: string) {
  return db().prepare("SELECT * FROM local_artifacts WHERE id=?").get(id) as
    | Artifact
    | undefined;
}
export function packageRow(id: string) {
  return db().prepare("SELECT * FROM local_packages WHERE id=?").get(id) as
    | PackageRow
    | undefined;
}
export function job(id: string) {
  return db().prepare("SELECT * FROM local_jobs WHERE id=?").get(id) as
    | Job
    | undefined;
}
