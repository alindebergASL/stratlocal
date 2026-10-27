import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, deleteSession, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const id = req.cookies.get(SESSION_COOKIE)?.value;
  if (id) deleteSession(id);
  // A relative Location keeps whatever host the browser used, which behind a
  // reverse proxy is the public hostname rather than the container's.
  const res = new NextResponse(null, { status: 303, headers: { Location: "/login" } });
  clearSessionCookie(res);
  return res;
}
