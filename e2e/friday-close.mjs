// Friday review and Close the day, from the browser, under AI_FAKE.
// SYNTHETIC ONLY.
//
// What it proves is what a library test cannot: that Run now on the
// Assistants page writes the review, that Today carries it until it is
// opened, and that it reads at a phone's width.
import { BASE, checker, launch, signIn } from "./browser.mjs";

const c = checker("friday review and close the day");
const browser = await launch();
const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);
const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

try {
  await page.goto(`${BASE}/accounts`);
  const trigger = page.locator('[data-testid="account-new-open"]');
  if (await trigger.count()) await trigger.click();
  await page.fill('[data-testid="account-new"] [name="name"]', "Synthetic Larkspur Freight");
  await page.click('[data-testid="account-new-submit"]');
  await page.waitForURL(/\/accounts\/[^/]+$/, { timeout: 15000 });
  const accountUrl = page.url().split(/[?#]/)[0];
  await page.goto(`${accountUrl}/deals`);
  await page.click('[data-testid="deal-new-open"]');
  await page.fill('[data-testid="deal-new"] [name="name"]', "Synthetic Larkspur depot");
  await page.fill('[data-testid="deal-new"] [name="tcv_usd"]', "420k");
  await page.fill('[data-testid="deal-new"] [name="close_date"]', "2026-01-15");
  await page.click('[data-testid="deal-new-submit"]');
  await page.locator('#deals a[href*="/deals/"]').filter({ hasText: "Synthetic Larkspur depot" }).first().waitFor({ timeout: 15000 });

  // Friday review, pressed.
  await page.goto(`${BASE}/assistants`);
  await page.getByTestId("assistant-run-friday_review").click();
  await page.getByTestId("assistant-message-friday_review").waitFor({ timeout: 15000 });
  c.is("Run now starts the review", /^Writing 1 review/.test(await page.getByTestId("assistant-message-friday_review").innerText()), true);

  const item = page.locator('[data-testid="today-item"]', { hasText: "Friday review" });
  let seen = false;
  for (let i = 0; i < 10 && !seen; i++) {
    await page.goto(`${BASE}/`);
    seen = (await item.count()) === 1;
    if (!seen) await page.waitForTimeout(1000);
  }
  c.is("Today carries it", seen, true);
  await item.click();
  await page.waitForURL(/\/reports\//);
  const report = await page.getByTestId("report").innerText();
  c.is("the review is a report with its sections", /Needs a look[\s\S]*For your manager/.test(report), true);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    c.is(`it fits ${width}px`, await fits(), true);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${BASE}/`);
  c.is("and once opened it leaves Today", await item.count(), 0);

  // Close the day: a late follow-up given a day, the note drafted and sent.
  await page.goto(`${accountUrl}/follow-ups`);
  await page.click('[data-testid="follow-up-add"]');
  await page.fill('[data-testid="follow-up-form"] [name="text"]', "Synthetic Larkspur rate card");
  await page.fill('[data-testid="follow-up-form"] [name="due"]', "2026-01-05");
  await page.click('[data-testid="follow-up-save"]');
  await page.waitForTimeout(1500);
  await page.goto(`${BASE}/close`);
  c.is("it opens on what you did", (await page.getByTestId("close-did").innerText()).includes("Synthetic Larkspur depot"), true);
  const loose = page.getByTestId("close-loose").locator("li", { hasText: "Synthetic Larkspur rate card" });
  c.is("the late follow-up is a loose end", await loose.count(), 1);
  await loose.getByTestId("close-give-a-day").click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="close-loose"]')?.textContent?.includes("Synthetic Larkspur rate card"), null, { timeout: 10000 });
  c.is("given a day, it is no longer loose", true, true);
  await page.getByTestId("close-draft").click();
  await page.getByTestId("close-note").waitFor({ timeout: 20000 });
  await page.getByTestId("close-send").click();
  await page.waitForFunction(() => /Today$/.test(document.querySelector('[data-testid="close-send"]')?.textContent ?? ""), null, { timeout: 10000 });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    c.is(`Close the day fits ${width}px`, await fits(), true);
  }
  const jamie = await signIn(browser, process.env.E2E_USER2_EMAIL, process.env.E2E_USER2_PASSWORD);
  const note = jamie.locator('[data-testid="today-item"]', { hasText: "closed the day" });
  c.is("the note is on the partner's Today", await note.count(), 1);
  await note.click();
  await jamie.waitForURL(/\/ask\//);
  c.is("and opens as the conversation, with sources", await jamie.getByTestId("ask-sources").count(), 1);

  // A template on a schedule, run from the Assistants page.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${BASE}/reports`);
  await page.click('[data-testid="schedule-form-weekly_pipeline-open"]');
  await page.click('[data-testid="schedule-form-weekly_pipeline-submit"]');
  await page.waitForFunction(() => /Mondays at 07:00 for Alex/.test(document.querySelector('[data-testid="schedule-weekly_pipeline"]')?.textContent ?? ""), null, { timeout: 10000 });
  c.is("a template can be put on a schedule", true, true);
  await page.goto(`${BASE}/assistants`);
  await page.click('[data-testid="assistant-mode-scheduled_reports-ask"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="assistant-mode-scheduled_reports-ask"]')?.getAttribute("aria-checked") === "true", null, { timeout: 10000 });
  await page.getByTestId("assistant-run-scheduled_reports").click();
  await page.waitForFunction(() => /report/i.test(document.querySelector('[data-testid="assistant-message-scheduled_reports"]')?.textContent ?? ""), null, { timeout: 15000 });
  c.is("Run now runs the scheduled templates", /^Writing 1 report/.test(await page.getByTestId("assistant-message-scheduled_reports").innerText()), true);
  const ready = page.locator('[data-testid="today-item"]', { hasText: "Weekly pipeline review is ready" });
  let there = false;
  for (let i = 0; i < 10 && !there; i++) {
    await page.goto(`${BASE}/`);
    there = (await ready.count()) === 1;
    if (!there) await page.waitForTimeout(1000);
  }
  c.is("and the report is on Today", there, true);
} finally {
  await browser.close();
}
process.exit(c.done() ? 0 : 1);
