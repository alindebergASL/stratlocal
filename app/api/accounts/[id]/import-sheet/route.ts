import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { getAccount } from "@/lib/queries/accounts";
import { CsvError, MAX_SHEET_BYTES, previewSheet, SheetError, storeSheetDocument } from "@/lib/sheet/run";

export const runtime = "nodejs";

// Step one of two: take the file, keep it, and say what the columns look like.
// Nothing is proposed here — the mapping has to be confirmed first, because a
// wrong guess would write a date into a money column across a whole pipeline.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = requireUser(req);
    const { id } = await ctx.params;
    if (!getAccount(id)) return NextResponse.json({ error: "account not found" }, { status: 404 });

    // The same content-length rule the report upload uses, and for the same
    // reason: formData() buffers the whole body before anything can look at it.
    const raw = req.headers.get("content-length")?.trim();
    const length = raw ? Number(raw) : NaN;
    if (!Number.isFinite(length)) return NextResponse.json({ error: "The upload needs a Content-Length" }, { status: 411 });
    if (length > MAX_SHEET_BYTES + 64 * 1024) return NextResponse.json({ error: "The file is larger than 2 MB" }, { status: 413 });

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a CSV file" }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());

    try {
      const doc = storeSheetDocument({ accountId: id, filename: file.name || "export.csv", bytes, userId: user.id });
      return NextResponse.json(previewSheet(doc));
    } catch (e) {
      if (e instanceof SheetError || e instanceof CsvError) return NextResponse.json({ error: e.message }, { status: 400 });
      throw e;
    }
  });
}
