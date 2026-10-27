// Account watch: chosen per account, run on request, reviewed like any note.
//
// The account is watched from its research page, Run now on the Assistants
// page starts one look (AI_FAKE replay), the note it leaves says it came from
// the watch and marks each finding against the plays, Today carries it as one
// item, and keeping it clears Today.
import Database from "better-sqlite3";
import { BASE, checker, launch, signIn } from "./browser.mjs";

const c = checker("account watch");
const db = new Database(process.env.E2E_DB_PATH, { readonly: true });
const browser = await launch();
const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);

try {
  const trigger = page.locator('[data-testid="account-new-open"]');
  if (await trigger.count()) await trigger.click();
  await page.fill('[data-testid="account-new"] [name="name"]', "Synthetic Juniper Lab");
  await page.click('[data-testid="account-new-submit"]');
  await page.waitForURL(/\/accounts\//, { timeout: 15000 });
  const accountUrl = page.url().split("#")[0].split("?")[0];
  const accountId = accountUrl.split("/").pop();

  await page.goto(`${accountUrl}/research`);
  await page.getByTestId("watch-toggle-button").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="watch-toggle-button"]')?.textContent === "Stop watching", null, { timeout: 15000 });
  c.is("watched from its research page", db.prepare("SELECT COUNT(*) AS n FROM watched_accounts WHERE account_id = ?").get(accountId).n, 1);

  await page.goto(`${BASE}/assistants`);
  c.is("the watch list shows it", (await page.getByTestId("watch-list").innerText()).includes("Synthetic Juniper Lab"), true);
  c.is("with what a month would cost", (await page.getByTestId("watch-estimate").innerText()).includes("a month for 1"), true);
  await page.getByTestId("assistant-run-account_watch").click();
  await page.getByTestId("assistant-message-account_watch").waitFor();
  c.is("Run now starts one look", (await page.getByTestId("assistant-message-account_watch").innerText()).includes("Looking for news about Synthetic Juniper Lab"), true);
  for (let i = 0; i < 60 && db.prepare("SELECT COUNT(*) AS n FROM ai_runs WHERE status = 'running'").get().n > 0; i++) await page.waitForTimeout(500);
  const run = db.prepare("SELECT assistant, status FROM ai_runs WHERE account_id = ? AND kind = 'research'").get(accountId);
  c.is("paid from Account watch's own budget", `${run?.assistant}/${run?.status}`, "account_watch/done");

  await page.goto(`${BASE}/`);
  const item = page.locator('[data-testid="today-item"]', { hasText: "to keep or drop" });
  c.is("Today carries the news as one item", await item.count(), 1);
  await item.click();
  await page.waitForURL(/\/research/);
  await page.getByTestId("watch-intro").waitFor();
  c.is("the note says it came from the watch", (await page.getByTestId("watch-intro").innerText()).startsWith("Account watch found"), true);
  c.is("each finding is marked against the plays", await page.getByTestId("finding-touch").count(), await page.getByTestId("keep-finding").count());
  // A difference, not a fresh note: what matters first, each with why.
  const changes = await page.getByTestId("watch-changes").innerText();
  c.is("it leads with what changed, most important first, with why", /most important first/.test(changes) && /\(.*compelling event.*\)/.test(changes), true);
  await page.getByTestId("select-all").click();
  await page.getByTestId("note-accept").click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="watch-intro"]'), null, { timeout: 15000 });
  await page.goto(`${BASE}/`);
  c.is("kept, it leaves Today", await page.locator('[data-testid="today-item"]', { hasText: "to keep or drop" }).count(), 0);

  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`${BASE}/assistants`);
  c.is("the assistants page still fits a phone", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
} finally {
  db.close();
  await browser.close();
}
process.exit(c.done() ? 0 : 1);
