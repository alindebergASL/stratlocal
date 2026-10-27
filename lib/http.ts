import { NextResponse } from "next/server";
import { HttpError } from "./auth";
import { describeError } from "./errors";

export const DEFAULT_JSON_BODY_BYTES = 256 * 1024;

// Reads a JSON body without trusting Content-Length. Throws HttpError.
export async function parseJson<T = unknown>(req: Request, maxBytes = DEFAULT_JSON_BODY_BYTES): Promise<T> {
  let text: string;
  try {
    text = await req.text();
  } catch {
    throw new HttpError(400, { error: "Unreadable request body" });
  }
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new HttpError(413, { error: "Request body too large" });
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, { error: "Invalid JSON body" });
  }
}

// Wraps a route handler so thrown HttpErrors become JSON responses and
// anything else becomes a logged 500. The message is passed through rather
// than replaced with "Internal error": these routes are behind a login shared
// by two people, and the error lands in a panel only they will read.
export function handle(fn: () => Promise<Response>): Promise<Response> {
  return fn().catch((error: unknown) => {
    if (error instanceof HttpError) {
      return NextResponse.json(error.body, { status: error.status });
    }
    console.error("[route]", error);
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  });
}

export function json(body: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(body, init);
}
