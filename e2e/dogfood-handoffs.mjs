// Synthetic-only disposable database supplied by run.mjs (server AI_FAKE=1).
import Database from "better-sqlite3";
import { BASE, checker, launch, signIn, openTab } from "./browser.mjs";
const browser = await launch();
const c = checker("dogfood handoffs");
const db = new Database(process.env.E2E_DB_PATH);
try {
  const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);
  const trigger = page.getByTestId("account-new-open");
  if (await trigger.count()) await trigger.click();
  await page.fill('[data-testid="account-new"] [name="name"]', "Synthetic Dogfood Lab");
  await page.getByTestId("account-new-submit").click(); await page.waitForURL(/\/accounts\//);
  const accountUrl = page.url();
  await openTab(page, "meetings");
  await page.getByTestId("meeting-new-open").click();
  await page.fill('[data-testid="meeting-new"] [name="title"]', "Synthetic dogfood review");
  await page.fill('[data-testid="meeting-new"] [name="held_at"]', "2026-01-02");
  await page.getByTestId("meeting-new-submit").click(); await page.waitForURL(/\/meetings\//);
  const meetingUrl = page.url(); const mid = new URL(meetingUrl).pathname.split("/").at(-1);
  const row = (text) => db.prepare("SELECT * FROM action_items WHERE text = ?").get(text);
  async function add(text, scope = page) {
    await scope.getByTestId("follow-up-add").first().click();
    await page.fill('[data-testid="follow-up-form"] [name="text"]', text);
    await page.getByTestId("follow-up-save").click();
    await page.getByTestId("follow-up-form").waitFor({ state: "hidden" });
  }
  await add("Synthetic meeting handoff", page.locator("#follow-ups"));
  c.is("DB binds originating meeting", row("Synthetic meeting handoff")?.meeting_id, mid);
  await page.locator("#follow-ups").getByText("Synthetic meeting handoff", { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="follow-up-gaps"]')?.textContent.includes("1 follow-up missing details (0 missing owner; 1 missing date)"));
  c.is("assigned undated metadata", (await page.locator("#follow-ups").innerText()).includes("Alex · no date"), true);
  await page.reload();
  c.is("reload retains same meeting item", (await page.locator("#follow-ups").innerText()).includes("Synthetic meeting handoff"), true);
  const itemId = row("Synthetic meeting handoff").id;
  for (const url of [accountUrl, `${BASE}/follow-ups`]) {
    await page.goto(url); await page.locator(`#action-${itemId}`).waitFor();
    c.is(`visible on ${new URL(url).pathname}`, (await page.locator(`#action-${itemId}`).innerText()).includes("Alex"), true);
  }
  await page.locator(`#action-${itemId}`).getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator('[data-testid="follow-up-form"] [data-testid="follow-up-owner"]').selectOption({ label: "Jamie" });
  await page.fill('[data-testid="follow-up-form"] [name="due"]', "2026-10-01");
  await page.getByTestId("follow-up-save").click(); await page.getByTestId("follow-up-form").waitFor({ state: "hidden" });
  c.is("edit keeps meeting", row("Synthetic meeting handoff").meeting_id, mid);
  await page.goto(meetingUrl);
  c.is("owner edit displays actual user", (await page.locator(`#action-${itemId}`).innerText()).includes("Jamie"), true);
  c.is("date edit clears gap", (await page.getByTestId("follow-up-gaps").innerText()).includes("0 follow-ups missing details"), true);
  // A recipient's default queue has no who query. Revisit its cached anchor:
  // client-router fragment duplication must not lose the originating row.
  const recipient = await signIn(browser, process.env.E2E_USER2_EMAIL, process.env.E2E_USER2_PASSWORD);
  await recipient.setViewportSize({ width: 390, height: 950 });
  const handoffBefore = JSON.stringify(row("Synthetic meeting handoff"));
  await recipient.goto(`${BASE}/follow-ups#action-${itemId}`);
  c.is("recipient sees own assigned handoff", await recipient.locator(`#action-${itemId}`).count(), 1);
  for (let visit = 0; visit < 2; visit++) {
    await recipient.locator(`#action-${itemId}`).getByRole("link", { name: /Current meeting:/ }).click();
    await recipient.waitForURL(u => u.pathname.endsWith(`/meetings/${mid}`));
    await recipient.getByRole("link", { name: "← Return to Follow-ups", exact: true }).click();
    await recipient.waitForURL(u => u.pathname === "/follow-ups" && u.hash === `#action-${itemId}`);
    c.is(`recipient source return keeps own scope ${visit}`, new URL(recipient.url()).searchParams.get("who"), null);
  }
  c.is("source roundtrip never changes the handoff", JSON.stringify(row("Synthetic meeting handoff")), handoffBefore);
  await recipient.context().close();
  await page.goto(`${accountUrl}/follow-ups`); await add("Synthetic account handoff");
  c.is("account create unlinked", row("Synthetic account handoff").meeting_id, null);
  await page.goto(`${BASE}/follow-ups`); await add("Synthetic global handoff", page.getByTestId("own-work-group"));
  c.is("global create unlinked", row("Synthetic global handoff").meeting_id, null);
  // External ownership is a supported stored value, independent of user ids.
  db.prepare("UPDATE action_items SET owner_user_id = NULL, owner = ?, due = NULL WHERE id = ?").run("External Example", itemId);
  await page.goto(meetingUrl);
  c.is("external owner is shown", (await page.locator(`#action-${itemId}`).innerText()).includes("External Example · no date"), true);
  const notes = page.locator('textarea[name="raw_notes"]');
  await notes.fill("Send the synthetic storage sizing document after this call.");
  await page.getByRole("button", { name: "Save and extract changes", exact: true }).click();
  await page.getByTestId("review-as-list").click({ timeout: 15000 });
  await page.getByTestId("proposal-row").first().waitFor({ timeout: 15000 });
  // Expand only this disposable fake batch, retaining its real review metadata.
  const proposals = db.prepare("SELECT * FROM proposals WHERE origin_kind = 'meeting' AND origin_id = ? AND status = 'pending'").all(mid);
  const long = "Synthetic review evidence with readable before and after values. ".repeat(12);
  for (const p of proposals) {
    const payload = JSON.parse(p.payload_json);
    if (p.entity_type === "meeting") {
      payload.summary = `After: ${long}`;
      db.prepare("UPDATE meetings SET summary = ? WHERE id = ?").run(`Before: ${long}`, mid);
      db.prepare("UPDATE proposals SET before_json = ? WHERE id = ?").run(JSON.stringify({ ...JSON.parse(p.before_json || "{}"), summary: `Before: ${long}` }), p.id);
    } else if (p.entity_type === "action_item") payload.text = `Follow-up: ${long}`;
    db.prepare("UPDATE proposals SET payload_json = ? WHERE id = ?").run(JSON.stringify(payload), p.id);
  }
  await page.reload();
  await page.getByTestId("review-as-list").click({ timeout: 15000 });
  c.is("fake batch has summary and follow-up", proposals.map(p => p.entity_type).sort().join(","), "action_item,meeting");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const values = await page.getByTestId("proposal-row").locator("dd").evaluateAll(els => els.filter(e => e.textContent.includes("Synthetic review evidence")).map(e => ({ width: e.getBoundingClientRect().width, card: e.closest('[data-testid="proposal-row"]').getBoundingClientRect().width, text: e.textContent, overflow: e.scrollWidth > e.clientWidth + 1 })));
    c.is(`long values present ${width}`, values.length >= 2, true);
    c.is(`meaningful value width ${width}`, values.every(v => v.width >= 150 && v.width >= v.card * 0.70), true);
    c.is(`full prose retained ${width}`, values.every(v => v.text.includes(long) && !v.overflow), true);
    c.is(`both distinct before and after retained ${width}`, values.some(v => v.text.includes(`Before: ${long}`) && v.text.includes(`After: ${long}`)), true);
    c.is(`page fits ${width}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    c.is(`explicit accept/reject remain ${width}`, await page.getByTestId("row-accept").count() === 2 && await page.getByTestId("row-reject").count() === 2, true);
  }
} finally { db.close(); await browser.close(); }
process.exit(c.done() ? 0 : 1);
