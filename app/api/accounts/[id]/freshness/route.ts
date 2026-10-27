import { NextRequest, NextResponse } from "next/server";
import { HttpError, requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { getAccount } from "@/lib/queries/accounts";
import { accountRevision } from "@/lib/queries/freshness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Has anything on this account been written since the point I am holding?"
//
// The answer is one opaque cursor and nothing else: no fields, no notes, no
// values, no names. A page that polls every half minute must not be a way to
// read the record, and a notice that says "this account was updated" needs
// nothing more than this to be true.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireUser(req);
    const { id } = await ctx.params;
    if (!getAccount(id)) throw new HttpError(404, { error: "No such account" });
    return NextResponse.json({ revision: accountRevision(id) }, { headers: { "Cache-Control": "no-store" } });
  });
}
