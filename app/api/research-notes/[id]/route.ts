import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle, parseJson } from "@/lib/http";
import { ApplyError } from "@/lib/proposals/apply";
import { archiveDocument, restoreDocument } from "@/lib/documents";
import { acceptNote, parseNote, resolveNote } from "@/lib/research/notes";

export const runtime = "nodejs";

// `keep` is a list of positions in the note's findings array, not URLs:
// two findings can cite the same page and a URL cannot tell them apart.
type Body = {
  action?: "accept" | "discard" | "restore" | "resolve";
  keep?: number[];
  obsoleteIndex: number;
  supportingIds: string[];
  reason: string;
};

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = requireUser(req);
    const { id } = await ctx.params;
    const body = await parseJson<Body>(req, 64 * 1024);
    try {
      if (body.action === "resolve") {
        const doc = resolveNote(id, body.obsoleteIndex, body.supportingIds, body.reason, user.id);
        return NextResponse.json({ status: "resolved", documentId: doc.id });
      }
      if (body.action === "discard") {
        archiveDocument(id, user.id);
        return NextResponse.json({ status: "discarded" });
      }
      if (body.action === "restore") {
        restoreDocument(id, user.id);
        return NextResponse.json({ status: "restored" });
      }
      if (body.action !== "accept") return NextResponse.json({ error: "unknown action" }, { status: 400 });
      const keep = Array.isArray(body.keep) ? body.keep : [];
      const doc = acceptNote(id, keep, user.id);
      return NextResponse.json({
        status: "accepted",
        kept: parseNote(doc)?.meta.accepted_finding_indexes?.length ?? 0,
        documentId: doc.id,
      });
    } catch (e) {
      if (e instanceof ApplyError) return NextResponse.json({ error: e.message }, { status: e.code === "not_found" ? 404 : 400 });
      throw e;
    }
  });
}
