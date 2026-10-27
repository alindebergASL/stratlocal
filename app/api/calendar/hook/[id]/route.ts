import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSource, hookPoke } from "@/lib/calendar/sync";

export const runtime = "nodejs";

// Where Outlook and Google say "something changed" (DECISIONS #42). There is
// no session here — a provider is calling — so each call must carry the
// channel's own secret. Even a valid call only causes a read of the window;
// what is read comes from the provider, never from this request.

function same(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const source = getSource(id);
  if (!source || source.archived_at) return new NextResponse(null, { status: 404 });

  // Microsoft checks a new subscription's address by asking us to echo a token.
  const validation = req.nextUrl.searchParams.get("validationToken");
  if (validation !== null) {
    if (source.kind !== "graph") return new NextResponse(null, { status: 404 });
    return new NextResponse(validation.slice(0, 1024), { status: 200, headers: { "content-type": "text/plain" } });
  }

  if (source.kind === "google") {
    const channel = req.headers.get("x-goog-channel-id");
    const token = req.headers.get("x-goog-channel-token");
    if (!same(token, source.watch_secret) || !source.watch_id?.startsWith(`${channel}|`)) return new NextResponse(null, { status: 403 });
    // "sync" is the channel's hello; anything else means the calendar changed.
    if (req.headers.get("x-goog-resource-state") !== "sync") hookPoke(source);
    return new NextResponse(null, { status: 200 });
  }

  if (source.kind === "graph") {
    let body: { value?: Array<{ clientState?: string; subscriptionId?: string }> };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return new NextResponse(null, { status: 400 });
    }
    const items = body.value ?? [];
    if (items.length === 0 || !items.every((n) => same(n.clientState, source.watch_secret) && n.subscriptionId === source.watch_id)) return new NextResponse(null, { status: 403 });
    hookPoke(source);
    return new NextResponse(null, { status: 202 });
  }

  return new NextResponse(null, { status: 404 });
}
