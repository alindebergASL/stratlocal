import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { exportPack, starterPack } from "@/lib/team/pack";
export const runtime = "nodejs";

// This team's pack, or the neutral starter, as a file for another team.
export async function GET(req: NextRequest) {
  return handle(async () => {
    requireUser(req);
    const starter = req.nextUrl.searchParams.get("starter") === "1";
    const pack = starter ? starterPack() : exportPack();
    const name = (starter ? "starter" : (pack.name ?? "team")).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "team";
    return new NextResponse(JSON.stringify(pack, null, 2), {
      headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${name}-team-pack.json"`, "cache-control": "no-store" },
    });
  });
}
