// A calendar becomes meetings, on a tap.
//
// A published iCal link (served here, on loopback, which only this flow's
// server is allowed to read) carries a customer meeting, an internal one, a
// call with someone nobody knows yet, and a day out of office. The matched
// meeting is added in one tap with its attendee as the contact; the unknown
// one asks which account; the internal one is counted and left; the day off
// shows as time off. Then the invite moves, and the page offers to move the
// meeting with it.
import { createServer } from "node:http";
import Database from "better-sqlite3";
import { BASE, checker, launch, signIn, openTab } from "./browser.mjs";

const c = checker("calendar");
const db = new Database(process.env.E2E_DB_PATH, { readonly: true });

// Days in the app's zone (America/Los_Angeles unless the run says otherwise).
const zone = process.env.APP_TIMEZONE || "America/Los_Angeles";
const dayIn = (offset) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offset * 86400000));
const compact = (iso) => iso.replaceAll("-", "");
const tomorrow = dayIn(1);
const later = dayIn(3);

let customerStart = `${compact(tomorrow)}T113000`;
const ics = () =>
  [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Synthetic//EN",
    "BEGIN:VEVENT", "UID:syn-customer", "SUMMARY:Synthetic depot review", `DTSTART;TZID=${zone}:${customerStart}`, `DTEND;TZID=${zone}:${customerStart.slice(0, 9)}${String(Number(customerStart.slice(9, 11)) + 1).padStart(2, "0")}${customerStart.slice(11)}`,
    "ORGANIZER;CN=Alex:mailto:alex@e2e.local", "ATTENDEE;CN=Casey Example:mailto:casey@juniper.example", "ATTENDEE;CN=Alex:mailto:alex@e2e.local", "END:VEVENT",
    "BEGIN:VEVENT", "UID:syn-internal", "SUMMARY:Synthetic team sync", `DTSTART;TZID=${zone}:${compact(tomorrow)}T090000`, `DTEND;TZID=${zone}:${compact(tomorrow)}T093000`,
    "ATTENDEE:mailto:alex@e2e.local", "ATTENDEE:mailto:jamie@e2e.local", "END:VEVENT",
    "BEGIN:VEVENT", "UID:syn-unknown", "SUMMARY:Synthetic intro call", `DTSTART;TZID=${zone}:${compact(later)}T140000`, `DTEND;TZID=${zone}:${compact(later)}T143000`,
    "ATTENDEE;CN=Morgan Example:mailto:morgan@newco.example", "ATTENDEE:mailto:alex@e2e.local", "END:VEVENT",
    "BEGIN:VEVENT", "UID:syn-off", "SUMMARY:Out of office", `DTSTART;VALUE=DATE:${compact(dayIn(5))}`, `DTEND;VALUE=DATE:${compact(dayIn(7))}`, "X-MICROSOFT-CDO-BUSYSTATUS:OOF", "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/calendar" });
  res.end(ics());
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const feedUrl = `http://127.0.0.1:${server.address().port}/synthetic.ics`;

const browser = await launch();
const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);
const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

try {
  // An account whose contact will be invited.
  const trigger = page.locator('[data-testid="account-new-open"]');
  if (await trigger.count()) await trigger.click();
  await page.fill('[data-testid="account-new"] [name="name"]', "Synthetic Juniper Lab");
  await page.click('[data-testid="account-new-submit"]');
  await page.waitForURL(/\/accounts\//, { timeout: 15000 });
  const accountUrl = page.url();
  await openTab(page, "people");
  await page.getByTestId("contact-new-open").click();
  await page.fill('[data-testid="contact-new"] [name="name"]', "Casey Example");
  await page.fill('[data-testid="contact-new"] [name="email"]', "casey@juniper.example");
  await page.getByTestId("contact-new-submit").click();
  await page.waitForFunction(() => document.body.innerText.includes("Casey Example"), null, { timeout: 15000 });

  // Connect the published link.
  await page.goto(`${BASE}/calendar`);
  await page.fill('[data-testid="calendar-connect"] [name="value"]', feedUrl);
  await page.getByTestId("calendar-connect-submit").click();
  await page.getByTestId("calendar-add").waitFor({ timeout: 20000 });
  const source = db.prepare("SELECT config_json, last_count FROM calendar_sources").get();
  c.is("the link is kept on the server", JSON.parse(source.config_json).url, feedUrl);
  c.is("and never shown again", (await page.locator("body").innerText()).includes(feedUrl), false);
  c.is("all four events were read", source.last_count, 4);

  const rows = page.getByTestId("calendar-add-row");
  c.is("one customer meeting is offered", await rows.count(), 1);
  c.is("matched by who is invited", (await rows.first().innerText()).includes("Casey Example is invited"), true);
  c.is("the unknown one asks which account", await page.getByTestId("calendar-question").count(), 1);
  c.is("the internal one is counted, not offered", (await page.getByTestId("calendar-internal").innerText()).startsWith("1 internal event"), true);
  c.is("the day off shows as time off", (await page.getByTestId("calendar-time-off").innerText()).includes("You are off"), true);
  c.is("nothing is a meeting yet", db.prepare("SELECT COUNT(*) AS n FROM meetings WHERE title LIKE 'Synthetic%'").get().n, 0);

  // Today says so too.
  await page.goto(`${BASE}/`);
  c.is("Today offers the calendar", await page.locator('[data-testid="today-item"]', { hasText: "from the calendar" }).count(), 1);
  await page.goto(`${BASE}/calendar`);

  await page.getByTestId("calendar-add-submit").click();
  await page.getByTestId("calendar-added").waitFor({ timeout: 15000 });
  c.is("it says what it did", (await page.getByTestId("calendar-added").innerText()).includes("1 meeting added"), true);
  const meeting = db.prepare("SELECT id, account_id, held_at, held_time, attendees_json FROM meetings WHERE title = 'Synthetic depot review'").get();
  c.is("one tap made the meeting, on the right day and time", [meeting?.held_at, meeting?.held_time].join(" "), `${tomorrow} 11:30`);
  c.is("with the contact as its attendee", JSON.parse(meeting.attendees_json).map((a) => a.name).join(","), "Casey Example");
  c.is("on the right account", accountUrl.endsWith(meeting.account_id), true);

  // Which account? Answer it.
  await page.reload();
  await page.getByTestId("calendar-question-account").selectOption({ label: "Synthetic Juniper Lab" });
  await page.getByTestId("calendar-question-add").click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="calendar-question"]'), null, { timeout: 15000 });
  c.is("the chosen account got the intro call", db.prepare("SELECT COUNT(*) AS n FROM meetings WHERE title = 'Synthetic intro call' AND account_id = ?").get(meeting.account_id).n, 1);

  // The invite moves; the page offers to move the meeting.
  customerStart = `${compact(tomorrow)}T150000`;
  await page.getByTestId("calendar-sync").click();
  await page.getByTestId("calendar-move").waitFor({ timeout: 15000 });
  await page.getByTestId("calendar-move").click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="calendar-move"]'), null, { timeout: 15000 });
  c.is("the meeting moved with its invite", db.prepare("SELECT held_time FROM meetings WHERE id = ?").get(meeting.id).held_time, "15:00");

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    c.is(`the calendar page fits ${width}px`, await fits(), true);
  }
} finally {
  db.close();
  server.close();
  await browser.close();
}
process.exit(c.done() ? 0 : 1);
