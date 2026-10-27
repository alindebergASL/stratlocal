// Is this deployment wired up, and does the page say so when it is not?
//
// These are the checks that only matter on a day nobody has had yet, which is
// exactly why they need a test: nothing here has met real AWS, and the first
// hour after the first deploy is where a wrong answer costs a day.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { backupCheck, budgetChecks, clockChecks, databaseChecks, originChecks, providerChecks } from "@/lib/setup";
import { providerHint } from "@/lib/ai/client";
import { getRun, runDetached, startRun } from "@/lib/ai/guard";

beforeEach(() => {
  vi.stubEnv("AI_FAKE", "");
  return () => vi.unstubAllEnvs();
});

describe("the database", () => {
  it("reports the path DB_PATH actually resolved to, not the variable", () => {
    // The whole point: DB_PATH's default is relative to process.cwd(), and
    // under the standalone server that is .next/standalone — so an unset
    // DB_PATH puts the database and every uploaded report inside the image
    // layer, to be destroyed by the next `up --force-recreate`.
    // deploy/compose.yml sets it and deploy/README.md warns about it, and
    // neither is visible from a running app.
    const file = databaseChecks()[0]!;
    expect(file.label).toBe("Database file");
    expect(file.value).toBeTruthy();
  });

  it("says nobody can sign in when the users table is empty", () => {
    // Users are seeded only when the table is empty, so getting this wrong on
    // the first boot means a deployment that renders a login page nobody can
    // get past — and the reason is in a log file on the box.
    const what = databaseChecks().find((c) => c.label === "What is in it")!;
    expect(what.state).toBe("bad");
    expect(what.detail).toMatch(/USER1_EMAIL/);
  });
});

describe("the clock", () => {
  it("says what day it thinks it is and in which zone", () => {
    const checks = clockChecks(new Date("2026-09-15T19:00:00Z"));
    expect(checks.find((c) => c.label === "Timezone")?.value).toBe("America/Los_Angeles");
    expect(checks.find((c) => c.label === "Today, here")?.value).toBe("2026-09-15 at 12:00");
  });
});

describe("behind the proxy", () => {
  it("is the failure that renders every page and refuses every save", () => {
    vi.stubEnv("APP_HOSTNAME", "strategy.example.com");
    expect(originChecks("strategy.example.com", null)[0]!.state).toBe("ok");
    // A forwarded host wins, because that is what the server action sees.
    expect(originChecks("web:3000", "strategy.example.com")[0]!.state).toBe("ok");
    const bad = originChecks("web:3000", "someone-else.example.com")[0]!;
    expect(bad.state).toBe("bad");
    expect(bad.value).toMatch(/someone-else/);
    expect(bad.value).toMatch(/strategy.example.com/);
  });

  it("warns rather than fails when APP_HOSTNAME is unset locally", () => {
    vi.stubEnv("APP_HOSTNAME", "");
    expect(originChecks("localhost:3000", null)[0]!.state).toBe("ok");
    expect(originChecks("strategy.example.com", null)[0]!.state).toBe("warn");
  });
});

describe("money and providers", () => {
  it("says a cap of zero means model calls are off", () => {
    vi.stubEnv("AI_DAILY_CAP_CENTS", "0");
    const cap = budgetChecks().find((c) => c.label === "Daily cap")!;
    expect(cap.state).toBe("warn");
    expect(cap.value).toMatch(/off/);
  });

  it("flags a Bedrock price as an estimate rather than pretending it is exact", () => {
    // AWS does not publish Bedrock's rates anywhere this app can read, so the
    // figure is derived from list prices and says so — the standing honest-cost
    // commitment, checked rather than remembered.
    const price = budgetChecks().find((c) => c.label === "Price for bedrock")!;
    expect(price.state).toBe("warn");
    expect(price.detail).toMatch(/list prices/);
  });

  it("names the missing variable for each provider", () => {
    vi.stubEnv("AWS_REGION", "");
    vi.stubEnv("AWS_DEFAULT_REGION", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const checks = providerChecks();
    expect(checks.every((c) => c.state === "bad")).toBe(true);
    expect(checks[0]!.detail).toMatch(/AWS_REGION/);
    expect(checks[1]!.detail).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("says plainly when every call is canned", () => {
    // AI_FAKE makes every button work without credentials, which is right for
    // development and would be the most misleading possible thing to leave on
    // in production.
    vi.stubEnv("AI_FAKE", "1");
    const checks = providerChecks();
    expect(checks).toHaveLength(1);
    expect(checks[0]!.value).toBe("AI_FAKE=1");
  });
});

describe("a check cannot hang the page that is checking", () => {
  it("gives up on S3 rather than waiting forever", async () => {
    // Reproduced before this existed: pointed at an address that drops packets
    // — which is what a security group with no egress rule, or a missing S3
    // VPC endpoint, looks like from inside the container — /setup hung past
    // 130 seconds and had to be killed. The AWS SDK's Node handler has no
    // request timeout by default and retries three times, so "unreachable"
    // and "slow" are the same thing to it and neither ever ends.
    //
    // A diagnostics page that the thing it diagnoses can hang is worse than no
    // diagnostics page: on the day you open it, it is the one screen you
    // cannot get an answer out of.
    vi.stubEnv("BACKUP_S3_URI", "s3://whatever/backups");
    vi.stubEnv("AWS_REGION", "us-east-1");
    // 10.255.255.1 is routable-looking and answers nothing.
    vi.stubEnv("AWS_ENDPOINT_URL_S3", "http://10.255.255.1:9000");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "x");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "y");
    const started = Date.now();
    const r = await backupCheck();
    const seconds = (Date.now() - started) / 1000;
    expect(seconds).toBeLessThan(12);
    expect(r.state).toBe("bad");
    // And it says which kind of unreachable, because dropped and refused mean
    // different things to fix.
    expect(r.detail).toMatch(/did not answer|dropped rather than refused/i);
  }, 30_000);

  it("answers immediately when nothing is configured", async () => {
    vi.stubEnv("BACKUP_S3_URI", "");
    const r = await backupCheck();
    expect(r.state).toBe("bad");
    expect(r.detail).toMatch(/BACKUP_S3_URI/);
  });

  it("refuses a URI that is not s3://bucket/prefix without calling anything", async () => {
    vi.stubEnv("BACKUP_S3_URI", "/mnt/backups");
    const r = await backupCheck();
    expect(r.detail).toMatch(/s3:\/\/bucket/);
  });
});

describe("what an AWS failure actually means", () => {
  // Each of these reaches the screen today as a raw SDK message, and each
  // reads as "the button is broken" while being a one-line fix somewhere else.
  it.each([
    ["CredentialsProviderError: Could not load credentials from any providers", /hop limit/i],
    ["AccessDeniedException: User is not authorized to perform bedrock:InvokeModel", /model ARN/i],
    ["ValidationException: Invocation of model ID anthropic.claude-opus-5 with on-demand throughput isn't supported", /inference-profile/i],
    ["ResourceNotFoundException: The provided model identifier is invalid", /region/i],
    ["ThrottlingException: Too many requests", /quota/i],
    ["authentication_error: invalid x-api-key", /ANTHROPIC_API_KEY/],
  ])("explains %s", (raw, expected) => {
    expect(providerHint(raw)).toMatch(expected);
  });

  it("says nothing rather than guessing at something it does not recognise", () => {
    expect(providerHint("ECONNRESET: socket hang up")).toBeNull();
  });

  it("reaches a real run, not only the diagnostics", async () => {
    // This was written for the five failures that will actually happen and
    // wired into exactly two places — the smoke check and the backup check —
    // so the six surfaces where an AccessDenied or an IMDSv2 hop limit will
    // really appear (import, extraction, brief, research, plan draft, the
    // invite paste) all recorded the raw string. Every one of them goes
    // through runDetached, which also threw away the error's class name
    // first — and for an AWS failure the class name is the diagnosis.
    //
    // Driven rather than read out of the source: what matters is what lands
    // in the run row, which is the only record anyone ever sees.
    vi.stubEnv("AWS_REGION", "us-east-1");
    const run = startRun({ role: "import", accountId: null, userId: "user-1", kind: "test" });
    runDetached(run.id, async () => {
      throw Object.assign(new Error("User: arn:aws:sts::1:assumed-role/app is not authorized to perform: bedrock:InvokeModel"), {
        name: "AccessDeniedException",
      });
    });
    await vi.waitFor(() => expect(getRun(run.id)?.status).toBe("failed"));
    const recorded = getRun(run.id)!.error ?? "";
    // The sentence someone can act on comes first...
    expect(recorded).toMatch(/model ARN/);
    // ...and the provider's own words are still there underneath it.
    expect(recorded).toMatch(/bedrock:InvokeModel/);
    expect(recorded).toMatch(/AccessDeniedException/);
  });
});
