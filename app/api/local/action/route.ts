import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { db, DOCS_DIR } from "@/lib/db";
import { newId } from "@/lib/ids";
import { applyEntityChange } from "@/lib/proposals/apply";
import { sameOrigin, boundedBody } from "@/lib/local/http";
import { localSettings, saveLocalSettings, artifact } from "@/lib/local/store";
import {
  resolveAccount,
  proposePackage,
  proposeAccountContext,
  retryPackage,
  prepareRequest,
} from "@/lib/local/packages";
import {
  bridge,
  buildModelContext,
  stageDraftPreview,
  confirmDraft,
  Provider,
  DraftTask,
} from "@/lib/local/models";
import { cancel } from "@/lib/local/queue";
import { exchangeRoot } from "@/lib/local/worker";
import { linkArtifact, type Segment } from "@/lib/local/evidence";

export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requireUser(req);
    sameOrigin(req);
    try {
      const b = JSON.parse(
        (await boundedBody(req, 128 * 1024)).toString(),
      ) as Record<string, unknown>;
      const text = (key: string, max = 4000) =>
        z
          .string()
          .max(max)
          .parse(b[key] ?? "")
          .trim();
      const flag = (key: string) =>
        b[key] === true || b[key] === "on" || b[key] === "true";
      const ids = (key: string) =>
        z
          .array(z.string().max(100))
          .max(100)
          .parse(Array.isArray(b[key]) ? b[key] : b[key] ? [b[key]] : []);
      let result: Record<string, unknown> = { message: "Saved" };
      switch (text("operation", 60)) {
        case "resolve_account":
          resolveAccount(
            text("packageId", 100),
            text("key", 100),
            text("accountId", 100),
            flag("alias"),
            user.id,
          );
          break;
        case "retry_import":
          result = retryPackage(text("packageId", 100), user.id);
          break;
        case "propose_account_context":
          result = { ...proposeAccountContext(text("packageId", 100), user.id), message: "Overview and customer-contact proposals are ready for review.", href: "/inbox?kind=changes" };
          break;
        case "propose_package":
          result = {
            ...proposePackage(text("packageId", 100), user.id),
            message:
              "Proposals are ready for review. Account records have not been changed.",
            href: "/inbox?kind=changes",
          };
          break;
        case "metric_decision": {
          const status = z.enum(["accepted", "rejected"]).parse(b.status);
          db()
            .prepare(
              "UPDATE local_metrics SET status=?,decided_by=?,decided_at=? WHERE id=? AND status='pending'",
            )
            .run(status, user.id, Date.now(), text("id", 100));
          break;
        }
        case "settings":
          saveLocalSettings(
            {
              ...localSettings(),
              provider: z.enum(["apple", "ollama"]).parse(b.provider),
              model: text("model", 160),
              watchEnabled: flag("watchEnabled"),
            },
            user.id,
          );
          break;
        case "external_policy": {
          const enabled = flag("enabled");
          // Disabling is effective locally even when the helper is offline.
          if (!enabled)
            saveLocalSettings(
              { ...localSettings(), externalEnabled: false },
              user.id,
            );
          await bridge("policy", { enabled });
          if (enabled)
            saveLocalSettings(
              { ...localSettings(), externalEnabled: true },
              user.id,
            );
          break;
        }
        case "credentials": {
          if (!localSettings().externalEnabled)
            throw new Error(
              "Enable external AI before configuring credentials",
            );
          await bridge("credentials", {
            provider: z.enum(["anthropic", "bedrock"]).parse(b.provider),
            apiKey: text("apiKey", 1000),
            accessKeyId: text("accessKeyId", 200),
            secretAccessKey: text("secretAccessKey", 1000),
            sessionToken: text("sessionToken", 10000),
            region: text("region", 80),
          });
          result = {
            message:
              "Credentials stored in macOS Keychain; no secret was saved in the workspace.",
          };
          break;
        }
        case "prepare_intake_request":
        case "prepare_request": {
          const prepared = await prepareRequest(
            text("accountId", 100),
            text("question", 8000),
            ids("artifactIds"),
            user.id,
            b.operation === "prepare_intake_request"
              ? { website: text("website", 500) }
              : undefined,
          );
          fs.mkdirSync(DOCS_DIR, { recursive: true });
          fs.writeFileSync(
            path.join(DOCS_DIR, `request-${prepared.id}.zip`),
            prepared.bytes,
            { mode: 0o600 },
          );
          if (flag("writeFolder")) {
            const root = exchangeRoot();
            if (!root) throw new Error("Configure the exchange folder first");
            if (fs.lstatSync(root).isSymbolicLink())
              throw new Error("Exchange directory cannot be a symlink");
            const dir = path.join(root, "Requests");
            fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
            if (fs.lstatSync(dir).isSymbolicLink())
              throw new Error("Exchange directory cannot be a symlink");
            fs.writeFileSync(
              path.join(dir, `${prepared.id}.zip`),
              prepared.bytes,
              { mode: 0o600, flag: "wx" },
            );
          }
          result = {
            message: "Request prepared. Nothing was sent to MyAgent.",
            href: `/requests/${prepared.id}`,
          };
          break;
        }
        case "preview_draft": {
          const provider = Provider.parse(b.provider),
            external = ["anthropic", "bedrock"].includes(provider);
          if (external && !localSettings().externalEnabled)
            throw new Error("External AI is disabled");
          const context = buildModelContext(
            text("accountId", 100),
            DraftTask.parse(b.task),
            ids("artifactIds"),
            text("meetingId", 100) || null,
            text("instructions"),
          );
          const id = stageDraftPreview(
            {
              provider,
              model: text("model", 160),
              context,
              externalApproved: false,
            },
            user.id,
          );
          result = {
            href: `/drafts/preview/${id}`,
            message: "Review the exact context before running",
          };
          break;
        }
        case "run_draft": {
          const j = confirmDraft(
            text("previewId", 100),
            user.id,
            flag("externalApproved"),
          );
          result = { href: `/imports?job=${j.id}`, message: "Draft queued" };
          break;
        }
        case "cancel_job":
          cancel(text("id", 100), user.id);
          break;
        case "accept_draft": {
          const id = text("id", 100),
            content = text("content", 60000);
          if (!content) throw new Error("Enter reviewed draft text");
          db().transaction(() => {
            const d = db()
              .prepare(
                "SELECT * FROM local_drafts WHERE id=? AND created_by=? AND status='draft'",
              )
              .get(id, user.id) as
              | { account_id: string; task: string }
              | undefined;
            if (!d) throw new Error("Draft not found or already reviewed");
            if (d.task === "account_plan") {
              if (content.length > 4000)
                throw new Error(
                  "Account-plan updates must fit within 4,000 characters; shorten the reviewed text",
                );
              applyEntityChange({
                accountId: d.account_id,
                entityType: "account",
                entityId: d.account_id,
                op: "update",
                payload: { thesis: content },
                actorUserId: user.id,
                sourceRef: { kind: "user", id: user.id },
              });
            }
            db()
              .prepare(
                "UPDATE local_drafts SET status='accepted',reviewed_content=?,accepted_by=?,accepted_at=? WHERE id=?",
              )
              .run(content, user.id, Date.now(), id);
          })();
          break;
        }
        case "link_evidence":
          linkArtifact(
            text("artifactId", 100),
            text("accountId", 100),
            user.id,
            text("meetingId", 100),
          );
          break;
        case "confirmation": {
          const accountId = text("accountId", 100),
            meetingId = text("meetingId", 100),
            question = text("question"),
            state = z
              .enum(["question", "hypothesis", "confirmed"])
              .parse(b.state);
          if (
            !question ||
            !db()
              .prepare("SELECT 1 FROM meetings WHERE id=? AND account_id=?")
              .get(meetingId, accountId)
          )
            throw new Error("A question and an account meeting are required");
          const answer = text("answer"),
            speaker = text("speaker", 200),
            confirmedAt = text("confirmedAt", 60),
            artifactId = text("artifactId", 100),
            locator = text("locator", 120),
            quote = text("quote", 1000);
          if (state === "confirmed") {
            if (
              !answer ||
              !speaker ||
              !confirmedAt ||
              !Number.isFinite(Date.parse(confirmedAt)) ||
              !quote
            )
              throw new Error(
                "A confirmation needs an answer, speaker, time, and source quotation",
              );
            if (
              !db()
                .prepare(
                  "SELECT 1 FROM local_artifact_links WHERE artifact_id=? AND account_id=?",
                )
                .get(artifactId, accountId)
            )
              throw new Error("Source does not belong to this account");
            const a = artifact(artifactId)!;
            if (
              !(JSON.parse(a.segments_json) as Segment[]).some(
                (s) => s.locator === locator && s.text.includes(quote),
              )
            )
              throw new Error(
                "Quotation does not match the selected source location",
              );
          }
          db()
            .prepare(
              "INSERT INTO local_confirmations VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            )
            .run(
              newId(),
              accountId,
              meetingId,
              question,
              answer || null,
              state === "confirmed" ? speaker : null,
              state === "confirmed" ? confirmedAt : null,
              state === "confirmed"
                ? JSON.stringify({ artifactId, locator, quote })
                : null,
              state,
              user.id,
              Date.now(),
            );
          break;
        }
        default:
          throw new Error("Unknown workspace action");
      }
      return NextResponse.json(result);
    } catch (e) {
      return NextResponse.json(
        {
          error:
            e instanceof Error ? e.message : "Could not complete the action",
        },
        { status: 400 },
      );
    }
  });
}
