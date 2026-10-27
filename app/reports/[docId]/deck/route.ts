import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { getReport } from "@/lib/ask/report";
import { resolveSources } from "@/lib/ask/sources";
import { reportDeck } from "@/lib/ask/deck";
import { deckStyle } from "@/lib/team/branding";
export const runtime = "nodejs";

// A report as a PowerPoint deck, for the signed-in team only: a shared link
// is a page to read, not a file to take away.
export async function GET(req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  return handle(async () => {
    requireUser(req);
    const { docId } = await params;
    const stored = getReport(docId);
    if (!stored) return NextResponse.json({ error: "No such report." }, { status: 404 });
    const { report } = stored;
    const buf = await reportDeck({ ...report, sources: resolveSources(report.citations) }, deckStyle());
    const name = report.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "report";
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "content-disposition": `attachment; filename="${name}.pptx"`,
        "cache-control": "no-store",
      },
    });
  });
}
