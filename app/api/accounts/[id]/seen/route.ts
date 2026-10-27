import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { markAccountSeen } from "@/lib/accounts/lastLooked";

export const runtime = "nodejs";

// The Overview records that you looked, after it renders (lib/accounts/lastLooked.ts).
// A preference, not a record, with its own address so a check that viewing
// changed nothing can tell it apart.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = requireUser(req);
    const { id } = await ctx.params;
    markAccountSeen(user.id, id);
    return new NextResponse(null, { status: 204 });
  });
}
