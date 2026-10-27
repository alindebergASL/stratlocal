import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle, parseJson } from "@/lib/http";
import { getAccount, getDocument } from "@/lib/queries/accounts";
import { fieldsFor, type SheetField, type SheetKind, type SheetMapping } from "@/lib/sheet/columns";
import { applySheet, CsvError, SheetError } from "@/lib/sheet/run";

export const runtime = "nodejs";

// Step two: the mapping a person confirmed, applied to the file they were
// shown. The document id identifies that file, so this cannot be pointed at a
// different one — and it is checked against the account in the URL, because a
// document id from another account would otherwise propose changes here from
// a spreadsheet nobody on this page has seen.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireUser(req);
    const { id } = await ctx.params;
    if (!getAccount(id)) return NextResponse.json({ error: "account not found" }, { status: 404 });

    const body = await parseJson<{ documentId?: unknown; mapping?: unknown; kind?: unknown; asOf?: unknown }>(req);
    const documentId = typeof body.documentId === "string" ? body.documentId : "";
    const doc = documentId ? getDocument(documentId) : null;
    if (!doc || doc.account_id !== id) return NextResponse.json({ error: "That upload is not on this account" }, { status: 404 });

    // The kind decides which fields exist, so it is read first and refused
    // rather than defaulted: a typo here would silently read a people file
    // under the deal field table and propose a pipeline of colleagues.
    if (body.kind !== "deal" && body.kind !== "contact" && body.kind !== "install_base") {
      return NextResponse.json({ error: "Say whether this file is deals, people or an install base." }, { status: 400 });
    }
    const kind: SheetKind = body.kind;

    // Read field by field rather than trusting the object's shape: an extra
    // key would be ignored anyway, but a non-integer index has to become a
    // clear refusal rather than an undefined column read as empty cells.
    const raw = (body.mapping ?? {}) as Record<string, unknown>;
    const mapping: SheetMapping = {};
    for (const spec of fieldsFor(kind)) {
      const v = raw[spec.field];
      if (v === null || v === undefined || v === "") {
        mapping[spec.field] = null;
        continue;
      }
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isInteger(n)) return NextResponse.json({ error: `The column chosen for ${spec.label} is not a column.` }, { status: 400 });
      mapping[spec.field as SheetField] = n;
    }

    try {
      // The snapshot date, for the one kind that has one. applySheet validates
      // it rather than trusting this, because it orders the snapshots forever.
      return NextResponse.json(applySheet(doc, mapping, kind, typeof body.asOf === "string" ? body.asOf : null));
    } catch (e) {
      if (e instanceof SheetError || e instanceof CsvError) return NextResponse.json({ error: e.message }, { status: 400 });
      throw e;
    }
  });
}
