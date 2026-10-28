import { HttpError } from "../auth";
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const url = new URL(req.url);
  // Next may normalize req.url to localhost while the browser uses 127.0.0.1.
  // Match the actual request Host, as Next server actions do.
  const expectedOrigin = `${url.protocol}//${req.headers.get("host") || url.host}`;
  if (
    req.headers.get("sec-fetch-site") === "cross-site" ||
    (origin && origin !== expectedOrigin)
  )
    throw new HttpError(403, {
      error: "Use this app's own page to make changes",
    });
}
export async function boundedBody(req: Request, limit: number) {
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, { error: "Missing request body" });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError(413, { error: "Upload exceeds size limit" });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
