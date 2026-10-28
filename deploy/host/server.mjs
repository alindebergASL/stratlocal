// Narrow, authenticated Mac host bridge. Never accepts a caller-provided URL.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
const home =
  process.env.STRATEGY_MODEL_HOME ||
  path.join(os.homedir(), ".strategylocal-models");
const token = fs.readFileSync(path.join(home, "token"), "utf8").trim();
if (token.length < 32) throw Error("Invalid bridge token");
const helper = path.join(home, "model-helper");
const policyFile = path.join(home, "policy.json");
let enabled = false;
try {
  enabled =
    JSON.parse(fs.readFileSync(policyFile, "utf8")).externalEnabled === true;
} catch {}
const externalControllers = new Set();
function native(input, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(helper, [], {
      stdio: ["pipe", "pipe", "ignore"],
      signal,
    });
    let out = "";
    child.stdout.on("data", (b) => {
      out += b;
      if (out.length > 256000) child.kill();
    });
    child.on("error", () => reject(Error("Mac helper unavailable")));
    child.on("close", (code) => {
      if (code)
        return reject(Error("Mac helper could not complete the request"));
      try {
        const data = JSON.parse(out);
        if (data.error) reject(Error(data.error));
        else resolve(data);
      } catch {
        reject(Error("Invalid Mac helper response"));
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(input));
  });
}
async function localFetch(endpoint, body, signal) {
  const r = await fetch(`http://127.0.0.1:11434/api/${endpoint}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal,
    redirect: "error",
  });
  if (!r.ok) throw Error("Ollama request failed");
  return r.json();
}
async function capabilities() {
  const providers = [];
  try {
    const data = await localFetch("tags", null, AbortSignal.timeout(2000));
    providers.push({
      id: "ollama",
      available: true,
      models: (data.models || []).map((m) => m.name),
    });
  } catch {
    providers.push({
      id: "ollama",
      available: false,
      models: [],
      reason: "Start Ollama and install a model separately.",
    });
  }
  try {
    const a = await native(
      { operation: "availability" },
      AbortSignal.timeout(3000),
    );
    providers.push({
      id: "apple",
      available: a.available,
      models: a.available ? ["system"] : [],
      reason: a.reason,
    });
  } catch {
    providers.push({
      id: "apple",
      available: false,
      models: [],
      reason: "Install the Mac helper on a supported Mac.",
    });
  }
  return { providers, externalEnabled: enabled };
}
async function generate(b, signal) {
  if (
    !["ollama", "apple", "anthropic", "bedrock"].includes(b.provider) ||
    typeof b.prompt !== "string" ||
    b.prompt.length > 40000 ||
    typeof b.model !== "string" ||
    b.model.length > 160
  )
    throw Error("Invalid model request");
  if (b.provider === "apple") {
    const r = await native({ operation: "generate", prompt: b.prompt }, signal);
    return { text: r.text, model: "apple-system" };
  }
  if (b.provider === "ollama") {
    if (!b.model) throw Error("Choose an installed Ollama model");
    const tags = await localFetch("tags", null, signal);
    if (!tags.models?.some((m) => m.name === b.model))
      throw Error("Selected Ollama model is not installed");
    const r = await localFetch(
      "generate",
      {
        model: b.model,
        prompt: b.prompt,
        stream: false,
        options: { num_predict: 2500 },
      },
      signal,
    );
    return { text: r.response, model: b.model };
  }
  if (!enabled || b.externalApproved !== true)
    throw Error("External AI is disabled or not approved for this task");
  if (!b.model) throw Error("Specify an external model ID");
  const controller = new AbortController();
  externalControllers.add(controller);
  try {
    const creds = (
      await native({ operation: "keychain_get", provider: b.provider }, signal)
    ).credentials;
    if (!enabled) throw Error("External AI disabled");
    const client =
      b.provider === "anthropic"
        ? new Anthropic({ apiKey: creds.apiKey, maxRetries: 0 })
        : new AnthropicBedrock({
            awsAccessKey: creds.accessKeyId,
            awsSecretKey: creds.secretAccessKey,
            awsSessionToken: creds.sessionToken || undefined,
            awsRegion: creds.region,
            maxRetries: 0,
          });
    const response = await client.messages.create(
      {
        model: b.model,
        max_tokens: 2500,
        messages: [{ role: "user", content: b.prompt }],
      },
      { signal: AbortSignal.any([signal, controller.signal]) },
    );
    return {
      text: response.content
        .filter((x) => x.type === "text")
        .map((x) => x.text)
        .join("\n"),
      model: b.model,
    };
  } catch {
    throw Error(
      "External provider request failed; check credentials, model access, and availability. No fallback was used.",
    );
  } finally {
    externalControllers.delete(controller);
  }
}
function authorized(req) {
  const a = Buffer.from(req.headers.authorization || ""),
    b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
const server = http.createServer(async (req, res) => {
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  const send = (code, data) => {
    res.statusCode = code;
    res.end(JSON.stringify(data));
  };
  if (!authorized(req)) return send(401, { error: "Unauthorized" });
  if (req.headers.origin)
    return send(403, { error: "Browser requests are not accepted" });
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  const timer = setTimeout(() => abort.abort(), 175000);
  try {
    if (req.method === "GET" && req.url === "/v1/capabilities")
      return send(200, await capabilities());
    if (
      req.method !== "POST" ||
      !["/v1/generate", "/v1/credentials", "/v1/policy"].includes(req.url)
    )
      return send(404, { error: "Not found" });
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 128 * 1024) return send(413, { error: "Request too large" });
      chunks.push(chunk);
    }
    const b = JSON.parse(Buffer.concat(chunks).toString());
    if (req.url === "/v1/policy") {
      if (typeof b.enabled !== "boolean") throw Error("Invalid policy");
      enabled = b.enabled;
      if (!enabled) for (const c of externalControllers) c.abort();
      fs.writeFileSync(
        policyFile,
        JSON.stringify({ externalEnabled: enabled }),
        { mode: 0o600 },
      );
      return send(200, { enabled });
    }
    if (req.url === "/v1/credentials") {
      if (!enabled) throw Error("External AI disabled");
      if (!["anthropic", "bedrock"].includes(b.provider))
        throw Error("Unknown provider");
      const credentials =
        b.provider === "anthropic"
          ? { apiKey: b.apiKey }
          : {
              accessKeyId: b.accessKeyId,
              secretAccessKey: b.secretAccessKey,
              sessionToken: b.sessionToken,
              region: b.region,
            };
      if (
        b.provider === "anthropic"
          ? typeof b.apiKey !== "string" || !b.apiKey
          : !b.accessKeyId || !b.secretAccessKey || !b.region
      )
        throw Error("Required credential fields missing");
      await native(
        { operation: "keychain_set", provider: b.provider, credentials },
        abort.signal,
      );
      return send(200, { saved: true });
    }
    return send(200, await generate(b, abort.signal));
  } catch (e) {
    return send(400, {
      error: e.message?.startsWith("External provider")
        ? e.message
        : "Model bridge could not complete this operation. Check local availability and configuration.",
    });
  } finally {
    clearTimeout(timer);
  }
});
server.requestTimeout = 180000;
server.listen(4242, "127.0.0.1", () =>
  console.log("StrategyLocal model bridge listening on 127.0.0.1:4242"),
);
