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
  const chunks=[]; for await (const c of req) chunks.push(c);
  res.setHeader("content-type","application/json");
  if(req.url==="/v1/capabilities") return res.end(JSON.stringify({providers:[{id:"ollama",available:true,models:["synthetic-test"]}],externalEnabled:false}));
  const b=JSON.parse(Buffer.concat(chunks).toString());
  assert.equal(b.provider,"ollama"); assert.equal(b.externalApproved,false);
  res.end(JSON.stringify({text:"Synthetic reviewed plan based on evidence [S1]",model:"synthetic-test"}));
});
await new Promise(r=>modelBridge.listen(0,"127.0.0.1",r));
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
            account: { name: "Synthetic Local Lab" },
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
              locator: "section:1",
              quote: "Synthetic customer evidence",
            },
          ],
        },
      ],
    }),
  );
  zip.file("sources/notes.md", "# Preparation\nSynthetic customer evidence");
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "myagent.zip",
      mimeType: "application/zip",
      buffer: await zip.generateAsync({ type: "nodebuffer" }),
    });
  await page.getByRole("button", { name: "Import for review" }).click();
  await page.waitForURL(/\/imports\//);
  await page
    .getByRole("button", { name: "Confirm account mapping" })
    .waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Confirm account mapping" }).click();
  await page.getByRole("button", { name: "Prepare proposals" }).click();
  await page.waitForURL(/\/inbox/);
  await page.goto(`${base}/accounts/${accountId}/evidence`);
  await page.getByRole("link", { name: "notes.md", exact: true }).waitFor();
  const request = page
    .locator("form")
    .filter({ has: page.locator("textarea[name=question]") });
  await request.locator("textarea").fill("Research the next discovery meeting");
  await request.locator("input[name=artifactIds]").check();
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
  await draft.locator("input[name=artifactIds]").check();
  await draft.locator("input[name=model]").fill("synthetic-test");
  await draft.locator("select[name=task]").selectOption("account_plan");
  await draft.getByRole("button", { name: "Preview context" }).click();
  await page.waitForURL(/\/drafts\/preview\//);
  assert.match(
    await page.locator("body").innerText(),
    /Synthetic customer evidence/,
  );
  assert.equal(await page.locator("input[name=externalApproved]").count(), 0);
  await page.getByRole("button",{name:"Run this task"}).click();
  await page.waitForURL(/\/imports\?job=/);
  await page.getByRole("link",{name:"Review draft",exact:true}).waitFor({timeout:20000});
  await page.getByRole("link",{name:"Review draft",exact:true}).click();
  await page.getByRole("button",{name:"Accept and update account thesis"}).click();
  await page.getByText("Original generated text",{exact:true}).waitFor();
  await page.goto(`${base}/accounts/${accountId}`);
  assert.match(await page.locator("body").innerText(),/Synthetic reviewed plan/);
  await page.goto(`${base}/accounts/${accountId}/meetings`);
  await page.getByRole("button",{name:"New meeting",exact:true}).click();
  await page.locator('[data-testid=meeting-new] input[name=title]').fill("Synthetic discovery meeting");
  await page.getByRole("button",{name:"Create meeting",exact:true}).click();
  await page.waitForURL(/\/meetings\/[^/]+$/);
  await page.locator('textarea[name=raw_notes]').fill("Synthetic customer confirmed the next step.");
  await page.locator('form').filter({has:page.locator('textarea[name=raw_notes]')}).getByRole('button',{name:'Save',exact:true}).click();
  await page.getByText('Discovery questions & customer confirmations',{exact:true}).click();
  await page.locator('input[name=question]').fill('Who owns the decision?');
  await page.getByRole('button',{name:'Save discovery record'}).click();
  await page.getByText('question · Who owns the decision?',{exact:true}).waitFor();
  for (const route of [
    "territory",
    "meetings",
    "imports",
    "settings/local",
    "settings/advanced/external-ai",
    `accounts/${accountId}/plays`,
    `accounts/${accountId}/meetings`,
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
    "PASS: login → account → package review → linked evidence → MyAgent request → local draft acceptance and account-plan update → meeting notes and discovery question; territory, meetings and disabled external settings render without browser errors.",
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
  await new Promise(r=>modelBridge.close(r));
  fs.closeSync(log);
  fs.rmSync(temp, { recursive: true, force: true });
}
