// Email becomes changes (DECISIONS #102): a person connects their mailbox
// (synthetic here, MAIL_FAKE=1), reads it, and what a customer agreed by
// email waits in the Inbox, quoted "From the email", never quick to accept.
// A hostile email in the same thread moves no stage, status or amount, and
// a newsletter is never kept. The account lists the email it kept.
import Database from "better-sqlite3";
import { BASE, checker, launch, signIn } from "./browser.mjs";

const c = checker("email becomes changes");
const db = new Database(process.env.E2E_DB_PATH);
const browser = await launch();
const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);
const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

try {
  await page.goto(`${BASE}/accounts`);
  const trigger = page.locator('[data-testid="account-new-open"]');
  if (await trigger.count()) await trigger.click();
  await page.fill('[data-testid="account-new"] [name="name"]', "Synthetic Mailbridge Trust");
  await page.click('[data-testid="account-new-submit"]');
  await page.waitForURL(/\/accounts\//, { timeout: 15000 });
  const accountId = page.url().split("/accounts/")[1].split(/[#/?]/)[0];
  await page.goto(`${BASE}/accounts/${accountId}/deals`);
  await page.click('[data-testid="deal-new-open"]');
  await page.fill('[data-testid="deal-new"] [name="name"]', "Synthetic Mailbridge platform");
  await page.click('[data-testid="deal-new-submit"]');
  await page.waitForFunction(() => !document.querySelector('[data-testid="deal-new"]'), null, { timeout: 15000 });
  await page.goto(`${BASE}/accounts/${accountId}/people`);
  await page.getByTestId("contact-new-open").click();
  await page.fill('[data-testid="contact-new"] [name="name"]', "Morgan Example");
  await page.fill('[data-testid="contact-new"] [name="email"]', "morgan@mailbridge.example");
  await page.getByTestId("contact-new-submit").click();
  await page.waitForFunction(() => document.body.innerText.includes("Morgan Example"), null, { timeout: 15000 });
  const before = db.prepare("SELECT stage, status, tcv_usd FROM deals WHERE account_id = ?").get(accountId);

  // Connect and read.
  await page.goto(`${BASE}/settings/connections`);
  c.is("email starts off", await page.getByTestId("mail-state").innerText(), "Off");
  await page.getByTestId("mail-connect-open").click();
  await page.getByTestId("mail-kind").selectOption("fake");
  await page.getByTestId("mail-connect-submit").click();
  await page.getByTestId("mail-connected").waitFor({ timeout: 15000 });
  await page.getByTestId("mail-read-now").click();
  await page.getByRole("status").filter({ hasText: "kept" }).waitFor({ timeout: 15000 });
  c.is("a newsletter is never kept", db.prepare("SELECT COUNT(*) AS n FROM mail_messages WHERE from_addr LIKE '%newsletter%'").get().n, 0);
  for (let i = 0; i < 50 && db.prepare("SELECT COUNT(*) AS n FROM ai_runs WHERE kind = 'mail_extract' AND status = 'running'").get().n > 0; i++) await page.waitForTimeout(200);

  // What was agreed waits in the Inbox, never quick.
  await page.goto(`${BASE}/inbox`);
  const row = page.getByTestId("inbox-change-row").filter({ hasText: "Synthetic Mailbridge Trust" });
  c.is("the email's changes wait in the Inbox", (await row.innerText()).includes("email"), true);
  c.is("and none is quick to accept", await row.getByTestId("inbox-accept-quick").count(), 0);
  await row.getByTestId("inbox-review").click();
  await page.getByTestId("change-card").waitFor();
  c.is("a change says it is from the email, quoted", (await page.locator("body").innerText()).includes("From the email"), true);

  // Nothing moved that an email may not move.
  c.is("the hostile email moved no stage, status or amount", JSON.stringify(db.prepare("SELECT stage, status, tcv_usd FROM deals WHERE account_id = ?").get(accountId)), JSON.stringify(before));
  const forbidden = db.prepare("SELECT payload_json FROM proposals WHERE account_id = ? AND origin_id LIKE 'mail:%' AND entity_type = 'deal'").all(accountId).map((r) => Object.keys(JSON.parse(r.payload_json)));
  c.is("an email proposes a deal's next step at most", forbidden.every((keys) => keys.length === 1 && keys[0] === "next_step"), true);

  // The account lists what it kept.
  await page.goto(`${BASE}/accounts/${accountId}/email`);
  c.is("the account lists its email", await page.locator('[data-testid="account-mail"] li').count() >= 2, true);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of [`/accounts/${accountId}/email`, "/settings/connections"]) {
      await page.goto(`${BASE}${path}`);
      c.is(`${path.split("/").pop()} fits ${width}px`, await fits(), true);
    }
  }
} finally {
  await browser.close();
}
process.exit(c.done() ? 0 : 1);
