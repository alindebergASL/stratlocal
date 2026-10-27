// One Inbox: an imported report's changes are waiting there with a count in
// the navigation, the quick ones go in one press and come back with Undo, the
// rest are decided from the keyboard (and corrected first, when needed), an
// item can be put off until tomorrow, and it fits a phone.
import { join } from "node:path";
import { BASE, checker, launch, signIn } from "./browser.mjs";

const c = checker("one inbox");
const browser = await launch();
const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);
const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

try {
  await page.goto(`${BASE}/accounts`);
  const trigger = page.locator('[data-testid="account-new-open"]');
  if (await trigger.count()) await trigger.click();
  await page.fill('[data-testid="account-new"] [name="name"]', "Synthetic Inbox County");
  await page.click('[data-testid="account-new-submit"]');
  await page.waitForURL(/\/accounts\//, { timeout: 15000 });
  const accountId = page.url().split("/accounts/")[1].split(/[#/?]/)[0];
  await page.goto(`${BASE}/accounts/${accountId}/import`);
  await page.setInputFiles('input[type="file"]', join(process.cwd(), "tests/fixtures/agent-report.md"));
  await page.getByTestId("import-submit").click();
  await page.waitForSelector("text=/proposed change/", { timeout: 60000 });

  await page.goto(`${BASE}/inbox`);
  c.is("the navigation counts what waits", Number(await page.getByTestId("nav-badge-inbox").first().innerText()) > 0, true);
  const row = page.getByTestId("inbox-change-row").filter({ hasText: "Synthetic Inbox County" });
  c.is("the account's changes are waiting", await row.count(), 1);
  const before = await row.innerText();
  const quick = Number((before.match(/(\d+) quick to check/) ?? [])[1] ?? 0);
  c.is("some are quick to check", quick > 0, true);
  const quickGone = () => page.waitForFunction(() => ![...document.querySelectorAll('[data-testid="inbox-change-row"]')].some((r) => /Synthetic Inbox County[\s\S]*quick to check/.test(r.textContent ?? "")), null, { timeout: 15000 });
  await row.getByTestId("inbox-accept-quick").click();
  await quickGone();
  // Undo from the toast puts them back as undecided.
  await page.getByTestId("toast-undo").click();
  await page.waitForFunction((n) => [...document.querySelectorAll('[data-testid="inbox-change-row"]')].some((r) => new RegExp(`Synthetic Inbox County[\\s\\S]*${n} quick to check`).test(r.textContent ?? "")), quick, { timeout: 15000 });
  c.is("Undo brings the quick ones back", true, true);
  // From the keyboard: j to the row, a to accept its quick ones.
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  const rows = await page.locator("[data-inbox-row]").count();
  for (let i = 0; i < rows; i++) {
    await page.keyboard.press("j");
    if (await page.evaluate(() => /Synthetic Inbox County/.test(document.activeElement?.textContent ?? ""))) break;
  }
  await page.keyboard.press("a");
  await quickGone();
  c.is("the quick ones are accepted, the rest still wait", await page.getByTestId("inbox-change-row").filter({ hasText: "Synthetic Inbox County" }).count(), 1);
  await page.getByTestId("inbox-change-row").filter({ hasText: "Synthetic Inbox County" }).getByTestId("inbox-review").click();
  await page.waitForURL(/kind=changes&account=/, { timeout: 15000 });
  c.is("Review opens the account's changes in the Inbox", new URL(page.url()).searchParams.get("account"), accountId);

  // One card at a time, from the keyboard. A card with a value to correct is
  // edited first; the accepted card can be undone and comes back in front.
  await page.getByTestId("change-card").waitFor();
  const first = await page.getByTestId("change-card").locator("h3").innerText();
  await page.keyboard.press("a");
  await page.getByTestId("toast-undo").click();
  await page.waitForFunction((t) => document.querySelector('[data-testid="change-card"] h3')?.textContent === t, first, { timeout: 15000 });
  c.is("an undone card comes back to decide again", await page.getByTestId("change-card").locator("h3").innerText(), first);
  let edited = false;
  for (let i = 0; i < 40 && (await page.getByTestId("change-card").count()); i++) {
    if (await page.getByTestId("change-edit-open").count()) {
      await page.keyboard.press("e");
      const input = page.locator('[data-testid="change-edit"] input').first();
      const was = await input.inputValue();
      await input.fill(/^\d{4}-\d{2}-\d{2}$/.test(was) ? "2027-02-26" : /^[\d.]+$/.test(was) ? String(Number(was) + 1) : "Synthetic corrected value");
      await page.getByTestId("change-accept").click();
      await page.getByTestId("toast").waitFor();
      edited = true;
      break;
    }
    await page.keyboard.press("l");
  }
  c.is("a change can be corrected before it is accepted", edited, true);

  // Put off until tomorrow: gone from the list, listed under Put off, back on request.
  await page.goto(`${BASE}/inbox`);
  const mine = () => page.getByTestId("inbox-change-row").filter({ hasText: "Synthetic Inbox County" });
  if (await mine().count()) {
    await mine().getByTestId("inbox-snooze").locator("summary").click();
    await mine().getByTestId("inbox-snooze-tomorrow").click();
    await page.waitForFunction(() => ![...document.querySelectorAll('[data-testid="inbox-change-row"]')].some((r) => /Synthetic Inbox County/.test(r.textContent ?? "")), null, { timeout: 15000 });
    c.is("Later takes it out of the Inbox", await mine().count(), 0);
    await page.getByTestId("inbox-snoozed").locator("summary").click();
    await page.getByTestId("inbox-snoozed").getByTestId("inbox-wake").first().click();
    await mine().waitFor({ timeout: 15000 });
    c.is("and Bring back returns it", await mine().count(), 1);
  }

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${BASE}/inbox`);
    c.is(`the Inbox fits ${width}px`, await fits(), true);
  }
} finally {
  await browser.close();
}
process.exit(c.done() ? 0 : 1);
