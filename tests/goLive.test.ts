// SYNTHETIC ONLY: invented mailboxes and snapshots; S3 is a stub.
// Going live (Phase 9): what /setup says about mail and backups, and that
// email bodies go after 30 days whether or not the Mail reader is on.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const s3 = vi.hoisted(() => ({ objects: [] as Array<{ Key: string; LastModified: Date; Size: number }>, sse: "AES256" as string | undefined }));
vi.mock("@aws-sdk/client-s3", () => {
  class S3Client {
    async send(cmd: { kind: string }) {
      return cmd.kind === "list" ? { Contents: s3.objects } : { ServerSideEncryption: s3.sse };
    }
  }
  class ListObjectsV2Command {
    kind = "list";
  }
  class HeadObjectCommand {
    kind = "head";
  }
  return { S3Client, ListObjectsV2Command, HeadObjectCommand };
});

import { db } from "@/lib/db";
import { backupCheck, mailChecks } from "@/lib/setup";
import { tick } from "@/lib/assistants/scheduler";
import { seedAccount, USER } from "./helpers";

const DAY = 86_400_000;
beforeEach(() => vi.stubEnv("BACKUP_S3_URI", "s3://synthetic-bucket/snapshots"));
afterEach(() => vi.unstubAllEnvs());

describe("the offsite backup check", () => {
  const snap = (daysAgo: number) => ({ Key: `snapshots/s-${daysAgo}.tar.gz`, LastModified: new Date(Date.now() - daysAgo * DAY - 3_600_000), Size: 4096 });

  it("is fine when fresh, encrypted and kept about 30 days", async () => {
    s3.objects = [snap(0), snap(10), snap(29)];
    s3.sse = "AES256";
    const r = await backupCheck();
    expect(r.state).toBe("ok");
    expect(r.value).toMatch(/encrypted \(AES256\) · 3 kept, oldest 29d/);
  });

  it("is bad when the newest snapshot is not encrypted", async () => {
    s3.objects = [snap(0)];
    s3.sse = undefined;
    const r = await backupCheck();
    expect(r.state).toBe("bad");
    expect(r.detail).toMatch(/not encrypted/);
  });

  it("warns when snapshots outlive the 30 days email is kept", async () => {
    s3.objects = [snap(0), snap(60)];
    s3.sse = "aws:kms";
    const r = await backupCheck();
    expect(r.state).toBe("warn");
    expect(r.detail).toMatch(/lifecycle rule/);
  });
});

describe("mail on /setup and its 30 days", () => {
  const mail = (id: string, accountId: string, daysAgo: number) =>
    db()
      .prepare(`INSERT INTO mail_messages (id, user_id, provider_id, account_id, thread_key, from_addr, to_json, subject, received_at, body_text, body_hash, created_at) VALUES (?, ?, ?, ?, 't', 'a@example.test', '[]', 'S', ?, 'Body', 'h', 0)`)
      .run(id, USER, id, accountId, Date.now() - daysAgo * DAY);

  it("says which mailboxes fail and whether old bodies linger", () => {
    const { accountId } = seedAccount();
    db().prepare(`INSERT INTO mail_sources (user_id, kind, mailbox, enabled, last_read_at, last_error, skipped, created_at) VALUES (?, 'fake', 'me@example.test', 1, NULL, 'Mail.Read is missing', 0, 0)`).run(USER);
    mail("old", accountId, 40);
    const checks = new Map(mailChecks().map((c) => [c.label, c]));
    expect(checks.get("Mailboxes read")).toMatchObject({ state: "bad", value: "1 connected, 1 failing" });
    expect(checks.get("Email kept 30 days")).toMatchObject({ state: "bad", value: "1 older bodies still kept" });
    expect(checks.get("Microsoft 365")!.state).toBe("warn");
  });

  it("every tick clears bodies past 30 days, with the Mail reader off", () => {
    const { accountId } = seedAccount();
    mail("old", accountId, 40);
    mail("new", accountId, 2);
    tick();
    const rows = db().prepare(`SELECT id, body_text FROM mail_messages ORDER BY id`).all();
    expect(rows).toEqual([
      { id: "new", body_text: "Body" },
      { id: "old", body_text: null },
    ]);
    expect(new Map(mailChecks().map((c) => [c.label, c])).get("Email kept 30 days")!.state).toBe("ok");
  });
});
