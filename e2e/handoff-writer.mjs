// Handoff writer: a cover sheet for time off, and a drafted handoff for
// another team, both edited and sent by a person.
//
// A follow-up of Alex's falls in the days away; the cover sheet lists it, a
// drafted note cites it, and one press hands it to Jamie as Alex's edit. On
// the account's handoff page, a draft fills the form, the person creates the
// handoff, and what was stored is what the form said.
import Database from "better-sqlite3";
import { BASE, checker, launch, signIn, openTab } from "./browser.mjs";

const c = checker("handoff writer");
const db = new Database(process.env.E2E_DB_PATH, { readonly: true });
const zone = process.env.APP_TIMEZONE || "America/Los_Angeles";
const dayIn = (offset) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offset * 86400000));
const browser = await launch();
const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);
const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const settle = async () => {
  for (let i = 0; i < 60 && db.prepare("SELECT COUNT(*) AS n FROM ai_runs WHERE status = 'running'").get().n > 0; i++) await page.waitForTimeout(500);
};

try {
  const trigger = page.locator('[data-testid="account-new-open"]');
  if (await trigger.count()) await trigger.click();
  await page.fill('[data-testid="account-new"] [name="name"]', "Synthetic Juniper Lab");
  await page.click('[data-testid="account-new-submit"]');
  await page.waitForURL(/\/accounts\//, { timeout: 15000 });
  const accountUrl = page.url().split("#")[0].split("?")[0];

  await openTab(page, "follow-ups");
  await page.click('[data-testid="follow-up-add"]');
  await page.fill('[data-testid="follow-up-form"] [name="text"]', "Send the synthetic sizing outline");
  await page.fill('[data-testid="follow-up-form"] [name="due"]', dayIn(3));
  await page.click('[data-testid="follow-up-save"]');
  await page.waitForFunction(() => !document.querySelector('[data-testid="follow-up-form"]'), null, { timeout: 15000 });
  const item = db.prepare("SELECT id, owner_user_id FROM action_items WHERE text = ?").get("Send the synthetic sizing outline");

  // The cover sheet for days typed in.
  await page.goto(`${BASE}/handoff?from=${dayIn(2)}&to=${dayIn(4)}`);
  c.is("the cover sheet counts what falls in the days", (await page.getByTestId("cover-summary").innerText()).includes("1 thing falls in them; Jamie is covering"), true);
  await page.getByRole("button", { name: "Draft the note", exact: true }).click();
  await page.getByTestId("cover-draft").waitFor({ timeout: 20000 });
  c.is("the note cites the follow-up it rests on", (await page.getByTestId("cover-draft").innerText()).includes("From Send the synthetic sizing outline"), true);
  await page.getByTestId("hand-over-submit").click();
  await page.locator('[data-testid="hand-over"] [role="status"]').waitFor({ timeout: 15000 });
  const after = db.prepare("SELECT owner_user_id FROM action_items WHERE id = ?").get(item.id);
  const jamie = db.prepare("SELECT id FROM users WHERE display_name = 'Jamie'").get().id;
  c.is("one press hands it to Jamie", after.owner_user_id, jamie);
  c.is("as Alex's own edit", db.prepare("SELECT COUNT(*) AS n FROM change_log WHERE entity_id = ? AND field = 'owner_user_id' AND actor_user_id = ? AND new_value = ?").get(item.id, item.owner_user_id, JSON.stringify(jamie)).n, 1);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    c.is(`the cover sheet fits ${width}px`, await fits(), true);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // A drafted handoff for another team, edited in the form and created by the person.
  await page.goto(`${accountUrl}/handoff`);
  await page.getByRole("button", { name: "Draft it for me", exact: true }).click();
  await page.getByTestId("handoff-draft").waitFor({ timeout: 20000 });
  await settle();
  c.is("nothing is stored by drafting", db.prepare("SELECT COUNT(*) AS n FROM documents WHERE kind = 'handoff'").get().n, 0);
  await page.getByTestId("handoff-draft-use").click();
  const asks = await page.locator('[data-testid="handoff-new"] [name="asks"]').inputValue();
  c.is("the draft fills the form", asks.length > 20, true);
  await page.fill('[data-testid="handoff-new"] [name="asks"]', `${asks} Edited by a person.`);
  await page.click('[data-testid="handoff-new-submit"]');
  await page.waitForURL(/\/handoff\/[^/]+$/, { timeout: 15000 });
  const stored = db.prepare("SELECT meta_json FROM documents WHERE kind = 'handoff'").get();
  c.is("what was stored is what the person sent", JSON.stringify(stored).includes("Edited by a person."), true);
} finally {
  db.close();
  await browser.close();
}
process.exit(c.done() ? 0 : 1);
