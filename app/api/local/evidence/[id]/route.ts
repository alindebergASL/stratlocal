import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { sourceSelection } from "@/lib/local/sourcePicker";

export const runtime = "nodejs";
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireUser(req);
    const { id } = await ctx.params;
    const query = req.nextUrl.searchParams;
    const result = sourceSelection(query.get("accountId") ?? "", id, Number(query.get("page") ?? "1"), query.get("locator") ?? "");
    return NextResponse.json(result, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  });
}
