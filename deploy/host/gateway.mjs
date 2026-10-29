import http from "node:http";
import fs from "node:fs";
import { timingSafeEqual } from "node:crypto";
const token = fs.readFileSync("/run/secrets/model_bridge_token", "utf8").trim();
if (token.length < 32) throw Error("Invalid bridge token");
http
  .createServer(async (req, res) => {
    const a = Buffer.from(req.headers.authorization || ""),
      b = Buffer.from(`Bearer ${token}`);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      res.writeHead(401);
      return res.end();
    }
    if (
      req.headers.origin ||
      !(
        (req.method === "GET" && req.url === "/v1/capabilities") ||
        (req.method === "POST" &&
          ["/v1/generate", "/v1/credentials", "/v1/policy"].includes(req.url))
      )
    ) {
      res.writeHead(404);
      return res.end();
    }
    const controller = new AbortController();
    res.on("close", () => controller.abort());
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 128 * 1024) {
          res.writeHead(413);
          return res.end();
        }
        chunks.push(chunk);
      }
      const result = await fetch(`http://host.docker.internal:4242${req.url}`, {
        method: req.method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
        redirect: "error",
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(180000),
        ]),
      });
      res.writeHead(result.status, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(await result.text());
    } catch {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error:
            "Mac model bridge unavailable. Start the helper; no fallback was used.",
        }),
      );
    }
  })
  .listen(4243, "0.0.0.0");
