// Plan keeper asks; a person answers; the plan reads as a page.
//
// A play whose next step's date has passed becomes one question when Plan
// keeper runs. Today carries it, the check-in answers it with a new next step
// as an ordinary edit, and the account's plan page shows the play as it now
// stands.
import Database from "better-sqlite3";
import { BASE, checker, launch, signIn, openTab } from "./browser.mjs";

const c = checker("plan keeper");
const db = new Database(process.env.E2E_DB_PATH, { readonly: true });
const browser = await launch();
const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);
const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

try {
  const trigger = page.locator('[data-testid="account-new-open"]');
  if (await trigger.count()) await trigger.click();
  await page.fill('[data-testid="account-new"] [name="name"]', "Synthetic Juniper Lab");
  await page.click('[data-testid="account-new-submit"]');
  await page.waitForURL(/\/accounts\//, { timeout: 15000 });
  const accountUrl = page.url().split("#")[0].split("?")[0];

  await openTab(page, "plays");
  await page.getByTestId("play-new-open").click();
  await page.fill('[data-testid="play-new"] [name="title"]', "Synthetic depot electrification");
  await page.fill('[data-testid="play-new"] [name="next_step"]', "Book the sizing workshop");
  await page.fill('[data-testid="play-new"] [name="next_step_due"]', "2026-01-05");
  await page.getByTestId("play-new-submit").click();
  await page.getByTestId("play-scan-row").waitFor({ timeout: 15000 });
  const playId = db.prepare("SELECT id FROM plays WHERE title = ?").get("Synthetic depot electrification").id;

  await page.goto(`${BASE}/assistants`);
  await page.getByTestId("assistant-run-plan_keeper").click();
  await page.getByTestId("assistant-message-plan_keeper").waitFor();
  c.is("Run now asks one question", (await page.getByTestId("assistant-message-plan_keeper").innerText()).startsWith("1 new question about plays"), true);

  await page.goto(`${BASE}/`);
  const item = page.locator('[data-testid="today-item"]', { hasText: "question about the plan" });
  c.is("Today carries it", await item.count(), 1);
  await item.click();
  await page.waitForURL(/\/inbox\?kind=plan/);
  const card = page.getByTestId("plan-question");
  await card.waitFor();
  c.is("the card names the play and why", /Synthetic depot electrification[\s\S]*was due/.test(await card.innerText()), true);
  c.is("the check-in fits a phone", await (async () => { await page.setViewportSize({ width: 390, height: 900 }); return fits(); })(), true);
  await page.getByTestId("plan-set-step").click();
  await page.fill('[data-testid="plan-step"]', "Run the sizing workshop with operations");
  await page.getByRole("button", { name: /In two weeks/ }).click();
  await page.getByTestId("plan-step-save").click();
  await page.getByTestId("plan-questions-done").waitFor({ timeout: 15000 });
  const row = db.prepare("SELECT next_step, next_step_due FROM plays WHERE id = ?").get(playId);
  c.is("the answer is the play's next step", row.next_step, "Run the sizing workshop with operations");
  c.is("with a date ahead", row.next_step_due > "2026-01-05", true);
  c.is("as the person's own edit", db.prepare("SELECT COUNT(*) AS n FROM change_log WHERE entity_id = ? AND field = 'next_step' AND actor_user_id IS NOT NULL").get(playId).n >= 1, true);
  await page.reload();
  c.is("and it is not asked again", await page.getByTestId("plan-question").count(), 0);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${accountUrl}/plays`);
  await page.getByTestId("plan-page-link").click();
  await page.waitForURL(/\/plan$/);
  const plan = await page.getByTestId("plan-play").first().innerText();
  c.is("the plan page shows the play as it now stands", plan.includes("Run the sizing workshop with operations"), true);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    c.is(`the plan page fits ${width}px`, await fits(), true);
  }
} finally {
  db.close();
  await browser.close();
}
process.exit(c.done() ? 0 : 1);
