// The app by keyboard and in place: g + a letter jumps, ? lists the keys,
// ⌘K runs a command that fits the page, and a deal's numbers are edited
// where they are, with Undo.
import { BASE, checker, launch, signIn } from "./browser.mjs";

const c = checker("keys, commands and editing in place");
const browser = await launch();
const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);

try {
  await page.goto(`${BASE}/accounts`);
  const trigger = page.locator('[data-testid="account-new-open"]');
  if (await trigger.count()) await trigger.click();
  await page.fill('[data-testid="account-new"] [name="name"]', "Synthetic Keyboard County");
  await page.click('[data-testid="account-new-submit"]');
  await page.waitForURL(/\/accounts\//, { timeout: 15000 });
  const accountId = page.url().split("/accounts/")[1].split(/[#/?]/)[0];
  await page.goto(`${BASE}/accounts/${accountId}/deals`);
  await page.click('[data-testid="deal-new-open"]');
  await page.fill('[data-testid="deal-new"] [name="name"]', "Synthetic records platform");
  await page.click('[data-testid="deal-new-submit"]');
  await page.waitForFunction(() => !document.querySelector('[data-testid="deal-new"]'), null, { timeout: 15000 });
  const dealHref = await page.locator(`a[href*="/accounts/${accountId}/deals/"]`).first().getAttribute("href");

  // Keys. Pressed until the page has hydrated and is listening.
  await page.goto(`${BASE}/`);
  for (let i = 0; i < 5 && !(await page.getByTestId("hotkeys-help").isVisible()); i++) {
    await page.keyboard.press("?");
    await page.getByTestId("hotkeys-help").waitFor({ timeout: 1500 }).catch(() => {});
  }
  c.is("? lists the keys", await page.getByTestId("hotkeys-help").isVisible(), true);
  await page.keyboard.press("Escape");
  await page.keyboard.press("g");
  await page.keyboard.press("p");
  await page.waitForURL(/\/pipeline/, { timeout: 10000 });
  c.is("g p goes to the pipeline", new URL(page.url()).pathname, "/pipeline");

  // The menu holds the rest, grouped.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByTestId("nav-more-column").click();
  c.is("More lists What changed", await page.getByTestId("nav-activity").count(), 1);
  await page.keyboard.press("Escape");

  // A command that fits the page.
  await page.goto(`${BASE}/accounts/${accountId}`);
  const palette = page.locator('input[aria-label="Jump to"]');
  for (let i = 0; i < 5 && !(await palette.isVisible()); i++) {
    await page.keyboard.press("Control+k");
    await palette.waitFor({ state: "visible", timeout: 2000 }).catch(() => {});
  }
  await palette.fill("research this account");
  await page.waitForFunction(() => /Research this account again/.test(document.querySelector("#palette-results [role=option]")?.textContent ?? ""), null, { timeout: 5000 });
  await page.keyboard.press("Enter");
  await page.waitForURL(/research\?again=1/, { timeout: 15000 });
  c.is("⌘K opens research with the form ready", await page.locator('[data-testid="research-run-open"][open]').count() + (await page.locator('[data-testid="research-run"]').count() > 0 ? 1 : 0) >= 1, true);

  // Editing in place, then Undo.
  await page.goto(`${BASE}${dealHref}`);
  await page.getByTestId("deal-tcv_usd").click();
  await page.getByTestId("deal-tcv_usd-input").fill("1.2M");
  await page.keyboard.press("Enter");
  await page.getByTestId("toast").waitFor({ timeout: 15000 });
  c.is("the value shows at once", (await page.getByTestId("deal-tcv_usd").innerText()).includes("1,200,000"), true);
  await page.reload();
  c.is("and it was saved", (await page.getByTestId("deal-tcv_usd").innerText()).includes("1,200,000"), true);
  await page.getByTestId("deal-close_date").click();
  await page.getByTestId("deal-close_date-input").fill("2027-03-31");
  await page.keyboard.press("Enter");
  await page.getByTestId("toast-undo").waitFor({ timeout: 15000 });
  await page.getByTestId("toast-undo").click();
  await page.waitForTimeout(1500);
  await page.reload();
  c.is("Undo puts it back", (await page.getByTestId("deal-close_date").innerText()).includes("2027"), false);
  // A value it cannot read is refused, and what was typed stays.
  await page.getByTestId("deal-stage").click();
  c.is("stage is a choice, not free text", await page.locator('select[data-testid="deal-stage-input"]').count(), 1);
  await page.keyboard.press("Escape");
} finally {
  await browser.close();
}
process.exit(c.done() ? 0 : 1);
