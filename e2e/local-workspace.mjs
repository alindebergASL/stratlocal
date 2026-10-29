import http from "node:http";
// SYNTHETIC ONLY. Standalone smoke against the current production build.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import JSZip from "jszip";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "strategylocal-ui-"));
const port = process.env.LOCAL_E2E_PORT || "3119",
  base = `http://127.0.0.1:${port}`;
const log = fs.openSync(path.join(temp, "server.log"), "w");
const mockToken = "synthetic-local-test-token-01234567890123456789";
const modelBridge = http.createServer(async (req, res) => {
  assert.equal(req.headers.authorization, `Bearer ${mockToken}`);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  res.setHeader("content-type", "application/json");
  if (req.url === "/v1/capabilities")
    return res.end(
      JSON.stringify({
        providers: [
          { id: "ollama", available: true, models: ["synthetic-test"] },
        ],
        externalEnabled: false,
      }),
    );
  const b = JSON.parse(Buffer.concat(chunks).toString());
  assert.equal(b.provider, "ollama");
  assert.equal(b.externalApproved, false);
  res.end(
    JSON.stringify({
      text: "Synthetic reviewed plan based on evidence [S1]",
      model: "synthetic-test",
    }),
  );
});
await new Promise((r) => modelBridge.listen(0, "127.0.0.1", r));
const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-p", port, "-H", "127.0.0.1"],
  {
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      STRATEGY_LOCAL_ONLY: "1",
      DB_PATH: path.join(temp, "strategy.sqlite"),
      MODEL_BRIDGE_URL: `http://127.0.0.1:${modelBridge.address().port}`,
      MODEL_BRIDGE_TOKEN: mockToken,
      MODEL_BRIDGE_TOKEN_FILE: "",
      USER1_EMAIL: "synthetic@example.invalid",
      USER1_PASSWORD: "Synthetic-local-test-123",
      USER2_EMAIL: "",
      USER2_PASSWORD: "",
    },
    stdio: ["ignore", log, log],
  },
);
let browser;
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${base}/login`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(ready, "server ready");
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  page.on("response", async (r) => {
    if (r.url().includes("/api/local/") && r.status() >= 400)
      console.error(r.status(), await r.text());
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/login`);
  await page.locator("input[type=email]").fill("synthetic@example.invalid");
  await page.locator("input[type=password]").fill("Synthetic-local-test-123");
  await page.locator("button[type=submit]").click();
  await page.waitForURL(`${base}/accounts`);
  await page
    .locator("[data-testid=account-new] input[name=name]")
    .fill("Synthetic Local Lab");
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page.waitForURL(/\/accounts\/[^/]+$/);
  const accountId = page.url().split("/").pop();
  await page
    .getByRole("link", { name: "Evidence & MyAgent", exact: true })
    .click();
  await page.waitForURL(/\/evidence$/);
  const intake = page.locator("#new-account-intake");
  assert.equal(
    await page.locator("main section").last().getAttribute("id"),
    "new-account-intake",
  );
  await intake.locator("input[name=website]").fill("https://example.org");
  await intake
    .locator("textarea[name=question]")
    .fill("Prioritize budget and procurement research");
  await intake
    .getByRole("button", {
      name: "Prepare new account intake request",
      exact: true,
    })
    .click();
  await page.waitForURL(/\/requests\//);
  const savedIntakeUrl = page.url();
  const intakeText = await page.locator("pre").innerText();
  assert.match(intakeText, /Synthetic Local Lab/);
  assert.match(intakeText, /IsClosed=false/);
  assert.match(intakeText, /Conduct web research/);
  assert.match(intakeText, /Prioritize budget and procurement research/);
  const markdownHref = await page
    .getByRole("link", { name: "Download prompt (.md)", exact: true })
    .getAttribute("href");
  const markdown = await page.request.get(`${base}${markdownHref}`);
  assert.equal(markdown.status(), 200);
  assert.match(markdown.headers()["content-type"], /text\/markdown/);
  assert.equal(await markdown.text(), intakeText);
  const intakeZipHref = await page
    .getByRole("link", {
      name: "Download request & selected originals",
      exact: true,
    })
    .getAttribute("href");
  const intakeZipResponse = await page.request.get(`${base}${intakeZipHref}`);
  const intakeZip = await JSZip.loadAsync(await intakeZipResponse.body());
  assert.equal(await intakeZip.file("request.md").async("string"), intakeText);
  await page.getByRole("link", { name: "Return to evidence & MyAgent", exact: true }).click();
  const requestHistory = page.locator("#saved-requests");
  await requestHistory.getByRole("heading", { name: "Saved MyAgent requests" }).waitFor();
  await requestHistory.getByRole("link", { name: "Open saved request", exact: true }).click();
  await page.waitForURL(savedIntakeUrl);
  assert.equal(page.url(), savedIntakeUrl);
  assert.equal(await page.locator("pre").innerText(), intakeText);
  await page.getByRole("link", { name: "Return to evidence & MyAgent", exact: true }).click();
  assert.equal(await page.getByRole("navigation", { name: "Account navigation" }).getByRole("link", { name: "Evidence & MyAgent", exact: true }).getAttribute("aria-current"), "page");
  const zip = new JSZip();
  zip.file(
    "manifest.json",
    JSON.stringify({
      version: 1,
      as_of: "2026-01-01",
      artifacts: [
        {
          path: "sources/notes.md",
          audience: "internal",
          author_labels: ["I"],
        },
      ],
      accounts: [
        {
          key: "lab",
          report: {
            account: { name: "Synthetic Local Lab", summary: "Synthetic research organization serving local laboratories.", hq: "Synthetic City" },
            contacts: [{ name: "Synthetic Customer Director", title: "Research Director", org: "customer", role: "Research planning sponsor" }],
            plays: [
              {
                title: "Synthetic local opportunity",
                thesis: "Validate needs",
              },
            ],
          },
          sources: [
            {
              path: "sources/notes.md",
              locator: "## Preparation",
              quote: "Synthetic customer evidence",
            },
          ],
        },
      ],
    }),
  );
  zip.file("sources/notes.md", "# Preparation\nSynthetic customer evidence");
  await page.locator("input[type=file]").setInputFiles({
    name: "myagent.zip",
    mimeType: "application/zip",
    buffer: await zip.generateAsync({ type: "nodebuffer" }),
  });
  await page.getByRole("button", { name: "Import for review" }).click();
  await page.waitForURL(/\/imports\//);
  await page
    .getByRole("button", { name: "Confirm account mapping" })
    .waitFor({ timeout: 20000 });
  await page.getByRole("heading", { name: "Package overview" }).waitFor();
  await page.getByRole("heading", { name: "Research, stakeholders & source detail" }).waitFor();
  const preview = page.locator("details").filter({ has: page.locator("summary", { hasText: "sources/notes.md" }) });
  await preview.locator("summary").click();
  assert.match(await preview.innerText(), /Synthetic customer evidence/);
  await preview.getByRole("link", { name: "Download original", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Research coverage & next steps" }).waitFor();
  const importReviewUrl = page.url();
  await page.getByRole("button", { name: "Prepare MyAgent follow-up for gaps" }).click();
  await page.waitForURL(/\/requests\//);
  assert.match(await page.locator("pre").innerText(), /coverage ledger/);
  await page.goto(importReviewUrl);
  await page.getByRole("button", { name: "Confirm account mapping" }).click();
  await page.getByRole("button", { name: "Prepare proposals" }).click();
  await page.waitForURL(/\/inbox/);
  await page.goto(`${base}/accounts/${accountId}`);
  await page.getByTestId("account-attention").getByRole("link", { name: /proposed changes to review/ }).click();
  await page.waitForURL(/\/inbox\?/);
  assert.equal(new URL(page.url()).searchParams.get("account"), accountId);
  await page.getByTestId("review-as-list").click();
  for (const checkbox of await page.getByLabel(/I understand this is an/).all()) await checkbox.check();
  const batches = page.getByTestId("accept-all");
  for (let i = 0; i < await batches.count(); i++) {
    await batches.nth(i).click();
    await page.waitForFunction(index => document.querySelectorAll('[data-testid="accept-all"]')[index]?.textContent?.trim() === "All decided", i);
  }
  await page.goto(`${base}/accounts/${accountId}`);
  await page.getByRole("heading", { name: "Account overview", exact: true }).waitFor();
  assert.equal(await page.getByTestId("account-attention").getByRole("link", { name: /proposed changes to review/ }).count(), 0);
  assert.match(await page.locator("body").innerText(), /Synthetic research organization serving local laboratories/);
  await page.goto(`${base}/accounts/${accountId}/people`);
  await page.getByText("Synthetic Customer Director", { exact: true }).first().waitFor();
  await page.goto(`${base}/accounts/${accountId}/evidence`);
  await page.getByRole("link", { name: "notes.md", exact: true }).waitFor();
  const request = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "Prepare request", exact: true }) });
  await request.locator("textarea").fill("Research the next discovery meeting");
  await request.getByLabel("notes.md", { exact: true }).check();
  await request
    .getByRole("button", { name: "Prepare request", exact: true })
    .click();
  await page.waitForURL(/\/requests\//);
  assert.match(
    await page.locator("body").innerText(),
    /Research the next discovery meeting/,
  );
  assert.ok(
    await page
      .getByRole("link", { name: "Download request & selected originals" })
      .count(),
  );
  await page.goto(`${base}/accounts/${accountId}/evidence`);
  const draft = page
    .locator("form")
    .filter({ has: page.locator("select[name=task]") });
  await draft.getByLabel("notes.md", { exact: true }).check();
  await draft.locator("input[name=model]").fill("synthetic-test");
  await draft.locator("select[name=task]").selectOption("account_plan");
  await draft.getByRole("button", { name: "Preview context" }).click();
  await page.waitForURL(/\/drafts\/preview\//);
  assert.match(
    await page.locator("body").innerText(),
    /Synthetic customer evidence/,
  );
  assert.equal(await page.locator("input[name=externalApproved]").count(), 0);
  await page.getByRole("button", { name: "Run this task" }).click();
  await page.waitForURL(/\/imports\?job=/);
  await page
    .getByRole("link", { name: "Review draft", exact: true })
    .waitFor({ timeout: 20000 });
  await page.getByRole("link", { name: "Review draft", exact: true }).click();
  await page
    .getByRole("button", { name: "Accept and update account thesis" })
    .click();
  await page.getByText("Original generated text", { exact: true }).waitFor();
  await page.goto(`${base}/accounts/${accountId}`);
  assert.match(
    await page.locator("body").innerText(),
    /Synthetic reviewed plan/,
  );
  await page.goto(`${base}/accounts/${accountId}/meetings`);
  await page.getByRole("button", { name: "New meeting", exact: true }).click();
  await page
    .locator("[data-testid=meeting-new] input[name=title]")
    .fill("Synthetic discovery meeting");
  await page
    .getByRole("button", { name: "Create meeting", exact: true })
    .click();
  await page.waitForURL(/\/meetings\/[^/]+$/);
  await page
    .locator("textarea[name=raw_notes]")
    .fill("Synthetic customer confirmed the next step.");
  await page
    .locator("form")
    .filter({ has: page.locator("textarea[name=raw_notes]") })
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page
    .getByText("Discovery questions & customer confirmations", { exact: true })
    .click();
  await page.locator("input[name=question]").fill("Who owns the decision?");
  await page.getByRole("button", { name: "Save discovery record" }).click();
  await page
    .getByText("question · Who owns the decision?", { exact: true })
    .waitFor();
  for (const route of [
    "territory",
    "meetings",
    "imports",
    "settings/local",
    "settings/advanced/external-ai",
    `accounts/${accountId}/plays`,
    `accounts/${accountId}/meetings`,
    `accounts/${accountId}/requests`,
  ]) {
    const res = await page.goto(`${base}/${route}`);
    assert.equal(res.status(), 200, route);
    assert.doesNotMatch(
      await page.locator("body").innerText(),
      /Application error/,
    );
  }
  await page.goto(`${base}/settings/advanced/external-ai`);
  assert.match(
    await page.locator("body").innerText(),
    /External AI is disabled/,
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "PASS: login → account → new account intake and Markdown/ZIP downloads → saved request reopen and active tab → package review → account attention and proposal acceptance → linked evidence → MyAgent request → local draft acceptance and account-plan update → meeting notes and discovery question; request history, territory, meetings and disabled external settings render without browser errors.",
  );
} catch (e) {
  console.error(
    fs.readFileSync(path.join(temp, "server.log"), "utf8").slice(-8000),
  );
  throw e;
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
  if (server.exitCode === null)
    await new Promise((r) => server.once("exit", r));
  await new Promise((r) => modelBridge.close(r));
  fs.closeSync(log);
  fs.rmSync(temp, { recursive: true, force: true });
}
