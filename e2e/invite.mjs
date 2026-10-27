// Paste the invite instead of typing the meeting in.
//
// The one model surface in this app whose answer is not written anywhere: it
// fills the New meeting form in and the person presses Create. So what this
// has to prove is that the fields actually arrive filled, that a person the
// account already knows comes back pre-ticked rather than as a stranger, and
// that someone the invite does not name does not appear at all.
//
// Runs under AI_FAKE like every flow, which is exactly why lib/ai/fake.ts
// builds its answer from the real paste: a canned invite that ignored the
// input would wave both code-side guards through.
import { BASE, checker, launch, signIn, openTab } from "./browser.mjs";

const browser = await launch();
const c = checker("an invite, pasted");
const alex = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);

const trigger = alex.locator('[data-testid="account-new-open"]');
if (await trigger.count()) await trigger.click();
await alex.fill('[data-testid="account-new"] [name="name"]', "Litware Public Works");
await alex.click('[data-testid="account-new-submit"]');
await alex.waitForURL(/\/accounts\//, { timeout: 15000 });
const accountUrl = alex.url();

// Someone the account already knows, so the match has something to find.
await openTab(alex, "people");
await alex.click('[data-testid="contact-new-open"]');
await alex.fill('[data-testid="contact-new"] [name="name"]', "Finley Example");
await alex.fill('[data-testid="contact-new"] [name="email"]', "finley.example@example.com");
await alex.click('[data-testid="contact-new-submit"]');
await alex.waitForTimeout(1200);

const INVITE = `Depot network review
When: Wednesday 15 September 2027, 10:00 - 11:00 (Eastern Time)
Where: Teams
Required attendees: Finley Example <finley.example@example.com>
Also invited: Sam Okafor <sam.okafor@example.com>`;

await alex.goto(`${accountUrl}/meetings`);
await alex.click('[data-testid="invite-paste-open"]');
await alex.fill('[data-testid="invite-text"]', INVITE);
await alex.click('[data-testid="invite-paste-submit"]');
await alex.waitForSelector('[data-testid="invite-read"]', { timeout: 60000 });

c.is("the title comes from the invite", await alex.inputValue('[data-testid="meeting-new"] [name="title"]'), "Depot network review");
c.is("and the date", await alex.inputValue('[data-testid="meeting-new"] [name="held_at"]'), "2027-09-15");
// 10:00 Eastern is 07:00 Pacific, which is what APP_TIMEZONE defaults to. The
// model is told not to convert; the app does it, in code, and says so.
c.is("and the time, in our timezone", await alex.inputValue('[data-testid="meeting-new"] [name="held_time"]'), "07:00");
c.is("saying what it converted", /10:00 Eastern.*is 07:00 here/.test(await alex.innerText('[data-testid="invite-read"]')), true);

// The person already on file is ticked; the one who is not is recorded under
// their name rather than quietly added to the account.
c.is(
  "someone we already know comes back ticked",
  await alex.isChecked('[data-testid="meeting-new"] input[name="attendee_contact_ids"]'),
  true,
);
c.is(
  "and someone we do not is named, not created",
  (await alex.inputValue('[data-testid="meeting-new"] [name="attendee_names"]')).includes("Sam Okafor"),
  true,
);

await alex.click('[data-testid="meeting-new-submit"]');
await alex.waitForTimeout(2000);

await alex.goto(`${accountUrl}/meetings`);
const body = await alex.innerText("body");
c.is("the meeting is on the account", body.includes("Depot network review"), true);
c.is("with the time it was read as", body.includes("07:00"), true);

// Nothing was saved before Create: the invite named two people and only the
// one already on file is a contact.
// By href, not by link text: each contact card carries both a name link and
// an "Open" link to the same person, so counting distinct text says two.
await openTab(alex, "people");
const people = await alex.locator('#people a[href*="/contacts/"]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("href")))]);
c.is("and nobody was added to the account behind your back", people.length, 1);

await browser.close();
process.exit(c.done() ? 0 : 1);
