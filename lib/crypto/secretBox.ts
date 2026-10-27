// Sealing a secret at rest: AES-256-GCM under INTEGRATIONS_KEY (32 bytes,
// base64), a fresh IV each time, the tag checked on open. Used for webhook
// URLs, which are bearer secrets: anyone holding one can post as us.
// No key, no sealing: callers say so rather than store a secret in the clear.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

export class SecretKeyMissing extends Error {
  constructor() {
    super("INTEGRATIONS_KEY is not set (32 random bytes, base64), so connections cannot be saved.");
  }
}

function key(): Buffer {
  const raw = (process.env.INTEGRATIONS_KEY ?? "").trim();
  if (!raw) throw new SecretKeyMissing();
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("INTEGRATIONS_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32).");
  return k;
}

export function sealingReady(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function seal(text: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function open(sealed: string): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || body === undefined) throw new Error("not a sealed secret");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
}
