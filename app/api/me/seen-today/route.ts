import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { briefingSince } from "@/lib/briefing";

export const runtime = "nodejs";

// Today records that you looked, after it has rendered, so the next briefing
// starts from here (lib/briefing.ts). A preference, not a record: it is the
// one write a look at Today makes, and it has its own address so a check
// for "viewing changed nothing" can tell it apart.
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requireUser(req);
    briefingSince(user.id, new Date(), true);
    return new NextResponse(null, { status: 204 });
  });
}
