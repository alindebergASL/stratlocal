// SYNTHETIC ONLY: invented sandbox account, two seeded e2e logins, fake AI.
//
// Two signed-in sessions with the same account open. One saves; the other is
// told, quietly, and then decides for itself what to do about it.
//
// What this has to prove, in order:
//   1. Nothing reloads on its own. The notice appears; the screen does not
//      change under anyone's hands, and no RSC request goes out unasked.
//   2. Refresh brings the new server data in — really in, not a button that
//      clears a notice and calls it done.
//   3. What is half-written survives that refresh, and so does the version it
//      was written against: a draft kept while the base version quietly moved
//      on is not preservation, it is the collision check being switched off.
//   4. Where work cannot survive a refresh, the refresh is deferred and says
//      so, rather than taking the work.
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { BASE, checker, launch, signIn, openTab } from "./browser.mjs";

if (!process.env.E2E_DB_PATH?.includes("strategy-e2e-")) throw Error("Disposable e2e DB required");

const browser = await launch();
const c = checker("partner change freshness");
const alex = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);
const jamie = await signIn(browser, process.env.E2E_USER2_EMAIL, process.env.E2E_USER2_PASSWORD);
const db = new Database(process.env.E2E_DB_PATH);

const NOTICE = '[data-testid="freshness-notice"]';
const REFRESH = '[data-testid="freshness-refresh"]';

// Polling is every 25 seconds, which no test should sit through. Coming back
// to a page is the other half of the contract and the fast half: the watcher
// checks on focus and on becoming visible.
async function wake(page) {
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

async function noticeAppears(page) {
  await wake(page);
  try {
    await page.waitForSelector(NOTICE, { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

// Every RSC fetch this page makes that nobody asked for. router.refresh sends
// RSC: 1 without the prefetch header, so a quiet window with a count of zero
// is the page genuinely leaving the screen alone.
function watchRsc(page) {
  const state = { count: 0 };
  page.on("request", (r) => {
    const h = r.headers();
    if (h["rsc"] === "1" && !h["next-router-prefetch"]) state.count += 1;
  });
  return state;
}

async function form(page, id) {
  const trigger = page.locator(`[data-testid="${id}-open"]`);
  if (await trigger.count()) await trigger.click();
  return {
    fill: (name, value) => page.fill(`[data-testid="${id}"] [name="${name}"]`, value),
    async save() {
      await page.click(`[data-testid="${id}-submit"]`);
      await page.waitForTimeout(1200);
    },
  };
}

try {
  // ---- an account with a deal and a meeting on it -------------------------
  const newAccount = await form(alex, "account-new");
  await newAccount.fill("name", "Synthetic Tidewater Instruments");
  await newAccount.save();
  await alex.waitForURL(/\/accounts\//, { timeout: 15_000 });
  const accountUrl = alex.url();
  const accountId = new URL(accountUrl).pathname.split("/")[2];

  await openTab(alex, "deals");
  const newDeal = await form(alex, "deal-new");
  await newDeal.fill("name", "Imaging platform refresh");
  await newDeal.fill("tcv_usd", "1K");
  await newDeal.save();

  await openTab(alex, "meetings");
  await alex.click('[data-testid="meeting-new-open"]');
  await alex.fill('[data-testid="meeting-new"] [name="title"]', "Platform planning call");
  await alex.fill('[data-testid="meeting-new"] [name="held_at"]', "2027-03-11");
  await alex.click('[data-testid="meeting-new-submit"]');
  await alex.waitForURL(/\/meetings\//, { timeout: 15_000 });
  const meetingUrl = alex.url();
  const meetingId = new URL(meetingUrl).pathname.split("/").at(-1);

  await alex.getByRole("button", { name: "Prepare this meeting", exact: true }).click();
  await alex.waitForSelector('[data-testid="brief-conversation"]', { timeout: 60_000 });

  const counts = () => ({
    runs: db.prepare("SELECT COUNT(*) n FROM ai_runs WHERE account_id=?").get(accountId).n,
    items: db.prepare("SELECT COUNT(*) n FROM action_items WHERE account_id=?").get(accountId).n,
    changes: db.prepare("SELECT COUNT(*) n FROM change_log WHERE account_id=?").get(accountId).n,
  });
  const brief = () => db.prepare("SELECT brief_json FROM meetings WHERE id=?").get(meetingId).brief_json;

  // ---- 1. one saves, the other is told and nothing else happens -----------
  await alex.goto(accountUrl);
  await openTab(alex, "deals");
  const rsc = watchRsc(alex);
  c.is("no notice on a page nobody has changed under", await alex.locator(NOTICE).count(), 0);

  // A malformed FIRST poll must not poison every subsequent comparison.
  const recovering = await alex.context().newPage();
  let malformedPolls = 0;
  await recovering.route("**/freshness", async route => {
    malformedPolls++;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ revision: "not-a-cursor" }) });
  });
  await recovering.goto(accountUrl);
  // Wait for the intercepted request, not a guessed hydration delay. A focus
  // event before the client listener mounts cannot exercise this fixture.
  const malformedDeadline = Date.now() + 10_000;
  while (malformedPolls === 0 && Date.now() < malformedDeadline) {
    await wake(recovering);
    await recovering.waitForTimeout(100);
  }
  c.is("the initial malformed cursor fixture was exercised", malformedPolls > 0, true);
  await recovering.unroute("**/freshness");

  await jamie.goto(accountUrl);
  await openTab(jamie, "deals");
  await jamie.click('[data-testid^="deal-quick-"]');
  await jamie.fill('form [name="next_step"]', "Confirm the imaging sizing numbers");
  await jamie.click('form button[type="submit"]:has-text("Save")');
  await jamie.waitForTimeout(1500);

  const quiet = rsc.count;
  c.is("the other session is told", await noticeAppears(alex), true);
  c.is("a valid poll recovers after malformed initial cursors", await noticeAppears(recovering), true);
  await recovering.close();
  c.is("the notice names nobody", (await alex.innerText(NOTICE)).toLowerCase().includes("jamie"), false);
  c.is("nothing refreshed on its own", rsc.count, quiet);
  c.is("the screen still holds the data it was rendered with", (await alex.innerText("body")).includes("Confirm the imaging sizing numbers"), false);
  if (process.env.E2E_ARTIFACT_DIR) {
    mkdirSync(process.env.E2E_ARTIFACT_DIR, { recursive: true });
    const oldViewport = alex.viewportSize();
    for (const width of [1440, 390, 320]) {
      await alex.setViewportSize({ width, height: 950 });
      c.is(`freshness notice fits at ${width}px`, await alex.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await alex.screenshot({ path: join(process.env.E2E_ARTIFACT_DIR, `notice-${width}.png`) });
    }
    if (oldViewport) await alex.setViewportSize(oldViewport);
  }

  // A poll that fails says nothing — least of all that the page is current.
  await alex.route("**/freshness", (route) => route.abort());
  await wake(alex);
  await alex.waitForTimeout(600);
  await alex.route("**/freshness", (route) => route.fulfill({ status: 200, body: "not json at all" }));
  await wake(alex);
  await alex.waitForTimeout(600);
  c.is("a failed or unreadable poll keeps the notice", await alex.locator(NOTICE).count(), 1);
  await alex.unroute("**/freshness");

  // ---- 2. an explicit refresh, and only that, brings the change in --------
  const beforeRefresh = counts();
  await alex.click(REFRESH);
  await alex.waitForSelector(NOTICE, { state: "detached", timeout: 15_000 });
  await openTab(alex, "deals");
  c.is("refreshing shows what they saved", (await alex.innerText("body")).includes("Confirm the imaging sizing numbers"), true);
  c.is("refreshing writes nothing", JSON.stringify(counts()), JSON.stringify(beforeRefresh));
  c.is("refreshing makes no AI call", counts().runs, beforeRefresh.runs);

  // ---- 3. notes: clean adopts, a draft is kept with its own base version --
  await alex.goto(meetingUrl);
  await jamie.goto(meetingUrl);
  await jamie.fill('[name="raw_notes"]', "Jamie's note: they asked for the sizing numbers before the review.");
  await jamie.click('button:has-text("Save only")');
  await jamie.waitForTimeout(1500);

  c.is("the meeting page is told too", await noticeAppears(alex), true);
  c.is("notes on screen are still the ones this page loaded", await alex.inputValue('[name="raw_notes"]'), "");
  await alex.click(REFRESH);
  await alex.waitForSelector(NOTICE, { state: "detached", timeout: 15_000 });
  // The notice disappears when the new server revision commits; clean-note
  // adoption follows in the provider's effect. Wait for the observable editor
  // result, not the earlier notice removal, without relaxing the assertion.
  await alex.waitForFunction(() => document.querySelector('[name="raw_notes"]')?.value.includes("Jamie's note"), undefined, { timeout: 15_000 });
  c.is("a notes box holding nothing takes the newly loaded notes", (await alex.inputValue('[name="raw_notes"]')).includes("Jamie's note"), true);

  // Now with something of Alex's own in it, unsaved.
  const draft = "Alex's draft: walk the procurement team through the phased plan before any numbers go out.";
  await alex.fill('[name="raw_notes"]', draft);
  await jamie.reload();
  await jamie.fill('[name="raw_notes"]', "Jamie's second note: the review moved to the following week.");
  await jamie.click('button:has-text("Save only")');
  await jamie.waitForTimeout(1500);

  c.is("a draft does not stop the notice", await noticeAppears(alex), true);
  await alex.click(REFRESH);
  await alex.waitForSelector(NOTICE, { state: "detached", timeout: 15_000 });
  c.is("the draft survives the refresh untouched", await alex.inputValue('[name="raw_notes"]'), draft);
  c.is("the notes the refresh loaded are not silently merged in", (await alex.inputValue('[name="raw_notes"]')).includes("second note"), false);

  // The version this draft was typed against went with it, so saving it is
  // still a collision — which it would not be if the refresh had adopted the
  // new version behind the draft.
  await alex.click('button:has-text("Save only")');
  await alex.waitForTimeout(1800);
  const refusal = alex.locator('[role="alert"]:has-text("Not saved")');
  c.is("saving the draft is refused against the version it was written on", await refusal.count(), 1);
  // Notes are a large field, so the refusal reports their size and who wrote
  // them rather than quoting the text back at you.
  c.is("the refusal names who saved over it", (await refusal.innerText()).includes("Jamie"), true);
  c.is("the draft is still in the box after the refusal", await alex.inputValue('[name="raw_notes"]'), draft);
  c.is("nothing of Jamie's was overwritten", db.prepare("SELECT raw_notes FROM meetings WHERE id=?").get(meetingId).raw_notes.includes("second note"), true);

  // ---- 4. an open brief handoff keeps everything it was opened with -------
  await alex.goto(meetingUrl);
  await alex.click('[data-testid="brief-follow-up-open"]');
  const handoff = "Schedule the phased-plan walkthrough with procurement";
  await alex.fill('[data-testid="brief-follow-up-text"]', handoff);
  await alex.selectOption('[data-testid="brief-follow-up-owner"]', { label: "Alex" });
  await alex.fill('[data-testid="brief-follow-up-due"]', "2027-03-18");
  const openedFingerprint = await alex.getAttribute('[data-testid="brief-follow-up"] [name="brief_fingerprint"]', "value");

  // Jamie changes what the brief is written from, then regenerates it: the
  // stored brief — and its fingerprint — really move.
  const briefBefore = brief();
  await jamie.goto(accountUrl);
  await openTab(jamie, "deals");
  await jamie.click('[data-testid^="deal-quick-"]');
  await jamie.fill('form [name="next_step"]', "Send the phased plan to procurement");
  await jamie.click('form button[type="submit"]:has-text("Save")');
  await jamie.waitForTimeout(1200);
  await jamie.goto(meetingUrl);
  await jamie.getByRole("button", { name: "Regenerate", exact: true }).click();
  for (let i = 0; i < 120 && brief() === briefBefore; i++) await jamie.waitForTimeout(500);
  c.is("the stored brief really changed", brief() !== briefBefore, true);

  const beforeHandoff = counts();
  c.is("the open handoff is told", await noticeAppears(alex), true);
  await alex.click(REFRESH);
  await alex.waitForSelector(NOTICE, { state: "detached", timeout: 15_000 });
  c.is("the handoff form is still open", await alex.locator('[data-testid="brief-follow-up"]').count(), 1);
  c.is("what was typed into it survives", await alex.inputValue('[data-testid="brief-follow-up-text"]'), handoff);
  c.is("the owner chosen survives", (await alex.inputValue('[data-testid="brief-follow-up-owner"]')).length > 0, true);
  c.is("the date agreed survives", await alex.inputValue('[data-testid="brief-follow-up-due"]'), "2027-03-18");
  c.is("it still cites the brief it was opened on", await alex.getAttribute('[data-testid="brief-follow-up"] [name="brief_fingerprint"]', "value"), openedFingerprint);

  await alex.click('[data-testid="brief-follow-up-submit"]');
  await alex.waitForTimeout(1800);
  const stale = await alex.locator('[data-testid="brief-follow-up"] [role="alert"], [data-testid="brief-follow-up-stale"]').count();
  c.is("a handoff from the brief that has since changed is refused", stale > 0, true);
  c.is("and nothing was written for it", counts().items, beforeHandoff.items);
  c.is("and it made no AI call", counts().runs, beforeHandoff.runs);
  c.is("what was typed is still there to carry across", await alex.inputValue('[data-testid="brief-follow-up-text"]'), handoff);

  // ---- 5. work a refresh would destroy defers it, truthfully -------------
  await alex.goto(accountUrl);
  await openTab(alex, "follow-ups");
  await alex.click('[data-testid="follow-up-add"]');
  await alex.fill('[data-testid="follow-up-form"] [name="text"]', "Half-written follow-up about the sizing numbers");
  await jamie.goto(accountUrl);
  await openTab(jamie, "deals");
  await jamie.click('[data-testid^="deal-quick-"]');
  await jamie.fill('form [name="next_step"]', "Agree the review date with their team");
  await jamie.click('form button[type="submit"]:has-text("Save")');
  await jamie.waitForTimeout(1200);

  c.is("an open editor still gets the notice", await noticeAppears(alex), true);
  c.is("the refresh is deferred rather than taking the work", await alex.locator(REFRESH).count(), 0);
  c.is("and it says what is holding it", (await alex.innerText('[data-testid="freshness-deferred"]')).length > 10, true);
  c.is("what was typed is untouched", await alex.inputValue('[data-testid="follow-up-form"] [name="text"]'), "Half-written follow-up about the sizing numbers");

  await alex.click('[data-testid="follow-up-form"] button:has-text("Cancel")');
  await alex.waitForSelector(REFRESH, { timeout: 10_000 });
  await alex.click(REFRESH);
  await alex.waitForSelector(NOTICE, { state: "detached", timeout: 15_000 });
  await openTab(alex, "deals");
  c.is("once it is put away the refresh goes through", (await alex.innerText("body")).includes("Agree the review date"), true);

  // A partner archives a deal while its inline editor holds a draft.
  const dealHref = await alex.locator('a[href*="/deals/"]').first().getAttribute('href');
  await openTab(alex, "deals");
  await alex.click('[data-testid^="deal-quick-"]');
  await alex.fill('form [name="next_step"]', 'Keep this unsaved sizing draft');
  await jamie.goto(`${BASE}${dealHref}`);
  await jamie.getByRole('button', {name:'Archive Imaging platform refresh', exact:true}).click();
  await jamie.getByRole('button', {name:'Confirm archiving Imaging platform refresh', exact:true}).click();
  await jamie.waitForTimeout(1200);
  c.is('archiving an edited deal still notifies', await noticeAppears(alex), true);
  c.is('refresh cannot unmount the archived deal draft', await alex.locator(REFRESH).count(), 0);
  c.is('the archived deal draft remains readable', await alex.inputValue('form [name="next_step"]'), 'Keep this unsaved sizing draft');
  await alex.locator('form').filter({has:alex.locator('[name="next_step"]')}).getByRole('button',{name:'Cancel',exact:true}).click();
  await alex.click(REFRESH);
  await alex.waitForSelector(NOTICE,{state:'detached'});
  c.is('after explicit cancel and refresh the archived deal leaves the list', await alex.locator('[data-testid^="deal-quick-"]').count(), 0);

  // ---- 6. the endpoint itself -------------------------------------------
  const mine = await alex.request.get(`${BASE}/api/accounts/${accountId}/freshness`);
  const body = await mine.json();
  c.is("an authenticated read answers", mine.status(), 200);
  c.is("with a cursor and nothing else", JSON.stringify(Object.keys(body)), '["revision"]');
  c.is("and is not cached", mine.headers()["cache-control"], "no-store");
  c.is("an unknown account is refused", (await alex.request.get(`${BASE}/api/accounts/not-an-account/freshness`)).status(), 404);
  const stranger = await browser.newContext();
  c.is("a caller who is not signed in is refused", (await stranger.request.get(`${BASE}/api/accounts/${accountId}/freshness`)).status(), 401);
  await stranger.close();
  // Unsupported review/import surfaces must not gain a new refresh control.
  let unsupportedPolls = 0;
  await alex.route('**/freshness', async route => {
    unsupportedPolls++;
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({revision:'999999.999999'})});
  });
  for (const suffix of ['research','review','import','import-sheet']) {
    await alex.goto(`${accountUrl}/${suffix}`);
    await wake(alex);
    await alex.waitForTimeout(350);
    c.is(`no new refresh control on ${suffix}`, await alex.locator(REFRESH).count(), 0);
  }
  c.is('unsupported screens do not poll', unsupportedPolls, 0);
  await alex.unroute('**/freshness');

  // Exercise the actual scheduled poll without adding a wall-clock wait.
  const timerPage = await alex.context().newPage();
  await timerPage.clock.install();
  const initialPoll = timerPage.waitForResponse(r => r.url().endsWith('/freshness'));
  await timerPage.goto(accountUrl);
  await initialPoll;
  await timerPage.waitForTimeout(100);
  const scheduledPoll = timerPage.waitForResponse(r => r.url().endsWith('/freshness'));
  await timerPage.clock.fastForward(25_100);
  c.is("the scheduled poll runs while visible", (await scheduledPoll).status(), 200);
  await timerPage.close();

  // ---- 7. moving between pages under one account ------------------------
  // The cursor the notice compares against is rendered by the account layout,
  // and a client navigation beneath that layout re-renders the page, not the
  // layout. So the question: after the other one writes, does walking from
  // the Meetings tab to a meeting (whose page was just rendered from the server,
  // and is current) show a notice over data that is already current?
  const walker = await alex.context().newPage();
  await walker.goto(`${accountUrl}/meetings`);
  await wake(walker);
  await walker.waitForTimeout(400);
  c.is("a fresh Meetings tab carries no notice", await walker.locator(NOTICE).count(), 0);
  await walker.click('[data-testid="meeting-row-title"]');
  await walker.waitForURL(/\/meetings\//);
  await wake(walker);
  await walker.waitForTimeout(600);
  c.is("walking to a meeting with nothing changed shows no notice", await walker.locator(NOTICE).count(), 0);
  await walker.goto(`${accountUrl}/meetings`);
  await wake(walker);
  await walker.waitForTimeout(400);
  await jamie.goto(meetingUrl);
  await jamie.fill('[name="raw_notes"]', "Jamie's note after the walk: the sizing numbers were re-checked.");
  await jamie.click('button:has-text("Save only")');
  await jamie.waitForTimeout(1500);
  await walker.click('[data-testid="meeting-row-title"]');
  await walker.waitForURL(/\/meetings\//);
  await wake(walker);
  await walker.waitForTimeout(600);
  // Notes live in a textarea, whose value innerText does not carry.
  c.is("the walk shows their note, because the page was rendered after it", (await walker.inputValue('[name="raw_notes"]')).includes("the sizing numbers were re-checked"), true);
  c.is("and no notice over data that already includes it", await walker.locator(NOTICE).count(), 0);
  // The layout's cursor is still the old one; the page's is what counts now.
  // A further change after the walk must still be noticed from here.
  await jamie.fill('[name="raw_notes"]', "Jamie's second note after the walk: the review is Thursday.");
  await jamie.click('button:has-text("Save only")');
  await jamie.waitForTimeout(1500);
  c.is("a change after the walk is still noticed", await noticeAppears(walker), true);
  await walker.close();
} finally {
  db.close();
  await browser.close();
}

process.exit(c.done() ? 0 : 1);
