// The Writer (DECISIONS #106): with it on, Today leads with a written summary
// and an account's Where it stands is written, each sentence with numbered
// sources and the counts one press away. When the records move, the counted
// sentences show until the Writer catches up. The pages fit a phone.
import { join } from "node:path";
import Database from "better-sqlite3";
import { BASE, checker, launch, signIn } from "./browser.mjs";

const c = checker("writer");
const db = new Database(process.env.E2E_DB_PATH);
const browser = await launch();
const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);
const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
// Each visit asks the Writer to catch up in the background; a later one shows it.
async function until(url, testId, present = true) {
  for (let i = 0; i < 40; i++) {
    await page.goto(url);
    if ((await page.getByTestId(testId).count() > 0) === present) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

try {
  await page.goto(`${BASE}/accounts`);
  const trigger = page.locator('[data-testid="account-new-open"]');
  if (await trigger.count()) await trigger.click();
  await page.fill('[data-testid="account-new"] [name="name"]', "Synthetic Writer Works");
  await page.click('[data-testid="account-new-submit"]');
  await page.waitForURL(/\/accounts\//, { timeout: 15000 });
  const accountId = page.url().split("/accounts/")[1].split(/[#/?]/)[0];
  const overview = `${BASE}/accounts/${accountId}`;
  await page.goto(`${overview}/import`);
  await page.setInputFiles('input[type="file"]', join(process.cwd(), "tests/fixtures/agent-report.md"));
  await page.getByTestId("import-submit").click();
  await page.waitForSelector("text=/proposed change/", { timeout: 60000 });

  // Off: the counted text only.
  await page.goto(`${BASE}/`);
  c.is("with the Writer off, Today is counted", await page.getByTestId("today-written").count(), 0);
  c.is("and still briefs", await page.getByTestId("briefing-prepared").count() > 0, true);

  await page.goto(`${BASE}/assistants`);
  await page.getByTestId("assistant-mode-writer-auto").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="assistant-mode-writer-auto"]')?.getAttribute("aria-checked") === "true", null, { timeout: 10000 });
  await page.getByTestId("assistant-run-writer").click();

  c.is("Today leads with a written summary", await until(`${BASE}/`, "today-written"), true);
  const refs = page.getByTestId("today-written").getByTestId("written-ref");
  c.is("each sentence cites its sources", (await refs.count()) > 0, true);
  await page.getByTestId("written-show-counts").click();
  c.is("and the counts are one press away", await page.getByTestId("today-written").getByTestId("briefing-prepared").isVisible(), true);
  const href = await refs.first().getAttribute("href");
  c.is("a source opens its record", typeof href === "string" && href.startsWith("/"), true);

  c.is("the account's Where it stands is written", await until(overview, "account-written"), true);
  c.is("with its sources", (await page.getByTestId("account-written").getByTestId("written-ref").count()) > 0, true);

  // The records move: the counted sentences show until it is rewritten.
  db.prepare(`UPDATE accounts SET thesis = 'Synthetic thesis written after the summary' WHERE id = ?`).run(accountId);
  await page.goto(overview);
  c.is("after a change the counted sentences show", await page.getByTestId("account-written").count(), 0);
  c.is("Where it stands is still there", (await page.getByTestId("where-it-stands").innerText()).length > 20, true);
  c.is("and the Writer catches up", await until(overview, "account-written"), true);

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${BASE}/`);
    c.is(`Today fits at ${width}`, await fits(), true);
    await page.goto(overview);
    c.is(`the account fits at ${width}`, await fits(), true);
  }
} finally {
  db.close();
  await browser.close();
}
process.exit(c.done() ? 0 : 1);
