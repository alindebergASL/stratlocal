import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { boundedBody, sameOrigin } from "@/lib/local/http";
import { stagePackage } from "@/lib/local/packages";
import { MAX_PACKAGE_BYTES } from "@/lib/local/zip";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requireUser(req);
    sameOrigin(req);
    const body = await boundedBody(req, MAX_PACKAGE_BYTES + 65536);
    const form = await new Response(body, {
      headers: { "content-type": req.headers.get("content-type") ?? "" },
    }).formData();
    const file = form.get("file");
    if (!(file instanceof File))
      return NextResponse.json({ error: "Choose a file" }, { status: 400 });
    try {
      const p = stagePackage(
        file.name,
        Buffer.from(await file.arrayBuffer()),
        user.id,
        String(form.get("accountId") ?? "") || undefined,
      );
      return NextResponse.json({
        href: `/imports/${p.id}`,
        message: "Import queued for review",
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Import failed" },
        { status: 400 },
      );
    }
  });
}
