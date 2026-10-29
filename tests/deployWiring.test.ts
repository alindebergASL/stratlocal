// Source-level wiring checks; no Docker daemon or external services in CI.
// A release still needs `docker compose ... config` and a real image smoke test.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const compose = readFileSync("deploy/compose.yml", "utf8");
const dockerfile = readFileSync("deploy/Dockerfile", "utf8");
const example = readFileSync("deploy/.env.example", "utf8");
const readme = readFileSync("deploy/README.md", "utf8");
const caddy = readFileSync("deploy/Caddyfile", "utf8");
function service(name: string) {
  const block = compose.match(new RegExp(`^  ${name}:\\n[\\s\\S]*?(?=^  \\w+:|^volumes:)`, "m"));
  expect(block, `service ${name}`).not.toBeNull();
  return block![0];
}
function environment(name: string) {
  return service(name).match(/^    environment:\n([\s\S]*?)(?=^    \S|^\s*$)/m)![1]!;
}

describe("first deployment wiring", () => {
  it("lets web inspect the same offsite backup prefix the backup writes", () => {
    expect(environment("web")).toContain("BACKUP_S3_URI: ${BACKUP_S3_URI:-}");
    expect(environment("backup")).toContain("BACKUP_S3_URI: ${BACKUP_S3_URI}");
    for (const name of ["web", "backup"]) {
      expect(environment(name)).toContain("DB_PATH: /app/data/strategy.sqlite");
      expect(environment(name)).toContain("AWS_REGION: ${AWS_REGION}");
    }
  });

  it("forwards every documented current Claude and web-tool price, without inventing rates", () => {
    const prices = [...example.matchAll(/^(AI_PRICE_\w+)=$/gm)].map((m) => m[1]!);
    expect(prices).toHaveLength(10);
    for (const key of prices) expect(environment("web")).toContain(`${key}: \${${key}:-}`);
    expect(prices).toContain("AI_PRICE_US_ANTHROPIC_CLAUDE_OPUS_5_5_INPUT");
    expect(prices).toContain("AI_PRICE_CLAUDE_OPUS_5_5_INPUT");
    expect(example).toContain("BEDROCK_MODEL_ID=us.anthropic.claude-opus-5-5");
    // The root example is now the local MyAgent workflow. Cloud configuration
    // stays in deploy/.env.example; it must not become a local prerequisite.
    const local = readFileSync(".env.example", "utf8");
    expect(local).toContain("STRATEGY_LOCAL_ONLY=1");
    expect(local).toContain("AI_DAILY_CAP_CENTS=0");
    expect(local).not.toMatch(/^(AWS_REGION|BEDROCK_MODEL_ID|ANTHROPIC_API_KEY)=/m);
  });

  it("builds both images with the public hostname and disables HTTP healthchecks only for backup", () => {
    for (const name of ["web", "backup"]) {
      expect(service(name)).toMatch(/args:\n(?:\s*#.*\n)*        APP_HOSTNAME: \$\{APP_HOSTNAME\}/);
    }
    expect(service("backup")).toMatch(/healthcheck:\n      disable: true/);
    expect(service("web")).not.toContain("disable: true");
    expect(service("backup")).not.toMatch(/^    entrypoint:/m);
    expect(service("backup")).toContain("node /app/scripts/backup.mjs");
  });

  it("binds standalone to all IPv4 interfaces and probes IPv4 loopback", () => {
    expect(dockerfile).toContain("ENV HOSTNAME=0.0.0.0");
    expect(dockerfile).toContain("curl -fsS http://127.0.0.1:3000/login");
  });

  it("documents image-compatible smoke checks and the existing CI", () => {
    expect(readme).not.toContain("exec web npm run smoke:providers");
    expect(readme).not.toContain("No CI");
    expect(readme).toContain("Check providers on Home");
    expect(readme).toContain("import a report to exercise structured output");
    expect(readme).toContain("GitHub Actions CI");
  });
});

describe("the scheduler (DECISIONS #38)", () => {
  it("knocks on the inside network with the same secret the app checks, and the proxy keeps the door shut", () => {
    expect(environment("scheduler")).toContain("SCHEDULER_SECRET: ${SCHEDULER_SECRET:-}");
    expect(environment("scheduler")).toContain("SCHEDULER_URL: http://web:3000/api/internal/tick");
    expect(environment("web")).toContain("SCHEDULER_SECRET: ${SCHEDULER_SECRET:-}");
    expect(service("scheduler")).toContain("node /app/scripts/tick.mjs");
    expect(service("scheduler")).toMatch(/healthcheck:\n      disable: true/);
    expect(service("scheduler")).not.toMatch(/^    ports:/m);
    expect(caddy).toContain("respond /api/internal/* 404");
    expect(example).toMatch(/^SCHEDULER_SECRET=$/m);
    expect(example).toMatch(/^AI_MONTHLY_CAP_CENTS=25000$/m);
  });
});

describe("calendars (DECISIONS #42)", () => {
  it("forwards every calendar credential to web, each optional, and documents them", () => {
    for (const key of ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "GOOGLE_SERVICE_ACCOUNT_JSON", "INTERNAL_EMAIL_DOMAINS"]) {
      expect(environment("web")).toContain(`${key}: \${${key}:-}`);
      expect(example).toMatch(new RegExp(`^${key}=$`, "m"));
    }
    expect(readme).toContain("/api/calendar/hook/");
    // The hook is public by design; only the scheduler's door is closed at the proxy.
    expect(caddy).not.toContain("/api/calendar");
  });
});
