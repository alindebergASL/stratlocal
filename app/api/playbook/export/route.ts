import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { currentPlaybook } from "@/lib/playbook/store";
export const runtime = "nodejs";

// The current playbook as a file: for keeping, for another team, or for
// loading back into the editor.
export async function GET(req: NextRequest) {
  return handle(async () => {
    requireUser(req);
    const current = currentPlaybook({ slug: req.nextUrl.searchParams.get("pb") });
    if (!current) return NextResponse.json({ error: "There is no playbook yet." }, { status: 404 });
    const name = current.playbook.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "playbook";
    return new NextResponse(JSON.stringify({ kind: "playbook", version: 1, exported_at: new Date().toISOString(), playbook: current.playbook }, null, 2), {
      headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${name}.json"`, "cache-control": "no-store" },
    });
  });
}
