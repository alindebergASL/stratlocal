// A follow-up you can write down, and find again.
//
// Before this the only way to create one was a meeting, pasted notes, a paid
// extraction and an accepted proposal — four steps and a model call to record
// one line. And the extraction sets a date only when the notes gave one, while
// every attention surface requires a date, so the common case was invisible to
// Home forever with no form anywhere to fix it.
import { BASE, checker, launch, signIn, openTab } from "./browser.mjs";

const browser = await launch();
const c = checker("follow-ups");
const alex = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);
const jamie = await signIn(browser, process.env.E2E_USER2_EMAIL, process.env.E2E_USER2_PASSWORD);

const trigger = alex.locator('[data-testid="account-new-open"]');
if (await trigger.count()) await trigger.click();
await alex.fill('[data-testid="account-new"] [name="name"]', "Synthetic Orchard Lab");
await alex.click('[data-testid="account-new-submit"]');
await alex.waitForURL(/\/accounts\//, { timeout: 15000 });
const accountUrl = alex.url();

// Write one down, with a date and an owner.
await openTab(alex, "follow-ups");
await alex.click('[data-testid="follow-up-add"]');
await alex.fill('[data-testid="follow-up-form"] [name="text"]', "Send the storage sizing document");
await alex.fill('[data-testid="follow-up-form"] [name="due"]', "2026-01-05");
await alex.click('[data-testid="follow-up-save"]');
await alex.waitForTimeout(1500);

await alex.goto(accountUrl);
c.is("it is on the account", (await alex.innerText("body")).includes("Send the storage sizing document"), true);

// And on my list, across accounts.
await alex.goto(`${BASE}/follow-ups`);
const mine = await alex.innerText("body");
c.is("it is on my follow-ups", mine.includes("Send the storage sizing document"), true);
// Case-insensitive: the account heading is styled uppercase, and innerText
// returns what is rendered rather than what is in the markup.
c.is("under its account", /synthetic orchard lab/i.test(mine), true);

// Not on the other person's.
await jamie.goto(`${BASE}/follow-ups`);
c.is("not on theirs", (await jamie.innerText("body")).includes("Send the storage sizing document"), false);

// A past-due one reaches Home, which is what the date is for.
await alex.goto(accountUrl);
await openTab(alex, "follow-ups");
await alex.click('[data-testid="follow-up-add"]');
await alex.fill('[data-testid="follow-up-form"] [name="text"]', "Chase the security review");
await alex.fill('[data-testid="follow-up-form"] [name="due"]', "2020-03-01");
await alex.click('[data-testid="follow-up-save"]');
await alex.waitForTimeout(1500);

await alex.goto(BASE);
c.is("an overdue one reaches Home", (await alex.innerText("body")).includes("Chase the security review"), true);

// The undated one can be given a date from the page that complains about it.
//
// /follow-ups showed an Archive button, no Edit and no Add — so the screen
// whose heading says "N with no date" could not set one, and an undated
// follow-up is invisible to every attention surface forever.
await alex.goto(`${BASE}/follow-ups`);
await alex.click('[data-testid="follow-up-add"]');
await alex.fill('[data-testid="follow-up-form"] [name="text"]', "Booked straight from my list");
await alex.fill('[data-testid="follow-up-form"] [name="due"]', "2026-02-02");
await alex.click('[data-testid="follow-up-save"]');
await alex.waitForTimeout(1500);
await alex.goto(`${BASE}/follow-ups`);
c.is("one can be written down from here", (await alex.innerText("body")).includes("Booked straight from my list"), true);

// Editing it keeps it where it was.
await alex.goto(`${accountUrl}/follow-ups`);
await alex.click('button:has-text("Edit")');
await alex.fill('[data-testid="follow-up-form"] [name="text"]', "Chase the security review with Dana");
await alex.click('[data-testid="follow-up-save"]');
await alex.waitForTimeout(1500);
await alex.goto(`${BASE}/follow-ups`);
c.is("an edit sticks", (await alex.innerText("body")).includes("Chase the security review with Dana"), true);

// Work that is not about a customer.
//
// Every follow-up needs an account, so until now "build the forecast" had
// nowhere to go: the app had a todo list and no way to put your own work on
// it. Own work is a real account flagged as not-a-customer, which is why the
// whole follow-up machinery below works on it unchanged — and why the thing
// worth checking in a browser is that it is *reachable* with nothing on it
// yet, and stays out of the lists that are about customers.
await alex.goto(`${BASE}/follow-ups`);
// Addressed by testid, not by its label: the group heading is an Eyebrow,
// which is uppercased in CSS, so innerText returns "OWN WORK" and a match on
// the written name fails while the screen is perfectly correct.
const ownGroup = alex.locator('[data-testid="own-work-group"]');
c.is("own work is offered before anything is on it", await ownGroup.count(), 1);

// Writing one down is this page's primary action, so the control is in the
// header. It was a quiet small button at the foot of every account group —
// one per group, and the one you wanted sat under an empty list, which made
// the commonest thing you do here the last thing on the screen.
//
// A header control has to say which list it writes into, and it says it by
// opening that one: Own work, because a todo typed here without naming a
// customer is by definition not about one.
const form = '[data-testid="own-work-group"] [data-testid="follow-up-form"]';
await alex.click('[data-testid="follow-up-add-top"]');
await alex.waitForSelector(form, { timeout: 15000 });
c.is("the page's primary action opens the own-work editor", await alex.locator(form).count(), 1);
// Exactly that one. Opening an editor in every group would be four forms and
// a question about which of them you are typing into.
c.is("and no other group's", await alex.locator('[data-testid="follow-up-form"]').count(), 1);
// The per-group control stays: on a customer's group it is the one that binds
// the todo to that account.
c.is("a customer's group still has its own add", await alex.locator('[data-testid="account-group"] [data-testid="follow-up-add"]').count() > 0, true);

await alex.fill(`${form} [name="text"]`, "Build the Q2 forecast");
await alex.fill(`${form} [name="due"]`, "2026-02-03");
await alex.click('[data-testid="follow-up-save"]');
await alex.waitForTimeout(1500);

await alex.goto(`${BASE}/follow-ups`);
c.is("a todo with no customer can be written down", (await alex.innerText("body")).includes("Build the Q2 forecast"), true);

// It reaches the day's list like any other, which is the whole point of
// storing it as an account rather than as a null.
await alex.goto(`${BASE}/`);
c.is("and it reaches Home", (await alex.innerText("body")).includes("Build the Q2 forecast"), true);

// Links to it do exist — Home's overdue row, "what moved", a history line —
// and rather than police every one of them, the account page itself sends you
// to the todos. It has no deals, plays or meetings, so there is nothing else
// on it to see.
await alex.goto(`${BASE}/accounts/own-work`);
c.is("its account page sends you to the todos instead", alex.url().endsWith("/follow-ups"), true);

// And it stays out of search, which is where a customer would be found.
await alex.goto(`${BASE}/search?q=Own`);
c.is("it is not findable as an account", /own work/i.test(await alex.innerText("body")), false);

// A filtered empty list does not mean there is no work across both people.
async function chooseOwner(page, name) {
  const link = page.getByRole("link", { name, exact: true });
  await link.click();
  await link.and(page.locator('[aria-current="page"]')).waitFor();
}
await jamie.goto(`${BASE}/follow-ups`);
c.is("empty Mine is scoped to the signed-in person", (await jamie.innerText("body")).includes("Nothing assigned to you."), true);
const alexHref = await jamie.getByRole("link", { name: "Alex", exact: true }).getAttribute("href");
await chooseOwner(jamie, "Alex");
c.is("partner work remains reachable", (await jamie.innerText("body")).includes("Build the Q2 forecast"), true);
c.is("partner count identifies the scope", (await jamie.innerText("body")).includes("open assigned to Alex"), true);
await alex.goto(`${BASE}${alexHref}`);
c.is("an explicit own-user id selects Mine", await alex.getByRole("link", { name: "Mine", exact: true }).getAttribute("aria-current"), "page");
await chooseOwner(alex, "Jamie");
c.is("empty partner view names the partner", (await alex.innerText("body")).includes("Nothing assigned to Jamie."), true);
await chooseOwner(alex, "Nobody's");
c.is("Nobody's explains unassigned work", (await alex.innerText("body")).includes("No unassigned follow-ups."), true);
await alex.getByTestId("follow-up-add-top").click();
await alex.getByTestId("follow-up-form").waitFor();
c.is("Add works from an empty filtered list", await alex.getByTestId("follow-up-form").count(), 1);

// Long-overdue work is one line on Today and sorted one card at a time. The
// oldest comes first, and "Done" is the same write the account page makes.
await alex.goto(BASE);
c.is("Today counts the old backlog in one line", await alex.getByTestId("today-backlog").count(), 1);
await alex.getByTestId("today-sort").click();
await alex.waitForURL(/\/follow-ups\/sort/);
const card = alex.getByTestId("sort-card");
c.is("the oldest past-due follow-up comes first", (await card.innerText()).includes("Chase the security review"), true);
await alex.getByTestId("sort-done").click();
await alex.waitForFunction(() => !document.querySelector('[data-testid="sort-card"]')?.textContent?.includes("Chase the security review"));
c.is("sorting moves on to the next card", (await alex.locator("body").innerText()).includes("Chase the security review"), false);
await alex.goto(`${BASE}/follow-ups`);
c.is("a sorted follow-up is done everywhere", (await alex.innerText("body")).includes("Chase the security review"), false);

await browser.close();
process.exit(c.done() ? 0 : 1);
