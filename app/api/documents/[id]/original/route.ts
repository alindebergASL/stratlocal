import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db, type DocumentRow } from "@/lib/db";
import { handle } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireUser(req);
    const { id } = await ctx.params;
    const doc = db().prepare(`SELECT * FROM documents WHERE id = ?`).get(id) as DocumentRow | undefined;
    if (!doc?.storage_path || !fs.existsSync(doc.storage_path)) return NextResponse.json({ error: "not found" }, { status: 404 });
    const bytes = fs.readFileSync(doc.storage_path);
    return new NextResponse(bytes, {
      headers: {
        // Served as a download, never rendered: an uploaded page must not run in our origin.
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${doc.filename.replace(/[^\w.-]+/g, "_")}"`,
        "x-content-type-options": "nosniff",
      },
    });
  });
}
