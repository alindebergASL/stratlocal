// The living account page (DECISIONS #100): the Overview says where the
// account stands, what changed since you last looked and what of it waits on
// you (the quick ones acceptable right there), what we know with its sources,
// and how often news is watched for. Five tabs; everything else under More.
import { join } from "node:path";
import Database from "better-sqlite3";
import { BASE, checker, launch, signIn } from "./browser.mjs";

const c = checker("living account page");
const db = new Database(process.env.E2E_DB_PATH);
const browser = await launch();
const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);
const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

try {
  await page.goto(`${BASE}/accounts`);
  const trigger = page.locator('[data-testid="account-new-open"]');
  if (await trigger.count()) await trigger.click();
  await page.fill('[data-testid="account-new"] [name="name"]', "Synthetic Living County");
  await page.click('[data-testid="account-new-submit"]');
  await page.waitForURL(/\/accounts\//, { timeout: 15000 });
  const accountId = page.url().split("/accounts/")[1].split(/[#/?]/)[0];
  const overview = `${BASE}/accounts/${accountId}`;
  await page.goto(`${overview}/import`);
  await page.setInputFiles('input[type="file"]', join(process.cwd(), "tests/fixtures/agent-report.md"));
  await page.getByTestId("import-submit").click();
  await page.waitForSelector("text=/proposed change/", { timeout: 60000 });

  // First visit: where it stands, and what waits, with the quick ones here.
  await page.goto(overview);
  c.is("the page says where the account stands", (await page.getByTestId("where-it-stands").innerText()).length > 20, true);
  c.is("five tabs", await page.locator('[data-testid="account-tabs"] ul li').count(), 5);
  const waiting = page.getByTestId("since-waiting");
  c.is("its waiting changes are on the page", (await waiting.innerText()).includes("waiting"), true);
  await waiting.getByTestId("inbox-accept-quick").click();
  await page.getByTestId("toast").waitFor({ timeout: 15000 });
  c.is("the quick ones are accepted from the account", true, true);

  // A later visit: what moved since is listed.
  await page.waitForFunction((id) => fetch(`/api/accounts/${id}/seen`, { method: "POST" }).then((r) => r.status === 204), accountId);
  db.prepare("UPDATE account_seen SET seen_at = seen_at - 3600000, before_at = NULL").run();
  await page.goto(`${overview}/review`);
  await page.getByTestId("change-card").waitFor();
  await page.keyboard.press("a");
  await page.getByTestId("toast").waitFor({ timeout: 15000 });
  await page.goto(overview);
  c.is("since you last looked lists what changed", await page.locator('[data-testid="since-changes"] li').count() >= 1, true);

  // What we know, and how often news is watched for.
  c.is("what we know is on the Overview", await page.locator("#research h2").innerText(), "What we know");
  await page.getByTestId("watch-pace-select").selectOption("1");
  await page.getByTestId("watch-pace").getByRole("status").waitFor({ timeout: 15000 });
  c.is("the account is watched daily", db.prepare("SELECT every_days FROM watched_accounts WHERE account_id = ?").get(accountId)?.every_days, 1);

  // More reaches the rest, and names the page you are on.
  await page.getByTestId("account-more-button").click();
  await page.getByTestId("account-more-research").click();
  await page.waitForURL(/\/research/);
  c.is("More leads to Research", await page.locator('[data-testid="account-tab-research"][aria-current="page"]').count(), 1);
  await page.getByTestId("account-tab-research").click();
  c.is("and the Do actions are there too", await page.getByTestId("handoff-link").isVisible(), true);

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(overview);
    c.is(`the Overview fits ${width}px`, await fits(), true);
    c.is(`More is on screen at ${width}px`, await page.getByTestId("account-more-button").isVisible(), true);
  }
} finally {
  await browser.close();
}
process.exit(c.done() ? 0 : 1);
