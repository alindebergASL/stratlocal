// The morning briefing and the digest (DECISIONS #99): Today says what changed
// and what is due, counted from the records; a person connects their own
// Slack webhook (here, a fake on loopback), a test arrives with no account
// name in it, the digest arrives when run, and the scheduler sends it at most
// once a day. The pages fit a phone.
import { createServer } from "node:http";
import { join } from "node:path";
import { BASE, checker, launch, signIn } from "./browser.mjs";

const c = checker("morning briefing and digest");
const got = [];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    got.push(JSON.parse(body));
    res.end("ok");
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const hook = `http://127.0.0.1:${server.address().port}/synthetic-hook`;

const browser = await launch();
const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);
const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const waitFor = async (n) => {
  for (let i = 0; i < 50 && got.length < n; i++) await page.waitForTimeout(100);
};

try {
  await page.goto(`${BASE}/accounts`);
  const trigger = page.locator('[data-testid="account-new-open"]');
  if (await trigger.count()) await trigger.click();
  await page.fill('[data-testid="account-new"] [name="name"]', "Synthetic Briefing Works");
  await page.click('[data-testid="account-new-submit"]');
  await page.waitForURL(/\/accounts\//, { timeout: 15000 });
  const accountId = page.url().split("/accounts/")[1].split(/[#/?]/)[0];
  // An imported report leaves changes waiting: the briefing counts them.
  await page.goto(`${BASE}/accounts/${accountId}/import`);
  await page.setInputFiles('input[type="file"]', join(process.cwd(), "tests/fixtures/agent-report.md"));
  await page.getByTestId("import-submit").click();
  await page.waitForSelector("text=/proposed change/", { timeout: 60000 });

  await page.goto(`${BASE}/`);
  const waiting = page.getByTestId("briefing-prepared").getByTestId("briefing-line").filter({ hasText: "waiting in your Inbox" });
  c.is("Today's briefing counts what waits in the Inbox", await waiting.count(), 1);
  await waiting.locator("a").click();
  await page.waitForURL(/\/inbox/);
  c.is("and the line opens the Inbox", new URL(page.url()).pathname, "/inbox");

  // Connect Slack.
  await page.goto(`${BASE}/settings/connections`);
  c.is("Slack starts unconnected", await page.getByTestId("connection-slack-state").innerText(), "Not connected");
  await page.getByTestId("connection-slack-form-open").click();
  await page.fill('[data-testid="connection-slack-form"] [name="url"]', "https://example.test/not-slack");
  await page.getByTestId("connection-slack-form-submit").click();
  await page.getByRole("alert").filter({ hasText: "hooks.slack.com" }).waitFor();
  c.is("an address that is not Slack's is refused", true, true);
  await page.fill('[data-testid="connection-slack-form"] [name="url"]', hook);
  await page.getByTestId("connection-slack-form-submit").click();
  await page.getByTestId("connection-slack-state").filter({ hasText: /^Connected$/ }).waitFor({ timeout: 15000 });
  c.is("once saved, only where it points is shown", (await page.getByTestId("connection-slack").innerText()).includes("synthetic-hook"), false);
  await page.getByTestId("connection-test").click();
  await waitFor(1);
  c.is("a test arrives", got.length, 1);
  c.is("with no account in it", JSON.stringify(got[0]).includes("Synthetic Briefing Works"), false);

  // The digest: on, without names; run it now.
  await page.getByTestId("digest-on").check();
  await page.getByTestId("digest-form-submit").click();
  await page.waitForTimeout(500);
  await page.goto(`${BASE}/assistants`);
  await page.getByTestId("assistant-mode-morning_digest-auto").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="assistant-mode-morning_digest-auto"]')?.getAttribute("aria-checked") === "true", null, { timeout: 10000 });
  await page.getByTestId("assistant-run-morning_digest").click();
  await waitFor(2);
  c.is("Run now sends the digest", got.length, 2);
  c.is("it starts with Today", String(got[1].text).startsWith("Today"), true);
  c.is("and names no account unless asked", String(got[1].text).includes("Synthetic Briefing Works"), false);

  // The scheduler: whatever it sends this morning, it sends once.
  const knock = () => fetch(`${BASE}/api/internal/tick`, { method: "POST", headers: { authorization: `Bearer ${process.env.E2E_SCHEDULER_SECRET}` } }).then((r) => r.json());
  await knock();
  await page.waitForTimeout(1500);
  const afterFirst = got.length;
  await knock();
  await page.waitForTimeout(1500);
  c.is("a second tick sends nothing more", got.length, afterFirst);

  // Recommended assistants in one press.
  await page.reload();
  if (await page.getByTestId("assistants-recommended-on").count()) {
    await page.getByTestId("assistants-recommended-on").click();
    await page.getByTestId("assistants-recommended").waitFor({ state: "detached", timeout: 15000 });
  }
  c.is("the recommended four run on their own", await page.getByTestId("assistant-mode-meeting_prep-auto").getAttribute("aria-checked"), "true");

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of ["/", "/settings/connections"]) {
      await page.goto(`${BASE}${path}`);
      c.is(`${path} fits ${width}px`, await fits(), true);
    }
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(c.done() ? 0 : 1);
