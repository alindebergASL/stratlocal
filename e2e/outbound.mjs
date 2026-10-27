// Sending, one at a time (DECISIONS #103): with sending turned on, a
// meeting's recap is drafted from the person's own mailbox, edited, and sent
// with one press; an invite goes from their calendar; a chaser for what a
// customer promised waits in the Inbox under To send and can be discarded;
// and Ask drafts an email but never sends it. Synthetic mail (MAIL_FAKE=1).
import Database from "better-sqlite3";
import { BASE, checker, launch, signIn } from "./browser.mjs";

const c = checker("sending, one at a time");
const db = new Database(process.env.E2E_DB_PATH);
const browser = await launch();
const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);
const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const outbox = () => db.prepare("SELECT payload FROM fake_outbox ORDER BY created_at").all().map((r) => JSON.parse(r.payload));

try {
  await page.goto(`${BASE}/accounts`);
  const trigger = page.locator('[data-testid="account-new-open"]');
  if (await trigger.count()) await trigger.click();
  await page.fill('[data-testid="account-new"] [name="name"]', "Synthetic Sendwell Group");
  await page.click('[data-testid="account-new-submit"]');
  await page.waitForURL(/\/accounts\//, { timeout: 15000 });
  const accountId = page.url().split("/accounts/")[1].split(/[#/?]/)[0];
  await page.goto(`${BASE}/accounts/${accountId}/people`);
  await page.getByTestId("contact-new-open").click();
  await page.fill('[data-testid="contact-new"] [name="name"]', "Robin Example");
  await page.fill('[data-testid="contact-new"] [name="email"]', "robin@sendwell.example");
  await page.getByTestId("contact-new-submit").click();
  await page.waitForFunction(() => document.body.innerText.includes("Robin Example"), null, { timeout: 15000 });
  const contactId = db.prepare("SELECT id FROM contacts WHERE account_id = ? AND name = 'Robin Example'").get(accountId).id;

  // Sending is off until the person turns it on.
  await page.goto(`${BASE}/settings/connections`);
  await page.getByTestId("mail-connect-open").click();
  await page.getByTestId("mail-kind").selectOption("fake");
  await page.getByTestId("mail-connect-submit").click();
  await page.getByTestId("mail-connected").waitFor({ timeout: 15000 });
  c.is("sending starts off", (await page.getByTestId("mail-send-settings").innerText()).includes("off"), true);
  await page.getByTestId("mail-can-send").click();
  await page.getByTestId("mail-send-settings").filter({ hasText: "Send from my mailbox: on" }).waitFor({ timeout: 15000 });

  // A meeting next week with Robin on it, and notes from the last one.
  const day = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
  const mid = "synthetic-send-meeting";
  db.prepare("INSERT INTO meetings (id, account_id, title, held_at, held_time, attendees_json, raw_notes, created_at, updated_at) VALUES (?, ?, 'Synthetic planning call', ?, '10:00', ?, ?, ?, ?)").run(
    mid, accountId, day, JSON.stringify([{ contact_id: contactId, name: "Robin Example", note: null }]),
    "Robin Example confirmed the pilot scope covers two depots.\nWe agreed to send the revised sizing outline next week.\nRobin will share the security questionnaire by Friday.", Date.now(), Date.now(),
  );
  await page.goto(`${BASE}/accounts/${accountId}/meetings/${mid}`);
  await page.locator("#recap").scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Draft the recap email", exact: true }).click();
  await page.getByTestId("recap-draft").waitFor({ timeout: 15000 });
  await page.getByTestId("recap-send-draft").click();
  const card = page.locator('[data-testid="meeting-drafts"] [data-testid="outbound-card"]').first();
  await card.waitFor({ timeout: 15000 });
  c.is("the recap draft is addressed to Robin", (await card.getByTestId("outbound-to").innerText()).includes("robin@sendwell.example"), true);
  c.is("nothing has gone yet", outbox().length, 0);
  await card.getByTestId("outbound-subject").fill("Synthetic: thank you, and next steps");
  await card.getByTestId("outbound-send").click();
  await page.locator('[data-testid="meeting-drafts"] [data-testid="outbound-sent"]').first().waitFor({ timeout: 15000 });
  c.is("it went once, as edited, to Robin", JSON.stringify(outbox().map((o) => [o.subject, o.to])), JSON.stringify([["Synthetic: thank you, and next steps", ["robin@sendwell.example"]]]));

  // An invite from the person's calendar.
  await page.getByTestId("meeting-invite-draft").click();
  const invite = page.locator('[data-testid="outbound-card"][data-status="draft"]').first();
  await invite.waitFor({ timeout: 15000 });
  c.is("the invite is for the meeting's time", (await invite.getByTestId("outbound-starts").inputValue()) === `${day}T10:00`, true);
  await invite.getByTestId("outbound-send").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="meeting-drafts"] [data-testid="outbound-sent"]').length === 2, null, { timeout: 15000 });
  c.is("the invite went, from the calendar", outbox().at(-1)?.kind, "invite");

  // A chaser for what Robin promised waits in the Inbox, and can be dropped.
  db.prepare("INSERT INTO action_items (id, account_id, text, owner, due, status, created_at, updated_at) VALUES ('synthetic-chase', ?, 'Share the security questionnaire', 'Robin', ?, 'open', ?, ?)").run(accountId, day, Date.now(), Date.now());
  await page.goto(`${BASE}/follow-ups/synthetic-chase`);
  await page.getByTestId("task-chaser").click();
  await page.getByRole("status").filter({ hasText: "drafted" }).waitFor({ timeout: 15000 });
  await page.goto(`${BASE}/inbox?kind=send`);
  const chaser = page.locator('[data-testid="inbox-send"] [data-testid="outbound-card"]').first();
  c.is("the chaser waits under To send", (await chaser.getByTestId("outbound-body").inputValue()).includes("Hi Robin,"), true);
  await chaser.getByTestId("outbound-discard").click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="inbox-send"] [data-testid="outbound-card"]'), null, { timeout: 15000 });
  c.is("discarded, and never sent", outbox().length, 2);

  // Ask drafts, never sends.
  await page.goto(`${BASE}/accounts/${accountId}/ask`);
  await page.fill("#ask-question", "Email Robin the next steps");
  await page.click('[data-testid="ask-submit"]');
  await page.getByTestId("ask-draft-waiting").waitFor({ timeout: 30000 });
  c.is("Ask's email waits for the person", outbox().length, 2);

  // Proving sending works: a test to yourself, sent like any other draft.
  await page.goto(`${BASE}/settings/connections`);
  await page.getByTestId("mail-self-test").click();
  await page.getByText("A test to yourself is waiting").first().waitFor({ timeout: 15000 });
  c.is("the test is a draft, not sent", outbox().length, 2);
  await page.goto(`${BASE}/inbox?kind=send`);
  const cards = page.locator('[data-testid="inbox-send"] [data-testid="outbound-card"]');
  let test = null;
  for (let i = 0; i < (await cards.count()); i++) if ((await cards.nth(i).getByTestId("outbound-subject").inputValue()) === "Test from Strategy") test = cards.nth(i);
  c.is("it waits under To send", !!test, true);
  await test.getByTestId("outbound-send").click();
  for (let i = 0; i < 50 && outbox().length < 3; i++) await page.waitForTimeout(100);
  const sent = JSON.stringify(outbox().at(-1) ?? {});
  c.is("and goes to your own mailbox when you press Send", sent.includes("Test from Strategy") && sent.includes(process.env.E2E_USER1_EMAIL.toLowerCase()), true);

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of ["/inbox?kind=send", `/accounts/${accountId}/meetings/${mid}`]) {
      await page.goto(`${BASE}${path}`);
      c.is(`${path.split("/")[1]} fits ${width}px`, await fits(), true);
    }
  }
} finally {
  await browser.close();
}
process.exit(c.done() ? 0 : 1);
