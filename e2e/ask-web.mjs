// Ask looks something up on the web (DECISIONS #101): the answer cites an
// unreviewed web finding, the same finding waits in the Inbox to be kept,
// and a question that names one of our deals is refused before it leaves.
import { BASE, checker, launch, signIn } from "./browser.mjs";

const c = checker("Ask looks it up on the web");
const browser = await launch();
const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);

async function ask(question) {
  const before = await page.getByTestId("ask-answer").count();
  await page.fill("#ask-question", question);
  await page.click('[data-testid="ask-submit"]');
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="ask-answer"]').length > n, before, { timeout: 60000 });
  return page.getByTestId("ask-answer").last().innerText();
}

try {
  await page.goto(`${BASE}/accounts`);
  const trigger = page.locator('[data-testid="account-new-open"]');
  if (await trigger.count()) await trigger.click();
  await page.fill('[data-testid="account-new"] [name="name"]', "Synthetic Webster Council");
  await page.click('[data-testid="account-new-submit"]');
  await page.waitForURL(/\/accounts\//, { timeout: 15000 });
  const accountId = page.url().split("/accounts/")[1].split(/[#/?]/)[0];
  await page.goto(`${BASE}/accounts/${accountId}/deals`);
  await page.click('[data-testid="deal-new-open"]');
  await page.fill('[data-testid="deal-new"] [name="name"]', "Synthetic Hidden Records Deal");
  await page.click('[data-testid="deal-new-submit"]');
  await page.waitForFunction(() => !document.querySelector('[data-testid="deal-new"]'), null, { timeout: 15000 });

  await page.goto(`${BASE}/accounts/${accountId}/ask`);
  // Our deal's name never leaves.
  await ask("Look up any news about the Synthetic Hidden Records Deal");
  c.is("a question naming our deal is not searched", (await page.getByTestId("ask-answered").last().textContent()).includes("Not searched"), true);

  const answer = await ask("Look up their recent announcements");
  c.is("the answer rests on a web finding", answer.length > 10, true);
  c.is("its source says it is unreviewed", (await page.getByTestId("ask-sources").last().textContent()).includes("not yet reviewed"), true);
  await page.goto(`${BASE}/inbox?kind=research`);
  c.is("the finding waits in the Inbox to keep", (await page.getByTestId("inbox-research").innerText()).includes("Synthetic Webster Council"), true);
} finally {
  await browser.close();
}
process.exit(c.done() ? 0 : 1);
