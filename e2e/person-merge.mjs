// Two rows for one person.
//
// This flow exists because of the way the last one went missing. Extraction
// proposes a new person whenever it cannot match one — matching is by email
// and then by exact name — so a name typed with a middle initial, a different
// spelling, or a stray space becomes a second human on the account. The merge
// that fixes it has been implemented and tested since Phase 5.
//
// And for one whole phase it was unreachable. The picker lived on the account
// page as one of twenty-five identical widgets; when editing moved to each
// person's own page the edit form went and the picker was deleted, leaving a
// comment claiming it had moved. `tests/merge.test.ts` stayed green the entire
// time, because a library test cannot see a missing button.
//
// So this walks the whole thing through the browser: the duplicate is made,
// it is linked to a play and sat in a meeting, and after the merge every one
// of those has to be on the survivor.
import { BASE, checker, launch, signIn, openTab } from "./browser.mjs";

const browser = await launch();
const c = checker("two rows for one person");
const alex = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);

const trigger = alex.locator('[data-testid="account-new-open"]');
if (await trigger.count()) await trigger.click();
await alex.fill('[data-testid="account-new"] [name="name"]', "Fabrikam Logistics");
await alex.click('[data-testid="account-new-submit"]');
await alex.waitForURL(/\/accounts\//, { timeout: 15000 });
const accountUrl = alex.url();

async function addPerson({ name, title = "", email = "" }) {
  await alex.goto(accountUrl);
  await openTab(alex, "people");
  await alex.click('[data-testid="contact-new-open"]');
  await alex.fill('[data-testid="contact-new"] [name="name"]', name);
  if (title) await alex.fill('[data-testid="contact-new"] [name="title"]', title);
  if (email) await alex.fill('[data-testid="contact-new"] [name="email"]', email);
  await alex.click('[data-testid="contact-new-submit"]');
  await alex.waitForTimeout(1200);
}

// The one you typed in after the first call: a title, no email.
await addPerson({ name: "Finley Example", title: "Director of Infrastructure" });
// The one the report brought, spelled with the space extraction left in it.
// `sameName` normalises whitespace and punctuation, so the app can see this
// pair — which is what pre-fills the picker.
await addPerson({ name: "Finley  Example", email: "finley.example@example.com" });

await alex.goto(`${accountUrl}/people`);
const hrefs = await alex.locator('#people a[href*="/contacts/"]').evaluateAll((els) => els.map((e) => e.getAttribute("href")));
const unique = [...new Set(hrefs)];
c.is("two people on the account", unique.length, 2);

// Which is which: the keeper is the one carrying the title.
let keeperHref = null;
let loserHref = null;
for (const href of unique) {
  await alex.goto(`${BASE}${href}`);
  const body = await alex.innerText("body");
  if (body.includes("Director of Infrastructure")) keeperHref = href;
  else loserHref = href;
}
c.is("the keeper and the duplicate are both reachable", keeperHref !== null && loserHref !== null, true);
const loserId = loserHref.split("/contacts/")[1];

// Put the duplicate on a play and in a meeting, which is the whole reason a
// merge has to move anything at all.
await alex.goto(accountUrl);
await openTab(alex, "plays");
await alex.click('[data-testid="play-new-open"]');
await alex.fill('[data-testid="play-new"] [name="title"]', "Hold the depot network");
await alex.click('[data-testid="play-new-submit"]');
await alex.waitForTimeout(1200);

await alex.goto(accountUrl);
const playHref = await alex.locator('a[href*="/plays/"]').first().getAttribute("href");
await alex.goto(`${BASE}${playHref}`);
await alex.click('[data-testid="play-edit-open"]');
await alex.check(`[data-testid="play-edit"] input[name="contact_ids"][value="${loserId}"]`);
await alex.click('[data-testid="play-edit-submit"]');
await alex.waitForTimeout(1500);

await alex.goto(accountUrl);
await openTab(alex, "meetings");
await alex.click('[data-testid="meeting-new-open"]');
await alex.fill('[data-testid="meeting-new"] [name="title"]', "Depot walkthrough");
await alex.check(`[data-testid="meeting-new"] input[name="attendee_contact_ids"][value="${loserId}"]`);
await alex.click('[data-testid="meeting-new-submit"]');
await alex.waitForTimeout(1500);

// The merge, from the page of the person being kept.
await alex.goto(`${BASE}${keeperHref}`);
const before = await alex.innerText("body");
c.is("the person's page offers the merge", await alex.locator('[data-testid="contact-merge-open"]').count(), 1);
c.is("and says which row looks like the same human", /looks like the same person/.test(before), true);

await alex.click('[data-testid="contact-merge-open"]');
await alex.click('[data-testid="contact-merge-submit"]');
await alex.waitForTimeout(2000);

await alex.goto(`${BASE}${keeperHref}`);
const after = await alex.innerText("body");
// Blank fields fill; nothing that was already there is overwritten.
c.is("the survivor keeps their own title", after.includes("Director of Infrastructure"), true);
c.is("and takes the email the other row had", after.includes("finley.example@example.com"), true);
// The two things a merge exists to move.
c.is("the play the duplicate was on is now theirs", after.includes("Hold the depot network"), true);
c.is("and so is the meeting the duplicate sat in", after.includes("Depot walkthrough"), true);
// History records it, rather than the move happening silently.
c.is("the merge is in their history", /merged.from|merged.in/i.test(after), true);

await alex.goto(`${accountUrl}/people`);
const remaining = await alex.locator('#people a[href*="/contacts/"]').evaluateAll((els) => [
  ...new Set(els.map((e) => e.getAttribute("href"))),
]);
c.is("one person on the account again", remaining.length, 1);
c.is("and it is the one that was kept", remaining[0], keeperHref);

// --- the same person, at another account ------------------------------------
//
// The other half of "two rows for one person": sometimes they are not a
// duplicate to collapse but one human at two customers, and each account's row
// should keep its own role and notes. This links them rather than merging.
await alex.goto(BASE);
const t2 = alex.locator('[data-testid="account-new-open"]');
if (await t2.count()) await t2.click();
await alex.fill('[data-testid="account-new"] [name="name"]', "Contoso Freight");
await alex.click('[data-testid="account-new-submit"]');
await alex.waitForURL(/\/accounts\//, { timeout: 15000 });
const secondUrl = alex.url();

await openTab(alex, "people");
await alex.click('[data-testid="contact-new-open"]');
await alex.fill('[data-testid="contact-new"] [name="name"]', "Finley Example");
await alex.fill('[data-testid="contact-new"] [name="email"]', "finley.example@example.com");
await alex.fill('[data-testid="contact-new"] [name="title"]', "Group CTO");
await alex.click('[data-testid="contact-new-submit"]');
await alex.waitForTimeout(1200);

await alex.goto(`${BASE}${keeperHref}`);
c.is("the page offers to link them to another account", await alex.locator('[data-testid="person-link-open"]').count(), 1);
await alex.click('[data-testid="person-link-open"]');
await alex.waitForSelector('[data-testid="person-link"] [name="other_id"]', { timeout: 15000 });
// Pre-filled from the address, the same two signals the merge picker uses.
const options = await alex.locator('[data-testid="person-link"] [name="other_id"] option').allInnerTexts();
c.is("with the person at the other account offered", options.some((o) => /Contoso Freight/.test(o)), true);
await alex.click('[data-testid="person-link"] button[type="submit"]');
await alex.waitForTimeout(1500);

await alex.goto(`${BASE}${keeperHref}`);
const linked = await alex.innerText("body");
c.is("the link shows the other account", /Contoso Freight/.test(linked), true);
c.is("and both rows still exist, each with its own title", linked.includes("Director of Infrastructure"), true);

// Symmetric, because a group id has no direction to get backwards.
await alex.goto(`${secondUrl}/people`);
const otherHref = await alex.locator('#people a[href*="/contacts/"]').first().getAttribute("href");
await alex.goto(`${BASE}${otherHref}`);
const back = await alex.innerText("body");
c.is("the other row names this one back", /Fabrikam Logistics/.test(back), true);
c.is("and keeps its own title rather than taking the other's", back.includes("Group CTO"), true);

// The link is a screen affordance. A handoff goes to another account team, so
// naming this person's other customers in one is a leak — tests/personLink
// holds that by reading the sources; this checks the rendered document.
await alex.goto(`${secondUrl}/handoff`);
await alex.waitForTimeout(500);
c.is("and a handoff for this account never names the other one", /Fabrikam Logistics/.test(await alex.innerText("body")), false);

// Unlinking leaves both rows where they were.
await alex.goto(`${BASE}${otherHref}`);
await alex.click('[data-testid="person-unlink-open"]');
await alex.click('[data-testid="person-unlink"] button[type="submit"]');
await alex.waitForTimeout(1500);
await alex.goto(`${BASE}${keeperHref}`);
const unlinked = await alex.innerText("body");
c.is("unlinking removes the other account", /Contoso Freight/.test(unlinked), false);
c.is("and the person is still here", unlinked.includes("Finley Example"), true);

await browser.close();
process.exit(c.done() ? 0 : 1);
