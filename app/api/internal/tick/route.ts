import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { handle } from "@/lib/http";
import { schedulerSecret, tick } from "@/lib/assistants/scheduler";

export const runtime = "nodejs";

// The scheduler's door. Called every few minutes by the loop in
// deploy/compose.yml from inside the box, with a shared secret; the proxy
// refuses /api/internal/ from outside. With no secret configured the door
// does not exist, so a box set up before this can never be ticked by
// someone guessing an empty one.
function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const secret = schedulerSecret();
    if (!secret) return NextResponse.json({ error: "not found" }, { status: 404 });
    const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!same(given, secret)) return NextResponse.json({ error: "not allowed" }, { status: 403 });
    return NextResponse.json(tick());
  });
}
