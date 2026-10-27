// The account report in a format other than HTML, and a customer document
// kept as context: listed on Research, readable, and cited by a brief.
import { join } from "node:path";
import { BASE, checker, launch, reviewAsList, signIn } from "./browser.mjs";

const c = checker("imports");
const browser = await launch();
const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);

try {
  await page.goto(`${BASE}/accounts`);
  const trigger = page.locator('[data-testid="account-new-open"]');
  if (await trigger.count()) await trigger.click();
  await page.fill('[data-testid="account-new"] [name="name"]', "Synthetic Imports County");
  await page.click('[data-testid="account-new-submit"]');
  await page.waitForURL(/\/accounts\//, { timeout: 15000 });
  const accountId = page.url().split("/accounts/")[1].split(/[#/?]/)[0];

  // A Markdown report is read like the HTML one.
  await page.goto(`${BASE}/accounts/${accountId}/import`);
  await page.setInputFiles('input[type="file"]', join(process.cwd(), "tests/fixtures/agent-report.md"));
  await page.getByTestId("import-submit").click();
  await page.waitForSelector("text=/proposed change/", { timeout: 60000 });
  c.is("a Markdown report becomes proposals", await page.getByRole("link", { name: "Review them" }).count(), 1);
  await page.goto(`${BASE}/accounts/${accountId}/review`);
  await reviewAsList(page);
  await page.click('[data-testid="accept-all"]');
  await page.waitForSelector("text=/applied/", { timeout: 30000 });

  // A customer document is kept, not extracted.
  await page.goto(`${BASE}/accounts/${accountId}/import`);
  await page.getByTestId("import-purpose-customer").check();
  await page.setInputFiles('input[type="file"]', join(process.cwd(), "tests/fixtures/customer-plan.md"));
  await page.getByTestId("import-submit").click();
  await page.getByTestId("import-kept").waitFor({ timeout: 15000 });
  c.is("the customer document is kept", (await page.getByTestId("import-kept").innerText()).includes("Kept"), true);
  await page.goto(`${BASE}/accounts/${accountId}/research?view=documents`);
  c.is("and listed on Research", (await page.getByTestId("customer-doc").first().innerText()).trim(), "customer-plan.md");
  await page.getByTestId("customer-doc").first().click();
  await page.getByTestId("customer-doc-text").waitFor({ timeout: 15000 });
  c.is("its text can be read", (await page.getByTestId("customer-doc-text").innerText()).includes("Consolidate three synthetic data centres"), true);

  // A brief reads it and cites it.
  await page.goto(`${BASE}/accounts/${accountId}/meetings`);
  await page.click('[data-testid="meeting-new-open"]');
  await page.fill('[data-testid="meeting-new"] [name="title"]', "Synthetic planning review");
  await page.fill('[data-testid="meeting-new"] [name="held_at"]', "2027-01-15");
  await page.click('[data-testid="meeting-new-submit"]');
  await page.waitForURL(/\/meetings\//, { timeout: 15000 });
  await page.getByRole("button", { name: "Prepare this meeting", exact: true }).click();
  await page.waitForSelector('[data-testid="brief-conversation"]', { timeout: 60000 });
  const cite = page.locator(`[data-testid="brief-ref"][href*="/documents/"]`).first();
  c.is("the brief cites their document", await cite.count(), 1);
  await cite.click();
  await page.getByTestId("customer-doc-text").waitFor({ timeout: 15000 });
  c.is("and the citation opens it", page.url().includes(`/accounts/${accountId}/documents/`), true);
} finally {
  await browser.close();
}
process.exit(c.done() ? 0 : 1);
