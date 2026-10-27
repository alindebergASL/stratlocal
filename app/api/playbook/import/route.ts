import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { BudgetError } from "@/lib/ai/guard";
import { startPlaybookImport } from "@/lib/playbook/import";
import { documentText, PlaybookFileError } from "@/lib/playbook/text";
export const runtime = "nodejs";

// A playbook document, uploaded or pasted, read into a draft for review.
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requireUser(req);
    const form = await req.formData();
    const file = form.get("file");
    const pasted = form.get("text");
    try {
      let text = typeof pasted === "string" ? pasted : "";
      let filename: string | null = null;
      if (file instanceof File && file.size > 0) {
        filename = file.name;
        text = await documentText(file.name, Buffer.from(await file.arrayBuffer()));
      }
      if (!text.trim()) return NextResponse.json({ error: "Upload the playbook document or paste its text." }, { status: 400 });
      return NextResponse.json({ runId: startPlaybookImport({ text, filename, userId: user.id }) });
    } catch (e) {
      if (e instanceof BudgetError || e instanceof PlaybookFileError) return NextResponse.json({ error: e.message }, { status: 409 });
      throw e;
    }
  });
}
