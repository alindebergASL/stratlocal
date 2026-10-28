import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db, DOCS_DIR } from "@/lib/db";
import { handle } from "@/lib/http";
import { artifact } from "@/lib/local/store";
export const runtime = "nodejs";
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = requireUser(req),
      { id } = await ctx.params;
    const a = artifact(id);
    const request = db()
      .prepare("SELECT id FROM local_requests WHERE id=? AND created_by=?")
      .get(id, user.id) as { id: string } | undefined;
    if (!a && !request)
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    const file =
        a?.storage_path ?? path.join(DOCS_DIR, `request-${request!.id}.zip`),
      name = a?.filename ?? `myagent-request-${id}.zip`;
    return new NextResponse(fs.readFileSync(file), {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
        "content-security-policy": "sandbox",
      },
    });
  });
}
