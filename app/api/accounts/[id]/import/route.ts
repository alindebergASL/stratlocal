import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { isRealDay, todayISO } from "@/lib/clock";
import { getAccount } from "@/lib/queries/accounts";
import { BudgetError, MAX_UPLOAD_BYTES, startImportRun, storeCustomerDocument, storeReportDocument, UploadError } from "@/lib/import/run";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = requireUser(req);
    const { id } = await ctx.params;
    if (!getAccount(id)) return NextResponse.json({ error: "account not found" }, { status: 404 });

    // formData() buffers the whole body before anything can look at it, and
    // the header check below it is the only thing standing in front of that.
    // `Number(null ?? "0")` is 0, so a chunked request with no content-length
    // sailed past and the cap was enforced only after the bytes were already
    // in memory. Require the header, and believe it only as far as refusing.
    // Empty counts as missing: Number("") is 0, not NaN, so a header present
    // but blank would have declared a zero-byte body and sailed through.
    const raw = req.headers.get("content-length")?.trim();
    const length = raw ? Number(raw) : NaN;
    if (!Number.isFinite(length)) {
      return NextResponse.json({ error: "The upload needs a Content-Length" }, { status: 411 });
    }
    if (length > MAX_UPLOAD_BYTES + 64 * 1024) return NextResponse.json({ error: "The file is larger than 5 MB" }, { status: 413 });

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file" }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    // The report's own date, typed by the person uploading it. Validated here
    // rather than trusted: it becomes install_base.as_of, which orders the
    // snapshots, and a malformed one would sort into the wrong place forever.
    // Shape was all it checked, so `2026-13-45` went through and sorted into
    // that order forever. `isRealDay` is the rule the spreadsheet reader
    // already applies to a date cell.
    const asOfRaw = form.get("as_of");
    const asOf = typeof asOfRaw === "string" && asOfRaw.trim() !== "" ? asOfRaw.trim() : null;
    if (asOf !== null && !isRealDay(asOf)) {
      return NextResponse.json({ error: "The report date has to be a real calendar date, like 2026-06-30" }, { status: 400 });
    }
    // The future bound was `max={today}` on the input and nowhere else, so it
    // held for anyone using the form and for nobody else. A snapshot dated
    // ahead of today would sit at the top of the trend and never be overtaken.
    if (asOf !== null && asOf > todayISO()) {
      return NextResponse.json({ error: "The report date cannot be in the future" }, { status: 400 });
    }

    try {
      // A customer document is kept and read as context; nothing is
      // extracted from it, so no run starts and no proposals follow.
      if (form.get("purpose") === "customer_doc") {
        const doc = await storeCustomerDocument({ accountId: id, filename: file.name || "document.txt", bytes, userId: user.id });
        return NextResponse.json({ documentId: doc.id });
      }
      const doc = await storeReportDocument({ accountId: id, filename: file.name || "report.html", bytes, userId: user.id });
      const runId = startImportRun(doc, user.id, asOf);
      return NextResponse.json({ runId, documentId: doc.id });
    } catch (e) {
      if (e instanceof UploadError) return NextResponse.json({ error: e.message }, { status: 400 });
      if (e instanceof BudgetError) return NextResponse.json({ error: e.message }, { status: 429 });
      throw e;
    }
  });
}
