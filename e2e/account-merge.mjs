// Two account records for one customer, made one from the browser, and taken
// apart again. SYNTHETIC ONLY.
//
// What it proves is what a library test cannot: that the control is where a
// person would look (the account's Details), that it says what it will do
// before the press, that the merged-away account's links land on the kept
// one, and that Undo puts the records back.
import { BASE, checker, launch, signIn, openTab } from "./browser.mjs";

const browser = await launch();
const c = checker("two accounts for one customer");
const alex = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);

async function newAccount(name) {
  await alex.goto(`${BASE}/accounts`);
  const trigger = alex.locator('[data-testid="account-new-open"]');
  if (await trigger.count()) await trigger.click();
  await alex.fill('[data-testid="account-new"] [name="name"]', name);
  await alex.click('[data-testid="account-new-submit"]');
  await alex.waitForURL(/\/accounts\/[^/]+$/, { timeout: 15000 });
  return alex.url();
}

const keepUrl = await newAccount("Synthetic Harbour Systems");
const loseUrl = await newAccount("Synthetic Harbour Systems Ltd");
await openTab(alex, "deals");
await alex.click('[data-testid="deal-new-open"]');
await alex.fill('[data-testid="deal-new"] [name="name"]', "Synthetic harbour expansion");
await alex.fill('[data-testid="deal-new"] [name="tcv_usd"]', "750k");
await alex.click('[data-testid="deal-new-submit"]');
await alex.waitForTimeout(1200);

// Preview first: nothing changes by choosing.
await alex.goto(`${keepUrl}/details`);
await alex.selectOption('select[name="merge"]', { label: "Synthetic Harbour Systems Ltd" });
await alex.click('[data-testid="account-merge-preview"]');
await alex.getByTestId("account-merge-plan").waitFor();
const plan = await alex.getByTestId("account-merge-plan").innerText();
c.is("the preview says what moves", /Moves 1 deal/.test(plan), true);
await alex.goto(`${keepUrl}/deals`);
c.is("and nothing moved yet", (await alex.innerText("#deals")).includes("Synthetic harbour expansion"), false);

// The merge.
await alex.goto(`${keepUrl}/details?merge=${loseUrl.split("/accounts/")[1]}`);
await alex.click('[data-testid="account-merge-open"]');
await alex.click('[data-testid="account-merge-submit"]');
await alex.waitForURL(/\/details/, { timeout: 15000 });
await alex.goto(`${keepUrl}/deals`);
c.is("the deal is on the kept account", (await alex.innerText("#deals")).includes("Synthetic harbour expansion"), true);
await alex.goto(loseUrl);
c.is("the merged-away account's link lands on the kept one", alex.url().split("?")[0], keepUrl);
await alex.goto(`${BASE}/accounts`);
c.is("and it is not listed on its own", (await alex.innerText("body")).includes("Synthetic Harbour Systems Ltd"), false);

// Undo.
await alex.goto(`${keepUrl}/details`);
const row = alex.locator('[data-testid="merge-list"] > li', { hasText: "Synthetic Harbour Systems Ltd" }).first();
await row.locator('[data-testid="unmerge-open"]').click();
c.is("the undo says what comes back", /comes back as its own account/.test(await row.innerText()), true);
await row.locator('[data-testid="unmerge-submit"]').click();
await alex.waitForTimeout(1500);
await alex.goto(`${loseUrl}/deals`);
c.is("after undo the account is its own again", alex.url().split("?")[0], `${loseUrl}/deals`);
c.is("with its deal back", (await alex.innerText("#deals")).includes("Synthetic harbour expansion"), true);

await browser.close();
process.exit(c.done() ? 0 : 1);
