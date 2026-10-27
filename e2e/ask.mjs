// Ask, from the browser, under AI_FAKE. SYNTHETIC ONLY.
//
// What it proves is what a library test cannot: that a question typed into
// ⌘K becomes a conversation, that the answer's numbered source is a link to
// the record, that an account's Ask is on the account, that "Don't save" is
// said on the page and can be undone, and that it all fits a phone.
import { BASE, checker, launch, signIn } from "./browser.mjs";

const browser = await launch();
const c = checker("ask");
const alex = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);

await alex.goto(`${BASE}/accounts`);
const trigger = alex.locator('[data-testid="account-new-open"]');
if (await trigger.count()) await trigger.click();
await alex.fill('[data-testid="account-new"] [name="name"]', "Synthetic Quillon Logistics");
await alex.click('[data-testid="account-new-submit"]');
await alex.waitForURL(/\/accounts\/[^/]+$/, { timeout: 15000 });
const accountUrl = alex.url();

const answered = async () => {
  await alex.getByTestId("ask-answer").last().waitFor({ timeout: 20000 });
  return alex.getByTestId("ask-answer").last().innerText();
};

// ⌘K: a question is asked, not looked up.
// The shortcut is listened for once the page has hydrated.
const paletteInput = alex.locator('input[aria-label="Jump to"]');
for (let i = 0; i < 5 && !(await paletteInput.isVisible()); i++) {
  await alex.keyboard.press("Control+k");
  await paletteInput.waitFor({ state: "visible", timeout: 2000 }).catch(() => {});
}
await paletteInput.fill("Quillon: where do we stand with them?");
const offered = await alex
  .waitForFunction(() => /^Ask:/.test(document.querySelector("#palette-results [role=option]")?.textContent?.trim() ?? ""), null, { timeout: 5000 })
  .then(() => true, () => false);
c.is("the palette offers to ask it first", offered, true);
await alex.keyboard.press("Enter");
await alex.waitForURL(/\/ask\/[0-9a-f-]{36}$/, { timeout: 15000 });
const threadUrl = alex.url();
c.is("the answer shows while it is being written", await alex.getByTestId("ask-draft").waitFor({ timeout: 8000 }).then(() => true, () => false), true);
const answer = await answered();
c.is("the answer comes back on the conversation", answer.includes("Synthetic Quillon Logistics"), true);
c.is("with a numbered source", (await alex.getByTestId("ask-sources").innerText()).includes("Synthetic Quillon Logistics"), true);
await alex.getByTestId("ask-sources").locator("a").first().click();
await alex.waitForURL(/\/accounts\//, { timeout: 15000 });
c.is("which links to the record", alex.url().split(/[?#]/)[0], accountUrl);
await alex.goBack();
await alex.waitForURL(threadUrl);
c.is("going back does not ask again", await alex.getByTestId("ask-question").count(), 1);

// A follow-up on the same conversation.
await alex.fill("#ask-question", "And who did we meet there?");
await alex.click('[data-testid="ask-submit"]');
await alex.waitForFunction(() => document.querySelectorAll('[data-testid="ask-answer"]').length === 2, null, { timeout: 20000 });
c.is("a follow-up lands on the same conversation", await alex.getByTestId("ask-question").count(), 2);

// On the account.
await alex.goto(accountUrl);
await alex.click('[data-testid="account-ask"]');
await alex.waitForURL(/\/ask$/);
await alex.fill("#ask-question", "Where does this account stand?");
await alex.click('[data-testid="ask-submit"]');
await alex.waitForURL(/\/ask\/[0-9a-f-]{36}$/, { timeout: 15000 });
c.is("an account's question reads the account first", (await answered()).includes("Synthetic Quillon Logistics"), true);
const accountThread = alex.url();

// Asked to change something: a proposal, accepted on review.
await alex.fill("#ask-question", "Add a follow-up: send the Quillon sizing pack");
await alex.click('[data-testid="ask-submit"]');
await alex.waitForFunction(() => document.querySelectorAll('[data-testid="ask-answer"]').length === 2, null, { timeout: 20000 });
// A follow-up you asked for is added on the answer itself, in one tap.
const quick = alex.getByTestId("ask-quick-follow-ups");
c.is("the answer offers the follow-up it proposed", /1 follow-up to add on Synthetic Quillon Logistics/.test(await quick.innerText()) && (await quick.innerText()).includes("send the Quillon sizing pack"), true);
c.is("with a way to review it first", await quick.getByRole("link", { name: "Review first →" }).getAttribute("href"), `/inbox?kind=changes&account=${new URL(accountUrl).pathname.split("/").pop()}`);
await alex.getByTestId("ask-quick-add").click();
await alex.getByTestId("ask-proposed").waitFor({ timeout: 15000 });
c.is("once added, the answer says so", /1 accepted/.test(await alex.getByTestId("ask-proposed").innerText()) && /Reviewed/.test(await alex.getByTestId("ask-proposed").innerText()), true);
await alex.goto(`${accountUrl}/follow-ups`);
c.is("and the follow-up is on the account", (await alex.innerText("main")).includes("send the Quillon sizing pack"), true);

await alex.goto(`${accountUrl}/ask`);
c.is("and is listed on the account", (await alex.getByTestId("ask-threads").innerText()).includes("Where does this account stand?"), true);
c.is("the written one-pager starts from One page, not here", (await alex.getByTestId("account-templates").innerText()).includes("Account one-pager"), false);

// A report: saved, printable, shared by a link that needs no login.
await alex.goto(accountThread);
await alex.fill("#ask-question", "Write a report on where Quillon stands");
await alex.click('[data-testid="ask-submit"]');
await alex.getByTestId("ask-report").waitFor({ timeout: 20000 });
await alex.getByTestId("ask-report").click();
await alex.waitForURL(/\/reports\/[0-9a-f-]{36}$/);
const reportUrl = alex.url();
c.is("the report opens on its own page", (await alex.getByTestId("report").innerText()).includes("Synthetic Quillon Logistics"), true);
const mailHref = await alex.getByTestId("report-copy-mail").getAttribute("href");
c.is("Open in Mail carries the report, addressed to nobody", mailHref.startsWith("mailto:?subject=") && decodeURIComponent(mailHref).includes("SOURCES"), true);
await alex.context().grantPermissions(["clipboard-read", "clipboard-write"]);
await alex.getByTestId("report-more").locator("summary").click();
await alex.getByTestId("report-copy-copy").click();
c.is("Copy as text puts the report on the clipboard", (await alex.evaluate(() => navigator.clipboard.readText())).includes("WHERE IT STANDS"), true);
await alex.emulateMedia({ media: "print" });
c.is("printed, it is the report alone", await alex.evaluate(() => {
  const hidden = (sel) => [...document.querySelectorAll(sel)].every((el) => el.getClientRects().length === 0);
  return hidden('nav[aria-label="Main"]') && hidden('[data-testid="report-share"]') && hidden('[data-testid="print"]');
}), true);
await alex.emulateMedia({ media: "screen" });
await alex.click('[data-testid="report-share-make-open"]');
await alex.click('[data-testid="report-share-make-submit"]');
await alex.getByTestId("share-link").waitFor({ timeout: 10000 });
const shareUrl = (await alex.getByTestId("share-link").innerText()).trim();
const stranger = await (await browser.newContext()).newPage();
await stranger.goto(shareUrl);
c.is("the shared link opens without a login", (await stranger.getByTestId("report").innerText()).includes("Synthetic Quillon Logistics"), true);
c.is("and links nowhere into the app", await stranger.locator('[data-testid="report"] a').count(), 0);
await alex.goto(`${BASE}/reports`);
c.is("the report is listed with the others", (await alex.getByTestId("reports").innerText()).includes("Quillon"), true);
await alex.goto(reportUrl);
await alex.click('[data-testid="revoke-share-open"]');
await alex.click('[data-testid="revoke-share-submit"]');
await alex.getByTestId("report-share-make-open").waitFor({ timeout: 10000 });
const gone = await stranger.goto(shareUrl);
c.is("ending the link ends it", gone.status(), 404);
await stranger.context().close();

// Ask about this: from a deal's own page.
await alex.goto(`${accountUrl}/deals`);
await alex.click('[data-testid="deal-new-open"]');
await alex.fill('[data-testid="deal-new"] [name="name"]', "Synthetic Quillon renewal");
await alex.click('[data-testid="deal-new-submit"]');
await alex.locator('#deals a[href*="/deals/"]').filter({ hasText: "Synthetic Quillon renewal" }).first().waitFor({ timeout: 15000 });
await alex.locator('#deals a[href*="/deals/"]').filter({ hasText: "Synthetic Quillon renewal" }).first().click();
await alex.waitForURL(/\/deals\/[^/]+$/);
const dealUrl = alex.url().split(/[?#]/)[0];
await alex.click('[data-testid="ask-about-this"]');
await alex.waitForURL(/\/ask\?focus=/);
c.is("the box says what it will be about", (await alex.getByTestId("ask-about").innerText()).includes("Deal: Synthetic Quillon renewal"), true);
await alex.fill("#ask-question", "What is the risk on this one?");
await alex.click('[data-testid="ask-submit"]');
await alex.waitForURL(/\/ask\/[0-9a-f-]{36}$/, { timeout: 15000 });
c.is("the answer is about the deal", (await answered()).includes("Synthetic Quillon renewal"), true);
await alex.getByTestId("ask-about").locator("a").click();
await alex.waitForURL((u) => u.toString().split(/[?#]/)[0] === dealUrl);
c.is("and the conversation links back to it", true, true);

// ⌘K on a page asks about that page.
await alex.goto(`${BASE}/pipeline`);
for (let i = 0; i < 5 && !(await paletteInput.isVisible()); i++) {
  await alex.keyboard.press("Control+k");
  await paletteInput.waitFor({ state: "visible", timeout: 2000 }).catch(() => {});
}
await paletteInput.fill("Which of these close this quarter?");
await alex.waitForFunction(() => /^Ask:/.test(document.querySelector("#palette-results [role=option]")?.textContent?.trim() ?? ""), null, { timeout: 5000 });
await alex.keyboard.press("Enter");
await alex.waitForURL(/\/ask\/[0-9a-f-]{36}$/, { timeout: 15000 });
await answered();
c.is("a question from the pipeline is about the pipeline", (await alex.getByTestId("ask-about").innerText()).includes("Pipeline"), true);

// Not saved, then kept.
await alex.goto(`${BASE}/ask`);
await alex.check('[data-testid="ask-temporary"]');
await alex.fill("#ask-question", "Synthetic throwaway question about Quillon");
await alex.click('[data-testid="ask-submit"]');
await alex.waitForURL(/\/ask\/[0-9a-f-]{36}$/, { timeout: 15000 });
await answered();
c.is("an unsaved conversation says so", await alex.getByTestId("ask-temporary-note").count(), 1);
await alex.goto(`${BASE}/ask`);
c.is("and is not listed", (await alex.getByTestId("ask-threads").innerText()).includes("throwaway"), false);
await alex.goBack();
await alex.getByTestId("ask-temporary-note").getByRole("button", { name: "Keep it" }).click();
await alex.waitForFunction(() => !document.querySelector('[data-testid="ask-temporary-note"]'), null, { timeout: 10000 });
await alex.goto(`${BASE}/ask`);
c.is("until it is kept", (await alex.getByTestId("ask-threads").innerText()).includes("throwaway"), true);

// Asking next, starters, and the preview on a source.
await alex.goto(threadUrl);
const marker = alex.getByTestId("ask-answer").first().locator('a[aria-label^="source"]').first();
await marker.hover();
c.is("a source shows the record on hover", await alex.getByTestId("source-preview").first().isVisible(), true);
const before = await alex.getByTestId("ask-answer").count();
await alex.getByTestId("ask-next").locator("button").first().click();
await alex.waitForFunction((n) => document.querySelectorAll('[data-testid="ask-answer"]').length === n + 1, before, { timeout: 20000 });
c.is("a suggested question is asked with one press", await alex.getByTestId("ask-answer").count(), before + 1);
await alex.goto(`${BASE}/ask`);
c.is("Ask opens with questions worth asking", (await alex.getByTestId("ask-starters").locator("button").count()) >= 2, true);

// A report from a template, and a report saved as one.
await alex.goto(`${BASE}/reports`);
await alex.getByTestId("templates").getByRole("link", { name: "Weekly pipeline review" }).click();
await alex.waitForURL(/\/ask\/[0-9a-f-]{36}$/, { timeout: 15000 });
await alex.getByTestId("ask-report").waitFor({ timeout: 20000 });
await alex.getByTestId("ask-report").click();
await alex.waitForURL(/\/reports\/[0-9a-f-]{36}$/);
c.is("the template's report has its sections", (await alex.getByTestId("report").innerText()).includes("Decisions needed"), true);
c.is("and draws its chart, numbers from the app", await alex.getByTestId("ask-chart").count(), 1);
await alex.setViewportSize({ width: 320, height: 800 });
c.is("a report with a chart fits 320px", await alex.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
await alex.setViewportSize({ width: 1280, height: 800 });
await alex.click('[data-testid="save-template-open"]');
await alex.fill('[data-testid="save-template"] [name="name"]', "Synthetic Monday look");
await alex.click('[data-testid="save-template-submit"]');
await alex.waitForTimeout(800);
await alex.goto(`${BASE}/reports`);
c.is("and a report can be saved as a template", (await alex.getByTestId("templates").innerText()).includes("Synthetic Monday look"), true);

// Wrong, with a note, read back on the feedback page.
await alex.goto(threadUrl);
const fb = alex.getByTestId("answer-feedback").first();
await fb.getByTestId("answer-wrong").click();
await fb.getByTestId("answer-wrong-note").fill("Synthetic miss: it left out the renewal");
await fb.getByTestId("answer-wrong-save").click();
await alex.waitForFunction(() => document.querySelector('[data-testid="answer-wrong"]')?.getAttribute("aria-pressed") === "true", null, { timeout: 10000 });
await alex.goto(`${BASE}/ask/feedback`);
c.is("an answer marked wrong is listed with what was wrong", (await alex.getByTestId("feedback-wrong").innerText()).includes("Synthetic miss: it left out the renewal"), true);
c.is("and how Ask is doing is counted above it", /answers\s*\d+/i.test(await alex.getByTestId("ask-health").innerText()) && /1 wrong/.test(await alex.getByTestId("ask-health").innerText()), true);

// A phone.
for (const width of [390, 320]) {
  await alex.setViewportSize({ width, height: 800 });
  await alex.goto(threadUrl);
  const m = await alex.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  c.is(`the conversation fits ${width}px`, m.scroll <= m.inner, true);
  const bar = await alex.locator('nav[aria-label="Main"]').innerText();
  c.is(`the phone bar has Ask at ${width}px`, /Ask/.test(bar) && !/Activity/.test(bar), true);
}

await browser.close();
process.exit(c.done() ? 0 : 1);
