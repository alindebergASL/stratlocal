// Whose account is it.
//
// A library test can see that the SQL filters; it cannot see whether the
// picker and the four links reached a screen. That distinction is the whole
// reason DECISIONS #25 exists — merging two people was deleted from one page,
// never added to the other, and stayed missing for a phase with every library
// test green.
//
// So this drives the affordance: set an owner on the form, then ask each of
// the three pages the question from its own links and check what comes back.
import { BASE, checker, launch, signIn, openTab } from "./browser.mjs";

const browser = await launch();
const c = checker("ownership");
const alex = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);
const jamie = await signIn(browser, process.env.E2E_USER2_EMAIL, process.env.E2E_USER2_PASSWORD);

async function newAccount(page, name) {
  await page.goto(BASE);
  const trigger = page.locator('[data-testid="account-new-open"]');
  if (await trigger.count()) await trigger.click();
  await page.fill('[data-testid="account-new"] [name="name"]', name);
  await page.click('[data-testid="account-new-submit"]');
  await page.waitForURL(/\/accounts\//, { timeout: 15000 });
  return page.url();
}

const MINE = "Synthetic Orchard Lab";
const THEIRS = "Calder Freight Group";
const SHARED = "Ellsworth Utilities";

// A deal each, because the pipeline and the activity feed are about deals: an
// assertion on the account name alone would match the account picker those
// pages render, and would pass with the filter removed.
async function addDeal(page, name) {
  await openTab(page, "deals");
  await page.click('[data-testid="deal-new-open"]');
  await page.fill('[data-testid="deal-new"] [name="name"]', name);
  await page.fill('[data-testid="deal-new"] [name="tcv_usd"]', "1.8M");
  await page.click('[data-testid="deal-new-submit"]');
  await page.waitForTimeout(1500);
}

const mineUrl = await newAccount(alex, MINE);
await addDeal(alex, "SyntheticOrchard_Core-Refresh");
const theirsUrl = await newAccount(alex, THEIRS);
await addDeal(alex, "Calder_Depot-Build");
await newAccount(alex, SHARED);
await addDeal(alex, "Ellsworth_Grid-Upgrade");

// The picker. It is on the account's own form, beside every other field that
// describes the account.
async function setOwner(url, optionLabel) {
  await alex.goto(url);
  await openTab(alex, "details");
  const trigger = alex.locator('[data-testid="account-edit-open"]');
  if (await trigger.count()) await trigger.click();
  await alex.selectOption('[data-testid="account-edit"] [name="owner_user_id"]', { label: optionLabel });
  await alex.click('[data-testid="account-edit-submit"]');
  await alex.waitForTimeout(1500);
}

// Whatever the two seeded users are called, the picker offers them by name.
await alex.goto(mineUrl);
await openTab(alex, "details");
const openEdit = alex.locator('[data-testid="account-edit-open"]');
if (await openEdit.count()) await openEdit.click();
const options = await alex.locator('[data-testid="account-edit"] [name="owner_user_id"] option').allInnerTexts();
c.is("the picker offers both of us and neither", options.length, 3);
c.is("shared is the default", options[0], "Both of us");
const [, first, second] = options;

await setOwner(mineUrl, first);
await setOwner(theirsUrl, second);
// Ellsworth is left alone: nobody owns it, which is a real answer.

// The account list (it was the bottom of Home and is /accounts now). `first`
// is whoever the account form listed first, which is the order
// listUsers returns — so ask the page which of the two it calls "Mine".
async function accountsOn(page, path) {
  await page.goto(`${BASE}${path}`);
  const body = await page.innerText("body");
  return [MINE, THEIRS, SHARED].filter((n) => body.includes(n));
}

c.is("Accounts shows everything by default", (await accountsOn(alex, "/accounts")).length, 3);

const alexsMine = await accountsOn(alex, "/accounts?who=mine");
const jamiesMine = await accountsOn(jamie, "/accounts?who=mine");
// One of them owns one account and the other owns the other; which is which
// depends on the seed order, and the point is that the two answers differ and
// neither is the shared one.
c.is("each of us has exactly one", [alexsMine.length, jamiesMine.length].join(","), "1,1");
c.is("and they are different accounts", alexsMine[0] !== jamiesMine[0], true);
c.is("neither of them is the shared one", [...alexsMine, ...jamiesMine].includes(SHARED), false);

c.is("theirs is the other one", (await accountsOn(alex, "/accounts?who=theirs"))[0], jamiesMine[0]);
c.is("shared is the one nobody owns", (await accountsOn(alex, "/accounts?who=shared")).join(), SHARED);

// The list says whose it is, so "whose is that one" does not cost a page load.
await alex.goto(`${BASE}/accounts`);
const home = await alex.innerText("body");
c.is("Accounts names the owner on the row", home.includes(first) && home.includes(second), true);

// Which deal belongs to whom follows from which account does.
const DEAL_OF = {
  [MINE]: "SyntheticOrchard_Core-Refresh",
  [THEIRS]: "Calder_Depot-Build",
  [SHARED]: "Ellsworth_Grid-Upgrade",
};
const myDeal = DEAL_OF[alexsMine[0]];
const theirDeal = DEAL_OF[jamiesMine[0]];

// The pipeline and what-moved read the same clause, and the links carry it.
await alex.goto(`${BASE}/pipeline`);
const pipeAll = await alex.innerText("body");
c.is("the pipeline shows every deal by default", pipeAll.includes(myDeal) && pipeAll.includes(theirDeal), true);

await alex.goto(`${BASE}/pipeline?who=mine`);
c.is("the pipeline knows the filter", await alex.locator('[data-testid="pipeline-owner"]').count(), 1);
const pipeMine = await alex.innerText("body");
c.is("and narrows to my deals", pipeMine.includes(myDeal) && !pipeMine.includes(theirDeal), true);

// The filter row is a GET form, so Apply must not drop the owner — it lives in
// the URL rather than in the form, and a hidden field is what carries it.
// Scoped to that button: the first `button[type=submit]` on the page is the
// nav's sign-out, and pressing it makes every later check fail for the wrong
// reason.
await alex.click('[data-testid="pipeline-apply"]');
await alex.waitForTimeout(1500);
c.is("applying the other filters keeps it", alex.url().includes("who=mine"), true);

await alex.goto(`${BASE}/pipeline?moved=7&who=mine`);
c.is("what moved knows it too", await alex.locator('[data-testid="moved-owner"]').count(), 1);

await alex.goto(`${BASE}/activity?who=mine`);
c.is("activity knows it", await alex.locator('[data-testid="activity-owner"]').count(), 1);
const act = await alex.innerText("body");
c.is("and narrows to my accounts", act.includes(myDeal) && !act.includes(theirDeal), true);

// Handing an account over is a dated line in history like any other change,
// and it names the person rather than printing their id.
await alex.goto(`${BASE}/activity?days=1`);
const feed = await alex.innerText("body");
c.is("the handover is in the record", /runs this account|owner/i.test(feed), true);
c.is("and names a person, not a uuid", feed.includes(second), true);

await browser.close();
process.exit(c.done() ? 0 : 1);
