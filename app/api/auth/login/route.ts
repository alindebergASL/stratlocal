import { NextRequest, NextResponse } from "next/server";
import { login, setSessionCookie } from "@/lib/auth";
import { handle, parseJson } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = await parseJson<{ email?: string; password?: string }>(req, 4096);
    const email = (body.email ?? "").trim();
    const password = body.password ?? "";
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }
    // Who is asking, for the throttle.
    //
    // Behind Caddy the socket address is the proxy, so the forwarded header is
    // the only thing that says who connected. What makes it trustworthy is
    // that the Caddyfile *overwrites* it (`header_up X-Forwarded-For
    // {remote_host}`) rather than appending, which is Caddy's default: with
    // the default, the first entry is whatever the client sent, and rotating
    // it made the enumeration throttle a no-op. The pairing matters — this
    // line is only correct because of that one.
    //
    // It remains a rate-limit bucket and never an authorisation input. Running
    // without that proxy in front (locally, or behind something configured
    // differently) means the throttle is per-claimed-source, which is weaker
    // and still better than the per-user lockout alone.
    const source = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
    const result = login(email, password, source);
    if (!result.ok) {
      const headers: Record<string, string> = {};
      if (result.retryAfterSeconds) headers["Retry-After"] = String(result.retryAfterSeconds);
      return NextResponse.json({ error: result.error }, { status: result.status, headers });
    }
    const res = NextResponse.json({ user: result.user });
    setSessionCookie(res, result.sessionId);
    return res;
  });
}
