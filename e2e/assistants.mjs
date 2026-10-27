// Assistants that start on their own, and what they leave for you.
//
// A customer promise written down with no date becomes one question, asked
// once; answering it dates the follow-up as your own edit. The Assistants page
// switches an assistant, refuses a budget that does not fit, and shows the
// scheduler checking in once the loop knocks with the secret.
import Database from "better-sqlite3";
import { BASE, checker, launch, signIn, openTab } from "./browser.mjs";

const browser = await launch();
const c = checker("assistants");
const db = new Database(process.env.E2E_DB_PATH, { readonly: true });
const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);
const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

try {
  const trigger = page.locator('[data-testid="account-new-open"]');
  if (await trigger.count()) await trigger.click();
  await page.fill('[data-testid="account-new"] [name="name"]', "Synthetic Juniper Lab");
  await page.click('[data-testid="account-new-submit"]');
  await page.waitForURL(/\/accounts\//, { timeout: 15000 });

  // The customer promised something, with no date.
  await openTab(page, "follow-ups");
  await page.click('[data-testid="follow-up-add"]');
  await page.fill('[data-testid="follow-up-form"] [name="text"]', "Share the synthetic fleet numbers");
  await page.locator('[data-testid="follow-up-owner"]').selectOption("theirs");
  await page.fill('[data-testid="follow-up-their-name"]', "Finley Example");
  await page.click('[data-testid="follow-up-save"]');
  await page.waitForFunction(() => !document.querySelector('[data-testid="follow-up-form"]'), null, { timeout: 15000 });
  const item = db.prepare("SELECT id, owner, owner_user_id, due FROM action_items WHERE text = ?").get("Share the synthetic fleet numbers");
  c.is("the follow-up is the customer's, by name", [item?.owner, item?.owner_user_id, item?.due].join("|"), "Finley Example||");

  await page.goto(`${BASE}/assistants`);
  c.is("the scheduler says it has not checked in", (await page.getByTestId("scheduler-status").innerText()).includes("has not checked in yet"), true);
  await page.getByTestId("assistant-run-promise_keeper").click();
  await page.getByTestId("assistant-message-promise_keeper").waitFor();
  c.is("Run now reports what it found", (await page.getByTestId("assistant-message-promise_keeper").innerText()).includes("1 new"), true);

  // Today carries it as one question, and says what the assistant did.
  await page.goto(`${BASE}/`);
  const question = page.locator('[data-testid="today-item"]', { hasText: "customer promise with no date" });
  c.is("Today asks one question", await question.count(), 1);
  c.is("Today says what the assistants did", (await page.getByTestId("today-assistants").innerText()).includes("Promise keeper left 1 reminder"), true);
  await question.click();
  await page.waitForURL(/\/inbox\?kind=promise/);
  await page.getByTestId("promise-question").waitFor();
  c.is("the question names who promised", (await page.getByTestId("promise-question").innerText()).includes("Finley Example"), true);
  c.is("the promises page fits a phone", await (async () => { await page.setViewportSize({ width: 390, height: 900 }); return fits(); })(), true);
  await page.getByTestId("promise-pick").first().click();
  await page.getByTestId("promise-questions-done").waitFor();
  const dated = db.prepare("SELECT due FROM action_items WHERE id = ?").get(item.id);
  c.is("answering dates the follow-up", typeof dated.due === "string" && dated.due.length === 10, true);
  c.is("as your own edit", db.prepare("SELECT COUNT(*) AS n FROM change_log WHERE entity_id = ? AND field = 'due' AND actor_user_id IS NOT NULL").get(item.id).n, 1);
  await page.reload();
  c.is("and it is not asked again", await page.getByTestId("promise-question").count(), 0);

  // Switch Meeting prep to run on its own.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/assistants`);
  await page.getByTestId("assistant-mode-meeting_prep-auto").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="assistant-message-meeting_prep"]')?.textContent === "Saved.");
  c.is("the mode is stored", db.prepare("SELECT mode FROM assistant_settings WHERE assistant = 'meeting_prep'").get()?.mode, "auto");
  await page.locator("#budget li", { hasText: "Meeting prep" }).waitFor();
  const legend = await page.locator("#budget li", { hasText: "Meeting prep" }).innerText();
  c.is("its reservation shows in the budget", /\$0\.00\s+of\s+\$20\.00/.test(legend) ? true : legend, true);

  // A budget that does not fit is refused, with the reason.
  await page.getByTestId("budget-edit-open").click();
  await page.fill('[data-testid="budget-edit"] [name="total"]', "50");
  await page.fill('[data-testid="budget-edit"] [name="share"]', "40");
  await page.getByTestId("budget-edit-submit").click();
  await page.getByRole("alert").filter({ hasText: "does not fit" }).waitFor();
  c.is("nothing was saved", db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key = 'ai_monthly_total_cents'").get().n, 0);

  // The loop knocks; the page notices.
  const denied = await fetch(`${BASE}/api/internal/tick`, { method: "POST", headers: { authorization: "Bearer wrong" } });
  c.is("a wrong secret is refused", denied.status, 403);
  const ok = await fetch(`${BASE}/api/internal/tick`, { method: "POST", headers: { authorization: `Bearer ${process.env.E2E_SCHEDULER_SECRET}` } });
  c.is("the right one ticks", ok.status, 200);
  await page.reload();
  c.is("the scheduler shows as checked in", (await page.getByTestId("scheduler-status").innerText()).includes("last checked in"), true);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    c.is(`the assistants page fits ${width}px`, await fits(), true);
  }
} finally {
  db.close();
  await browser.close();
}
process.exit(c.done() ? 0 : 1);
