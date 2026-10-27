// What the screen says when it does not know what happened.
//
// The fault is injected in the browser, not in the app: the request is let
// through to the server with `route.fetch()` — so the write really is
// committed — and only then is the reply thrown away. That is the shape of a
// dropped connection on a mobile network, and the shape the app used to get
// wrong: it said "Nothing was applied" about a change the server had already
// applied, and invited a second Accept on top of it.
//
// AI_FAKE=1, one synthetic account, one synthetic proposal. Nothing here reads
// or writes anything outside the throwaway database `e2e/run.mjs` builds.
import { checker, launch, signIn, openTab } from "./browser.mjs";
import Database from "better-sqlite3";

const browser = await launch();
const c = checker("a lost reply is reported as unknown, not as a refusal");
const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);

// ---- an account with one meeting's worth of proposals ------------------------

const trigger = page.locator('[data-testid="account-new-open"]');
if (await trigger.count()) await trigger.click();
await page.fill('[data-testid="account-new"] [name="name"]', "Synthetic Halberd Freight");
await page.click('[data-testid="account-new-submit"]');
await page.waitForURL(/\/accounts\//, { timeout: 15000 });
const accountUrl = page.url();

// Meeting notes are the shortest path to a queue of ordinary proposals: paste,
// extract, and the account has changes waiting for a decision.
await openTab(page, "meetings");
await page.click('[data-testid="meeting-new-open"]');
await page.fill('[data-testid="meeting-new"] [name="title"]', "Quarterly review");
await page.fill('[data-testid="meeting-new"] [name="held_at"]', "2026-09-15");
await page.click('[data-testid="meeting-new-submit"]');
await page.waitForURL(/\/meetings\//, { timeout: 15000 });
const meetingUrl = page.url();
await page.fill('textarea[name="raw_notes"]', "Rowan Example is the new head of logistics. Follow up: send the depot modernisation outline by Friday.");
await page.click('button:has-text("Save and extract")');
// The meeting page deals changes one card at a time by default; the list,
// which this flow drives, is one click away.
await page.getByTestId("review-as-list").click({ timeout: 60000 });
await page.waitForSelector('[data-testid="accept-all"]', { timeout: 15000 });

const before = await page.locator('[data-testid="proposal-row"]').count();
c.is("there are proposals to decide on", before > 0, true);

// ---- single: a 200 that says nothing is not a success -----------------------

// The row is held by its own id, not by "the row that has an Accept button":
// that filter re-resolves on every use and walks to the next row the moment
// the button it matched on disappears — which is exactly what an outcome does.
const firstId = await page.locator('[data-testid="proposal-row"]').filter({ hasText: 'New follow-up:' }).first().getAttribute("data-proposal-id");
c.is("a proposal row carries its id", !!firstId, true);
const row = page.locator(`[data-proposal-id="${firstId}"]`);
const ack = row.locator('input[type="checkbox"]');
if (await ack.count()) await ack.first().check();
// A fragment of what this proposal would write, so the record it becomes can
// be recognised on the account afterwards — and counted.
const written = (await row.innerText()).split('\n')[0].replace(/^New follow-up:\s*/, '').trim();
c.is("the proposal says what it would write", !!written, true);

let emptyPosts = 0;
await page.route("**/api/proposals/*", async (route) => {
  if (route.request().method() !== "POST") return route.continue();
  emptyPosts += 1;
  await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
});
await row.locator('[data-testid="row-accept"]').click();
await page.waitForSelector(`[data-proposal-id="${firstId}"] [data-testid="unknown-outcome"]`, { timeout: 15000 });
const onEmpty = (await row.innerText()).replace(/\s+/g, " ");
c.is("the empty 200 was the only POST", emptyPosts, 1);
c.is("a 200 with an empty body is not reported as accepted", /\baccepted\b/i.test(onEmpty), false);
c.is("it is reported as unknown", /Outcome unknown/i.test(onEmpty), true);
await page.unroute("**/api/proposals/*");

// The recheck is a read, and the server still has this one waiting: the
// decision comes back rather than being stranded behind a failure badge.
await row.locator('[data-testid="recheck-outcome"]').click();
await page.waitForSelector(`[data-proposal-id="${firstId}"] [data-testid="row-accept"]`, { timeout: 15000 });
const backAgain = (await row.innerText()).replace(/\s+/g, " ");
c.is("the read says the server still has it waiting", /still has this waiting/i.test(backAgain), true);
c.is("the evidence acknowledgement survived the check", (await ack.count()) === 0 || (await ack.first().isChecked()), true);

// ---- single: the server commits and the gateway answers 502 -----------------

// Fault-injected metadata keeps a notice visible while the real decision runs.
await page.route('**/freshness', route => route.fulfill({status:200,contentType:'application/json',body:'{"revision":"999999.999999"}'}));
await page.evaluate(() => window.dispatchEvent(new Event('focus')));
await page.waitForSelector('[data-testid="freshness-refresh"]');
let releaseGateway;
const delayedGateway = new Promise(resolve => { releaseGateway = resolve; });
let gatewayStatus = null;
await page.route("**/api/proposals/*", async (route) => {
  if (route.request().method() !== "POST") return route.continue();
  const response = await route.fetch(); // the write happens
  gatewayStatus = response.status();
  await delayedGateway;
  await route.fulfill({ status: 502, contentType: "text/html", body: "<html><body>502 Bad Gateway</body></html>" });
});
await row.locator('[data-testid="row-accept"]').click();
await page.waitForSelector('[data-testid="freshness-deferred"]');
c.is('pending individual decision holds global refresh', await page.locator('[data-testid="freshness-refresh"]').count(), 0);
releaseGateway();
await page.waitForSelector(`[data-proposal-id="${firstId}"] [data-testid="unknown-outcome"]`, { timeout: 15000 });
const said = (await row.innerText()).replace(/\s+/g, " ");
c.is("the server did apply it", gatewayStatus, 200);
c.is("a 502 after a commit does not claim nothing was applied", /Nothing was applied/.test(said), false);
c.is("it says the outcome is unknown", /Outcome unknown/i.test(said), true);
c.is("and does not claim success either", /\baccepted\b/.test(said), false);
c.is("no Accept button is left to press again", await row.locator('[data-testid="row-accept"]').count(), 0);
c.is("a status recheck is offered", await row.locator('[data-testid="recheck-outcome"]').count(), 1);
c.is('unknown individual outcome holds refresh', await page.locator('[data-testid="freshness-refresh"]').count(), 0);
await page.unroute("**/api/proposals/*");

// ---- reconciling from the server's own record -------------------------------

let singlePosts = 0;
await page.route("**/api/proposals/*", async (route) => {
  if (route.request().method() === "POST") singlePosts += 1;
  return route.continue();
});
await row.locator('[data-testid="recheck-outcome"]').click();
await page.waitForTimeout(1500);
const after = (await row.innerText()).replace(/\s+/g, " ");
c.is("the recheck resolves it to what the server has", /accepted/i.test(after), true);
c.is("and the unknown banner is gone", await row.locator('[data-testid="unknown-outcome"]').count(), 0);
c.is("the recheck wrote nothing", singlePosts, 0);
c.is('settled individual outcome releases refresh', await page.locator('[data-testid="freshness-refresh"]').count(), 1);
await page.unroute("**/api/proposals/*");

// The record was written once, by the request whose reply the gateway ate —
// the recheck is a read, so nothing was applied twice.
await page.goto(`${accountUrl}`);
const accountText = (await page.innerText("body")).replace(/\s+/g, " ");
if (written) {
  const occurrences = accountText.split(written).length - 1;
  c.is("what the accepted change wrote is on the account", occurrences > 0, true);
  // The planning preview intentionally repeats open work above the full list.
  // Count canonical rows and persisted records, not mentions across surfaces.
  c.is("one canonical task row, not two", await page.locator('li[id^="action-"]').filter({ hasText: written }).count(), 1);
  const stored = new Database(process.env.E2E_DB_PATH, { readonly: true });
  const proposal = stored.prepare("SELECT account_id, payload_json FROM proposals WHERE id=?").get(firstId);
  const taskText = JSON.parse(proposal.payload_json).text;
  c.is("exactly one persisted task after a lost reply", stored.prepare("SELECT COUNT(*) n FROM action_items WHERE account_id=? AND text=?").get(proposal.account_id, taskText).n, 1);
  stored.close();
}

// ---- bulk: the batch is committed and the reply is lost ---------------------

await page.goto(meetingUrl);
await page.getByTestId("review-as-list").click({ timeout: 15000 });
await page.waitForSelector('[data-testid="accept-all"]', { timeout: 15000 });
const batch = await page.locator('[data-testid="proposal-row"]').count();
c.is("the meeting still has a batch to decide on", batch > 0, true);

// A failed bulk reply with no write is reconciled to pending via real GETs.
// Keep the component mounted to catch stale allUnknown holding refresh forever.
await page.evaluate(() => window.dispatchEvent(new Event('focus')));
await page.waitForSelector('[data-testid="freshness-refresh"]');
await page.route('**/proposals/accept-all', route => route.fulfill({status:503,contentType:'application/json',body:'{}'}));
await page.click('[data-testid="accept-all"]');
await page.waitForSelector('[data-testid="accept-all-unknown"]');
c.is('bulk uncertainty holds refresh', await page.locator('[data-testid="freshness-refresh"]').count(), 0);
await page.unroute('**/proposals/accept-all');
const pendingIds = await page.locator('[data-testid="proposal-row"]').evaluateAll(rows => rows.map(row => row.getAttribute('data-proposal-id')));
for (const id of pendingIds) {
  await page.locator(`[data-proposal-id="${id}"] [data-testid="recheck-outcome"]`).click();
  await page.locator(`[data-proposal-id="${id}"] [data-testid="row-accept"]`).waitFor();
}
await page.waitForSelector('[data-testid="freshness-refresh"]');
c.is('reconciled mounted batch releases refresh', await page.locator('[data-testid="freshness-refresh"]').count(), 1);
c.is('the no-write batch still awaits decisions', await page.locator('[data-testid="row-accept"]').count(), batch);

let bulkStatus = null;
let bulkPosts = 0;
await page.route("**/proposals/accept-all", async (route) => {
  bulkPosts += 1;
  const response = await route.fetch(); // every one of them is committed
  bulkStatus = response.status();
  await route.abort("failed"); // and the answer never comes back
});
await page.click('[data-testid="accept-all"]');
await page.waitForSelector('[data-testid="accept-all-unknown"]', { timeout: 15000 });
const banner = (await page.locator('[data-testid="accept-all-unknown"]').innerText()).replace(/\s+/g, " ");
c.is("the bulk path reached the server too", bulkStatus, 200);
c.is("the outer banner does not claim a no-write", /Nothing was applied/.test(banner), false);
c.is("it says the outcome is unknown", /Outcome unknown/i.test(banner), true);
c.is("and offers a reload rather than a resend", await page.locator('[data-testid="accept-all-reload"]').count(), 1);

// Every way to write again is shut while the batch is unaccounted for.
c.is("Accept all is locked", await page.locator('[data-testid="accept-all"]').isDisabled(), true);
c.is("every row the batch was sent for is marked unknown", await page.locator('[data-testid="unknown-outcome"]').count(), batch);
c.is("no row offers Accept", await page.locator('[data-testid="row-accept"]').count(), 0);
c.is("no row offers Reject", await page.locator('[data-testid="row-reject"]').count(), 0);
await page.click('[data-testid="accept-all"]', { force: true }).catch(() => {});
await page.waitForTimeout(500);
c.is("pressing it again sends no second batch", bulkPosts, 1);
await page.unroute("**/proposals/accept-all");

// The read settles it — what the server itself has, with no second write.
let batchPosts = 0;
await page.route("**/api/proposals/*", async (route) => {
  if (route.request().method() === "POST") batchPosts += 1;
  return route.continue();
});
const ids = await page.locator('[data-testid="proposal-row"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-proposal-id")));
for (const id of ids) {
  const check = page.locator(`[data-proposal-id="${id}"] [data-testid="recheck-outcome"]`);
  if (await check.count()) await check.click();
  await page.waitForTimeout(400);
}
await page.waitForTimeout(800);
c.is("reconciling the batch wrote nothing", batchPosts, 0);
const settledStatuses = await Promise.all(ids.map(async (id) => {
  const response = await page.request.get(new URL(`/api/proposals/${id}`, accountUrl).href);
  if (!response.ok()) throw new Error(`Could not read proposal status: ${response.status()}`);
  return (await response.json()).status;
}));
c.is("the batch reads as applied, from the server's own record", settledStatuses.every(status => status === 'accepted'), true);
c.is("and the lock lifts once no row is uncertain", await page.locator('[data-testid="accept-all-unknown"]').count(), 0);
await page.unroute("**/api/proposals/*");

// A reload shows the authoritative state, not the rows this list was holding.
await page.reload();
await page.waitForTimeout(500);
const reloaded = (await page.innerText("body")).replace(/\s+/g, " ");
c.is("nothing is still waiting for a decision after the reload", await page.locator('[data-testid="row-accept"]').count(), 0);
c.is("and the reloaded page claims no unknown outcome", /Outcome unknown/i.test(reloaded), false);

// ---- the note review: selection controls, and a refused save keeps them -----

await page.goto(`${accountUrl}/research`);
await page.fill('[data-testid="research-focus"]', "published depot modernisation plans");
await page.click('[data-testid="research-run"]');
await page.waitForSelector('[data-testid="research-result"]', { timeout: 60000 });
await page.goto(`${accountUrl}/research`);
const boxes = page.locator('[data-testid="keep-finding"]');
const total = await boxes.count();
c.is("a draft note is up for review", total > 0, true);
// Uppercase is the rendered style of an Eyebrow, so every assertion against
// one of these labels is case-insensitive.
const count = page.locator('[data-testid="selection-count"]');
c.is("the count says how many of how many are selected", new RegExp(`${total} of ${total} finding`, "i").test(await count.innerText()), true);

await page.click('[data-testid="clear-selection"]');
await page.waitForTimeout(200);
c.is("clearing deselects every finding", new RegExp(`^0 of ${total} finding`, "i").test(await count.innerText()), true);
await page.click('[data-testid="select-all"]');
await page.waitForTimeout(200);
c.is("and select all puts them back", new RegExp(`^${total} of ${total} finding`, "i").test(await count.innerText()), true);

// One unticked, then a save whose reply is lost: the selection must survive
// and the screen must not claim either outcome.
await boxes.first().uncheck();
await page.waitForTimeout(150);
c.is("unticking one is counted", new RegExp(`^${total - 1} of ${total} finding`, "i").test(await count.innerText()), true);
let noteCaught = false;
await page.route("**/api/research-notes/*", async (route) => {
  if (route.request().method() !== "POST" || noteCaught) return route.continue();
  noteCaught = true;
  await route.abort("failed");
});
let uncaught = null;
page.on("pageerror", (e) => {
  uncaught = e.message;
});
await page.click('[data-testid="note-accept"]');
await page.waitForSelector('[data-testid="note-unknown-outcome"]', { timeout: 15000 });
const noteSaid = (await page.locator('[data-testid="note-unknown-outcome"]').innerText()).replace(/\s+/g, " ");
c.is("the note review handles a lost reply at all", /Outcome unknown/i.test(noteSaid), true);
c.is("without claiming nothing was saved", /Nothing was saved/.test(noteSaid), false);
c.is("no uncaught error reaches the page", uncaught, null);
c.is("and the selection is exactly as it was left", new RegExp(`^${total - 1} of ${total} finding`, "i").test(await count.innerText()), true);
// Saving again is the double-save this state exists to prevent.
c.is("saving is locked while the outcome is unknown", await page.locator('[data-testid="note-accept"]').isDisabled(), true);
c.is("discarding is locked too", await page.locator('[data-testid="note-discard"]').isDisabled(), true);
c.is("and the way out is an honest reload", /Reload the page/i.test(await page.locator('[data-testid="note-unknown-outcome"]').innerText()), true);
await page.unroute("**/api/research-notes/*");

// A refusal the server explained is different: nothing was saved, the ticks
// are untouched, and it can be sent again.
await page.reload();
await page.waitForSelector('[data-testid="note-accept"]', { timeout: 15000 });
const boxesAgain = page.locator('[data-testid="keep-finding"]');
await boxesAgain.first().uncheck();
let refusals = 0;
await page.route("**/api/research-notes/*", async (route) => {
  if (route.request().method() !== "POST") return route.continue();
  refusals += 1;
  await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Keep at least one finding." }) });
});
await page.click('[data-testid="note-accept"]');
await page.waitForSelector('[role="alert"]:has-text("Keep at least one finding.")', { timeout: 15000 });
const refusedCount = page.locator('[data-testid="selection-count"]');
c.is("an explained refusal says nothing was saved", /Nothing was saved/i.test(await page.innerText("body")), true);
c.is("the selection is kept for another try", new RegExp(`^${total - 1} of ${total} finding`, "i").test(await refusedCount.innerText()), true);
c.is("and saving is still offered", await page.locator('[data-testid="note-accept"]').isDisabled(), false);
await page.click('[data-testid="note-accept"]');
await page.waitForTimeout(500);
c.is("so the refused save can be retried", refusals, 2);
await page.unroute("**/api/research-notes/*");

// ---- resolving a finding: an unreadable 2xx keeps what was typed ------------

// Save the real note before opening adjustment/resolution mode. This case
// must execute, not silently skip because the note is still a draft.
const [savedNote] = await Promise.all([
  page.waitForResponse(r => r.url().includes('/api/research-notes/') && r.request().method() === 'POST'),
  page.locator('[data-testid="note-accept"]').click(),
]);
c.is("the note is retained for the resolution test", savedNote.status(), 200);
const noteId = (await savedNote.json()).documentId;
await page.goto(`${accountUrl}/research?note=${encodeURIComponent(noteId)}`);
const resolver = page.locator('[data-testid="resolve-research"]');
await resolver.waitFor();
await resolver.locator("summary").click();
await resolver.locator('select[aria-label="Finding to supersede"]').selectOption({ index: 1 });
const support = resolver.locator('select[aria-label="Supporting retained evidence"]');
await support.selectOption({ index: 1 });
const reason = "Superseded by the later filing; typed for the recovery check.";
await resolver.locator('textarea[aria-label="Resolution reason"]').fill(reason);
await page.route("**/api/research-notes/*", async (route) =>
  route.request().method() === "POST" ? route.fulfill({ status: 200, contentType: "application/json", body: "{}" }) : route.continue(),
);
await resolver.locator('[data-testid="resolve-submit"]').click();
await page.waitForSelector('[data-testid="resolve-unknown-outcome"]', { timeout: 15000 });
const resolveSaid = (await resolver.innerText()).replace(/\s+/g, " ");
c.is("an unreadable 2xx is not a recorded resolution", /Outcome unknown/i.test(resolveSaid), true);
c.is("it does not claim nothing was recorded", /Nothing was recorded/.test(resolveSaid), false);
c.is("what was typed is still there", await resolver.locator('textarea[aria-label="Resolution reason"]').inputValue(), reason);
c.is("and recording again is locked", await resolver.locator('[data-testid="resolve-submit"]').isDisabled(), true);
await page.unroute("**/api/research-notes/*");
await page.goto(`${accountUrl}/research`);

// ---- the scope of a run is legible before it is bought ----------------------

c.is("the run says what deep and standard each cost", await page.locator('[data-testid="research-cost-limits"]').count(), 1);
c.is("deep is still the default", await page.locator('[data-testid="research-deep"]').isChecked(), true);

// ---- no page-wide sideways scroll at phone width ---------------------------

for (const width of [320, 390]) {
  await page.setViewportSize({ width, height: 800 });
  for (const url of [accountUrl, `${accountUrl}/research`]) {
    await page.goto(url);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    c.is(`${url.replace(/^https?:\/\/[^/]+/, "")} does not scroll sideways at ${width}`, overflow <= 0, true);
  }
}

await browser.close();
process.exit(c.done() ? 0 : 1);
