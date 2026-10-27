// Our work first: Today's "This week", the account's "Our work", a page for
// each person and the team page, at desktop and phone widths.
import { BASE, checker, launch, signIn } from "./browser.mjs";

const c = checker("our work, people and the team");
const browser = await launch();
const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);
const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

try {
  await page.goto(`${BASE}/accounts`);
  const trigger = page.locator('[data-testid="account-new-open"]');
  if (await trigger.count()) await trigger.click();
  await page.fill('[data-testid="account-new"] [name="name"]', "Synthetic Our Work County");
  await page.click('[data-testid="account-new-submit"]');
  await page.waitForURL(/\/accounts\//, { timeout: 15000 });
  const accountId = page.url().split("/accounts/")[1].split(/[#/?]/)[0];

  // Something done: a follow-up written and closed.
  await page.goto(`${BASE}/accounts/${accountId}/follow-ups`);
  const add = page.getByTestId("follow-up-add");
  if (await add.count()) await add.first().click();
  await page.fill('[data-testid="follow-up-form"] [name="text"]', "Synthetic call the director back");
  await page.click('[data-testid="follow-up-save"]');
  await page.getByText("Synthetic call the director back").first().waitFor({ timeout: 15000 });
  await page.getByRole("checkbox").first().check();
  await page.waitForTimeout(1500);

  await page.goto(`${BASE}/`);
  const strip = page.getByTestId("week-strip");
  await strip.waitFor({ timeout: 15000 });
  c.is("Today shows this week, me first", (await strip.getByTestId("week-person").first().innerText()).startsWith("You"), true);
  c.is("with what I closed", (await strip.getByTestId("week-counts").first().innerText()).includes("follow-up"), true);

  await page.goto(`${BASE}/accounts/${accountId}`);
  c.is("the account leads with our work", (await page.locator("#our-work").innerText()).includes("You"), true);

  await page.goto(`${BASE}/`);
  await page.getByTestId("week-person").first().getByRole("link").click();
  await page.waitForURL(/\/team\//, { timeout: 15000 });
  c.is("my name opens my page", (await page.getByTestId("person-week").innerText()).includes("This week"), true);

  await page.goto(`${BASE}/team`);
  c.is("the team page has a card per person", (await page.getByTestId("team-person").count()) >= 2, true);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of ["/team", page.url().replace(BASE, "")]) {
      await page.goto(`${BASE}${path}`);
      c.is(`${path.split("?")[0]} fits ${width}px`, await fits(), true);
    }
    await page.goto(`${BASE}/`);
    c.is(`Today with this week fits ${width}px`, await fits(), true);
  }
} finally {
  await browser.close();
}
process.exit(c.done() ? 0 : 1);
