// Fewer places (DECISIONS #105): every old address lands where its work now
// is, an account's plan is one tab with its own tabs, and none of it scrolls
// sideways on a phone.
import { BASE, checker, launch, signIn } from "./browser.mjs";

const c = checker("fewer places, each complete");
const browser = await launch();
const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);
const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

try {
  await page.goto(`${BASE}/accounts`);
  const trigger = page.locator('[data-testid="account-new-open"]');
  if (await trigger.count()) await trigger.click();
  await page.fill('[data-testid="account-new"] [name="name"]', "Synthetic Tidy Borough");
  await page.click('[data-testid="account-new-submit"]');
  await page.waitForURL(/\/accounts\//, { timeout: 15000 });
  const accountId = page.url().split("/accounts/")[1].split(/[#/?]/)[0];

  for (const [from, check] of [
    ["/plans", (u) => u.pathname === "/inbox" && u.searchParams.get("kind") === "plan"],
    ["/promises", (u) => u.pathname === "/inbox" && u.searchParams.get("kind") === "promise"],
    ["/close", (u) => u.pathname === "/" && u.searchParams.get("view") === "close"],
    [`/accounts/${accountId}/review`, (u) => u.pathname === "/inbox" && u.searchParams.get("account") === accountId],
  ]) {
    await page.goto(`${BASE}${from}`);
    c.is(`${from.replace(accountId, ":id")} lands on its new place`, check(new URL(page.url())), true);
  }
  await page.goto(`${BASE}/close`);
  c.is("Close the day is on Today", (await page.locator("h1").first().innerText()).includes("Close the day"), true);

  // One Plan tab.
  await page.goto(`${BASE}/accounts/${accountId}/plays`);
  c.is("the Plan tab has its own tabs", await page.getByTestId("plan-tabs").count(), 1);
  c.is("the playbook is not under More", await page.getByTestId("account-more-playbook").count(), 0);
  await page.getByTestId("plan-page-link").click();
  await page.waitForURL(/\/plan$/);
  c.is("the plan reads as a document", new URL(page.url()).pathname, `/accounts/${accountId}/plan`);

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of ["/?view=close", `/inbox?kind=changes&account=${accountId}`, `/accounts/${accountId}/plays`]) {
      await page.goto(`${BASE}${path}`);
      c.is(`${path.replace(accountId, ":id")} fits ${width}px`, await fits(), true);
    }
  }
} finally {
  await browser.close();
}
process.exit(c.done() ? 0 : 1);
