import { z } from "zod";
import { db } from "../db";
import { newId } from "../ids";
import { artifact } from "./store";
import { assertActiveEvidenceTarget, type Segment } from "./evidence";

const optionalText = (max: number) => z.string().trim().max(max).optional().default("");
// Unknown request properties (such as the action name) are stripped. The
// same bounded fields are validated even when a client bypasses the picker.
const DiscoveryInput = z.object({
  accountId: z.string().trim().min(1, "Choose an account").max(100),
  meetingId: z.string().trim().min(1, "Choose a meeting").max(100),
  question: z.string().trim().min(1, "A question is required").max(4000),
  state: z.enum(["question", "hypothesis", "confirmed"]),
  answer: optionalText(4000),
  speaker: optionalText(200),
  confirmedAt: optionalText(60),
  artifactId: optionalText(100),
  locator: optionalText(120),
  quote: optionalText(1000),
});

/** Saves an explicit human classification; citations do not verify the claim. */
export function saveDiscoveryRecord(input: unknown, userId: string): string {
  const parsed = DiscoveryInput.safeParse(input);
  if (!parsed.success)
    throw new Error(parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  const record = parsed.data;
  return db().transaction(() => {
    assertActiveEvidenceTarget(record.accountId, record.meetingId);
    if (record.state === "confirmed") {
      if (!record.answer || !record.speaker || !record.confirmedAt || !record.quote)
        throw new Error("A confirmation needs an answer, speaker, time, and source quotation");
      if (!z.iso.datetime({ offset: true }).safeParse(record.confirmedAt).success || !Number.isFinite(Date.parse(record.confirmedAt)))
        throw new Error("Confirmation time must be a valid ISO date/time with a timezone offset or Z.");
      if (!db().prepare("SELECT 1 FROM local_artifact_links WHERE artifact_id=? AND account_id=?").get(record.artifactId, record.accountId))
        throw new Error("Source does not belong to this account");
      const source = artifact(record.artifactId);
      if (!source || !(JSON.parse(source.segments_json) as Segment[]).some(segment => segment.locator === record.locator && segment.text.includes(record.quote)))
        throw new Error("Quotation does not match the selected source location");
    }
    const id = newId();
    db().prepare("INSERT INTO local_confirmations VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
      id, record.accountId, record.meetingId, record.question, record.answer || null,
      record.state === "confirmed" ? record.speaker : null,
      record.state === "confirmed" ? record.confirmedAt : null,
      record.state === "confirmed" ? JSON.stringify({ artifactId: record.artifactId, locator: record.locator, quote: record.quote }) : null,
      record.state, userId, Date.now(),
    );
    return id;
  })();
}
