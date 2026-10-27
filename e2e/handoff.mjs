// Handing an account over, and the link that carries it.
//
// The library tests prove the snapshot keeps its word and that every way of a
// link not working does not work. What they cannot prove is the one thing
// this feature is for: that somebody with no session can open the URL and read
// it. So this flow uses a browser context with no cookies at all — a stranger,
// not a signed-out copy of the sender — and checks both directions: that the
// stranger can read it while it is live, and cannot the moment it is ended.
import { BASE, checker, launch, signIn, openTab } from "./browser.mjs";

const browser = await launch();
const c = checker("a handoff, and a link somebody without a login can read");
const alex = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);

// Nobody. A fresh context shares nothing with the signed-in one, which is what
// makes "can a stranger read this" a real question rather than a cookie left
// over from two lines above.
const stranger = await (await browser.newContext()).newPage();

const trigger = alex.locator('[data-testid="account-new-open"]');
if (await trigger.count()) await trigger.click();
await alex.fill('[data-testid="account-new"] [name="name"]', "Synthetic Orchard Lab");
await alex.click('[data-testid="account-new-submit"]');
await alex.waitForURL(/\/accounts\//, { timeout: 15000 });
const accountUrl = alex.url();

await openTab(alex, "deals");
await alex.click('[data-testid="deal-new-open"]');
await alex.fill('[data-testid="deal-new"] [name="deal_id"]', "SYN-DEAL-001");
await alex.fill('[data-testid="deal-new"] [name="name"]', "SyntheticOrchard_EHR-Refresh");
await alex.fill('[data-testid="deal-new"] [name="tcv_usd"]', "1K");
await alex.click('[data-testid="deal-new-submit"]');
await alex.waitForTimeout(1500);

// The affordance has to be on the account page, not only at a URL.
await alex.goto(accountUrl);
c.is("the account page offers it", await alex.locator('[data-testid="handoff-link"]').count(), 1);
if (!(await alex.locator("#account-tools").evaluate(el => el.open))) await alex.locator("#account-tools > summary").click();
await alex.click('[data-testid="handoff-link"]');
await alex.waitForURL(/\/handoff$/, { timeout: 15000 });

const ASK = "Keep the quarterly cadence with their infrastructure director — she is the one who decides.";
await alex.fill('[data-testid="handoff-new"] [name="asks"]', ASK);
await alex.selectOption('[data-testid="handoff-new"] [name="share_days"]', "7");
await alex.click('[data-testid="handoff-new-submit"]');
await alex.waitForURL(/\/handoff\/[^/]+$/, { timeout: 15000 });
const handoffUrl = alex.url();

const link = (await alex.innerText('[data-testid="share-link"]')).trim();
c.is("the link is shown in full, not hidden behind a button", link.startsWith(`${BASE}/s/`), true);
// The whole address is the token; nothing in it names the account.
c.is("and carries no account id", link.includes(accountUrl.split("/accounts/")[1]), false);

const preview = await alex.innerText("body");
c.is("the sender sees what will be sent", preview.includes(ASK), true);
c.is("including the pipeline", preview.includes("SyntheticOrchard_EHR-Refresh"), true);

// The question the whole feature exists to answer.
await stranger.goto(link);
const read = await stranger.innerText("body");
c.is("a stranger can read it", read.includes(ASK), true);
c.is("and sees the deals", read.includes("SyntheticOrchard_EHR-Refresh"), true);
// Nothing on it leads back into the app, and nothing on it can be pressed.
c.is("with nothing to press", await stranger.locator("button").count(), 0);
c.is("and no way into the app", await stranger.locator('a[href^="/accounts"]').count(), 0);
c.is("and no sign-in prompt", /sign in|password/i.test(read), false);

// A snapshot: the account moving on does not rewrite what they are reading.
await alex.goto(accountUrl);
await openTab(alex, "deals");
await alex.click('[data-testid="deal-new-open"]');
await alex.fill('[data-testid="deal-new"] [name="name"]', "SyntheticOrchard_Added-Afterwards");
await alex.fill('[data-testid="deal-new"] [name="tcv_usd"]', "900k");
await alex.click('[data-testid="deal-new-submit"]');
await alex.waitForTimeout(1500);
await stranger.reload();
c.is("what was sent does not change underneath them", (await stranger.innerText("body")).includes("SyntheticOrchard_Added-Afterwards"), false);

// Ending the link ends it, for the person already holding it.
await alex.goto(handoffUrl);
await alex.click('[data-testid="revoke-share-open"]');
await alex.click('[data-testid="revoke-share-submit"]');
await alex.waitForTimeout(1500);
await stranger.goto(link);
const afterRevoke = await stranger.innerText("body");
c.is("the stranger is refused afterwards", afterRevoke.includes(ASK), false);
// And is told nothing about whether that token was ever real.
c.is("without being told why", /expired|revoked|ended/i.test(afterRevoke), false);

// The handoff itself stays, and can be shared again at a new address.
await alex.goto(handoffUrl);
c.is("the handoff is still here", (await alex.innerText("body")).includes(ASK), true);
c.is("and says the link is off", await alex.locator('[data-testid="share-off"]').count(), 1);
await alex.click('[data-testid="reshare-open"]');
await alex.click('[data-testid="reshare-submit"]');
await alex.waitForTimeout(1500);
const fresh = (await alex.innerText('[data-testid="share-link"]')).trim();
c.is("sharing again gives a different address", fresh !== link, true);
await stranger.goto(fresh);
c.is("the new one works", (await stranger.innerText("body")).includes(ASK), true);
await stranger.goto(link);
c.is("and the old one stays dead", (await stranger.innerText("body")).includes(ASK), false);

// A token nobody issued is the same 404 as one that was ended.
await stranger.goto(`${BASE}/s/${"a".repeat(43)}`);
c.is("an invented token opens nothing", (await stranger.innerText("body")).includes(ASK), false);

// A second handoff, this one with a word on it.
//
// The library tests prove the mechanism. What only a browser can prove is the
// thing the feature is actually for: that holding the address is no longer
// enough, and that the snapshot is not merely hidden by CSS or sitting in the
// markup behind a form.
const GUARDED_ASK = "Take the storage refresh to their infrastructure director before the end of the quarter.";
const WORD = "harbour-lantern-42";

await alex.goto(`${accountUrl}/handoff`);
await alex.fill('[data-testid="handoff-new"] [name="asks"]', GUARDED_ASK);
await alex.fill('[data-testid="handoff-new"] [name="passphrase"]', WORD);
await alex.click('[data-testid="handoff-new-submit"]');
await alex.waitForURL(/\/handoff\/[^/]+$/, { timeout: 15000 });
const guardedLink = (await alex.innerText('[data-testid="share-link"]')).trim();
c.is("the sender is told the link needs the word", /passphrase/i.test(await alex.innerText('[data-testid="share-warning"]')), true);

// A stranger with no cookies at all, which is what a forwarded link is.
const outsider = await (await browser.newContext()).newPage();
await outsider.goto(guardedLink);
const locked = await outsider.innerText("body");
c.is("the address alone does not open it", locked.includes(GUARDED_ASK), false);
// Not hidden — absent. A snapshot rendered and then covered would still be in
// the markup, which is the failure this check exists for.
c.is("and the account is not in the page at all", (await outsider.content()).includes("SyntheticOrchard_EHR-Refresh"), false);
c.is("it asks for the passphrase", await outsider.locator('[data-testid="passphrase"]').count(), 1);

await outsider.fill('[data-testid="passphrase"]', "not-the-word");
await outsider.click('[data-testid="passphrase-submit"]');
await outsider.waitForSelector('[data-testid="passphrase-error"]', { timeout: 15000 });
c.is("a wrong word is refused", (await outsider.innerText("body")).includes(GUARDED_ASK), false);

await outsider.fill('[data-testid="passphrase"]', WORD);
await outsider.click('[data-testid="passphrase-submit"]');
await outsider.waitForFunction((ask) => document.body.innerText.includes(ask), GUARDED_ASK, { timeout: 15000 });
c.is("the right word opens it", (await outsider.innerText("body")).includes(GUARDED_ASK), true);

// The whole reason for the cookie: a reload must not ask again.
await outsider.reload();
c.is("and it stays open on a reload", (await outsider.innerText("body")).includes(GUARDED_ASK), true);

// Somebody else the link was forwarded to has answered nothing, so the fact
// that one reader got in does not let the next one skip the box.
const third = await (await browser.newContext()).newPage();
await third.goto(guardedLink);
c.is("a second stranger still has to answer", await third.locator('[data-testid="passphrase"]').count(), 1);

await browser.close();
process.exit(c.done() ? 0 : 1);
