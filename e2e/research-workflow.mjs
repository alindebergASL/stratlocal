// The research workflow as a person walks it: open an account, understand what
// research says, act on what it suggests.
//
// The other research flow proves the pipeline — button, findings, review,
// storage. This one is about whether the result is *findable*: research had
// become a slab of model prose a third of the way down the account page, a
// research page led by its most expensive button, topic cards advertising
// findings they were not showing, and a refusal that threw away every
// suggestion it was not about.
//
// AI_FAKE=1 as everywhere, plus AI_FAKE_REPLAY=withheld-update, which makes the
// canned answer carry one suggestion the saved evidence does not support. That
// is a replay fixture, not a live model getting something wrong: what the app
// does with it — the grounding check, the refusal, the words on screen — is the
// real code.
import { checker, launch, signIn, openTab, reviewAsList } from "./browser.mjs";

const browser = await launch();
const c = checker("research is findable, and what it cannot support says so");
const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);

const trigger = page.locator('[data-testid="account-new-open"]');
if (await trigger.count()) await trigger.click();
await page.fill('[data-testid="account-new"] [name="name"]', "Ravensmoor Transit Authority");
await page.click('[data-testid="account-new-submit"]');
await page.waitForURL(/\/accounts\//, { timeout: 15000 });
const accountUrl = page.url();

// ---- an account with nothing on it says what research is ---------------------

const emptyPanel = page.locator('[data-testid="research-panel-counts"]');
c.is("an unresearched account claims no findings", await emptyPanel.count(), 0);
c.is("and offers the run", await page.locator('[data-testid="research-open"]').count(), 1);

// Each kind of record is its own page, a link you can send. Five are tabs;
// the rest are under More, which then names the page you are on (DECISIONS #100).
for (const [tab, id, key] of [["deals", "deals", "deals"], ["plays", "plan", "plan"], ["people", "people", "people"], ["meetings", "meetings", "meetings"], ["details", "documents", "details"]]) {
  await page.goto(`${accountUrl}/${tab}`);
  c.is(`the ${tab} tab shows its records`, await page.locator(`#${id}`).count(), 1);
  c.is(`and is the current tab`, await page.locator('[data-testid="account-tabs"] [aria-current="page"]').first().getAttribute("data-testid"), `account-tab-${key}`);
}
// Current tabs stay inside the actual inner scroller at phone widths,
// including resize and Back navigation, without horizontal page movement.
for (const width of [390, 320]) {
  await page.setViewportSize({ width, height: 844 });
  await page.waitForFunction(() => {
    const nav = document.querySelector('[data-testid="account-tabs"]');
    const active = nav?.querySelector('[aria-current="page"]');
    if (!nav || !active) return false;
    const a = active.getBoundingClientRect(), s = nav.getBoundingClientRect();
    return a.left >= s.left - 1 && a.right <= s.right + 1;
  });
  await page.goto(new URL("/pipeline", accountUrl).href);
  c.is(`pipeline filters with a long account fit at ${width}px`, await page.evaluate(() => {
    const form = document.querySelector('[data-testid="pipeline-filters"] form').getBoundingClientRect();
    const account = document.querySelector('select[name="account"]').getBoundingClientRect();
    return account.right <= form.right + 1 && document.documentElement.scrollWidth <= innerWidth;
  }), true);
  for (const tab of ["research", "details", "meetings"]) {
    await page.goto(`${accountUrl}/${tab}`);
    // A tab stays inside the strip; a page under More names itself on More,
    // which is always on screen.
    await page.waitForFunction(() => {
      const nav = document.querySelector('[data-testid="account-tabs"]');
      const active = nav?.querySelector('[aria-current="page"]');
      if (!nav || !active) return false;
      const a = active.getBoundingClientRect(), s = nav.getBoundingClientRect();
      return a.left >= s.left - 1 && a.right <= s.right + 1;
    });
    c.is(`${tab} current tab stays visible at ${width}px`, await page.evaluate(() => window.scrollX === 0 && document.documentElement.scrollWidth <= innerWidth), true);
  }
  await page.getByTestId("account-tab-overview").click();
  await page.waitForURL(accountUrl);
  await page.goBack();
  await page.waitForURL(`${accountUrl}/meetings`);
  await page.waitForFunction(() => {
    const s = document.querySelector('[data-testid="account-tabs"] ul').getBoundingClientRect();
    const a = document.querySelector('[data-testid="account-tab-meetings"]').getBoundingClientRect();
    return a.left >= s.left - 1 && a.right <= s.right + 1;
  });
}
await page.setViewportSize({ width: 1440, height: 900 });
// The account-wide tools are one keyboard-reachable menu.
await page.goto(accountUrl);
await page.locator("#account-tools > summary").focus();
await page.keyboard.press("Enter");
c.is("the More menu opens from the keyboard", await page.locator('#account-tools [data-testid="handoff-link"]').isVisible(), true);
c.is("where it stands leads, what needs you precedes the work, and the work precedes what we know", await page.evaluate(() => {
  const ids = ["where-it-stands", "needs-you", "follow-ups", "research"];
  return ids.slice(1).every((id, i) => Boolean(document.getElementById(ids[i]).compareDocumentPosition(document.getElementById(id)) & Node.DOCUMENT_POSITION_FOLLOWING));
}), true);

// ---- research it -------------------------------------------------------------

await page.goto(`${accountUrl}/research`);
await page.fill('[data-testid="research-focus"]', "published transit modernisation plans");
await page.click('[data-testid="research-run"]');
await page.waitForSelector('[data-testid="research-result"]', { timeout: 60000 });
await page.goto(`${accountUrl}/research`);
const findings = await page.locator('[data-testid="keep-finding"]').count();
c.is("the draft is offered for review", findings > 0, true);
await page.click('[data-testid="note-accept"]');
await page.waitForTimeout(2000);

// ---- the account overview ----------------------------------------------------

await page.goto(accountUrl);
const counts = page.locator('[data-testid="research-panel-counts"]');
c.is("the account now previews its research", await counts.count(), 1);
c.is("three findings are previewed", await page.locator('[data-testid="research-panel-recent"] li').count(), 3);
c.is("preview topics are distinct", new Set(await page.getByTestId("research-preview-topic").allTextContents()).size, 3);
c.is("in retained findings, not in whatever the model said", /retained finding/i.test(await counts.innerText()), true);
// The panel is a preview. Everything it does not show is one click away, and
// the model's unreviewed paragraph is not on this page at all.
c.is("the unreviewed model summary stays on the research page", await page.locator('[data-testid="original-summary"]').count(), 0);

// Beside the work, not inside it: on a wide screen the research panel sits in
// the narrower right-hand column, level with the follow-ups.
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(accountUrl);
const research = await page.locator("#research").boundingBox();
const work = await page.locator("#follow-ups").boundingBox();
c.is("research has a column of its own beside the account work", research.x > work.x + work.width - 1, true);
c.is("and it shares the follow-ups' row rather than sitting below the page", await page.evaluate(() => {
  const row = (id) => document.getElementById(id).closest(".lg\\:grid");
  return row("research") !== null && row("research") === row("follow-ups");
}), true);
c.is("the account work column is the wider one", work.width > research.width, true);

// ---- the research page -------------------------------------------------------

await page.click('[data-testid="research-open"]');
await page.waitForURL(/\/research$/, { timeout: 15000 });
const body = await page.innerText("body");
c.is("the page has one heading, the account's", await page.locator("h1").innerText(), "Ravensmoor Transit Authority");
c.is("and Research is the current tab", await page.locator('[data-testid="account-tab-research"][aria-current="page"]').count(), 1);
c.is("and it opens on what we know, by topic", await page.locator('[data-testid="research-topic-row"]').count() >= 1, true);
c.is("each finding says who said it", await page.locator('[data-testid="research-topic-row"] [data-testid="source-kind"]').count(), await page.locator('[data-testid="research-topic-row"]').count());
c.is("and the runs are a tab away", Number((await page.getByTestId("research-tab-report").innerText()).replace(/\D+/g, "")) >= 1, true);
// Reading comes first on an account that has been researched; buying more is
// one closed action, not a form between the things you came to read.
c.is("what is on file is read before more is bought", await page.locator('[data-testid="research-run-open"]:not([open])').count(), 1);

// One run, read whole: a topic card shows what it counts, rather than
// counting over a blank panel.
await page.goto(`${accountUrl}/research?view=report`);
c.is("the runs are listed on the Full report tab", await page.locator('[data-testid="research-runs"] a').count() >= 1, true);
await page.locator('[data-testid="research-report-tab"] a[href*="read="]').first().click();
await page.waitForURL(/[?&]read=/, { timeout: 15000 });
const dossier = page.locator('[data-testid="research-dossier"]').first();
c.is("the dossier is on the page", await dossier.count(), 1);
const dossierText = await dossier.innerText();
c.is("and says how much of the whole it is showing", /Showing \d+ of \d+ retained finding/.test(dossierText), true);
const cards = dossier.locator(".grid > div");
let populated = 0;
const stranded = [];
for (let i = 0; i < (await cards.count()); i++) {
  const card = cards.nth(i);
  const topic = await card.getByRole("heading", { level: 3 }).innerText();
  const heading = await card.locator("h3 + span").innerText();
  const total = Number((heading.match(/^(\d+)/) ?? [])[1] ?? 0);
  if (total === 0) continue;
  populated++;
  // A card that counts findings either shows one or says where they are. The
  // reported defect was a card doing neither.
  const rows = await card.locator("li").count();
  const viewAll = await card.locator("a", { hasText: "View all" }).count();
  if (rows === 0 && viewAll === 0) stranded.push(`${topic} (${heading})`);
}
c.is("at least one topic card carries findings", populated > 0, true);
c.is("no card counts findings it neither shows nor links to", stranded.join("; "), "");

// ---- suggested updates -------------------------------------------------------

await page.goto(`${accountUrl}/research?view=open`);
await page.click('[data-testid="research-updates-run"]');
await page.waitForSelector('[data-testid="research-updates-result"]', { timeout: 60000 });
const result = await page.locator('[data-testid="research-updates-result"]').innerText();
c.is("supported suggestions are prepared", /suggestion(s)? prepared for review/.test(result), true);
// The one the evidence does not support is a result of its own, with what it
// was, why it was refused and where to look — not an error that took its
// eleven valid siblings with it.
const withheld = page.locator('[data-testid="research-withheld"]');
c.is("the unsupported one is withheld, not silently dropped", await withheld.count(), 1);
const withheldText = await withheld.innerText();
c.is("it says what was suggested", /Replayed Unsupported City/.test(withheldText), true);
c.is("and why it was refused", /explicit in saved evidence/i.test(withheldText), true);
c.is("and what to do about it", /cited finding|by hand/i.test(withheldText), true);
c.is("and links to the evidence it cited", await withheld.locator("a").count() > 0, true);

// It survives a reload, because it is stored on the run and not in the page.
await page.reload();
await page.waitForSelector('[data-testid="research-updates-result"]', { timeout: 15000 });
c.is("the outcome survives a reload", /withheld/.test(await page.locator('[data-testid="research-updates-result"]').innerText()), true);
c.is("including the withheld detail", await page.locator('[data-testid="research-withheld"]').count(), 1);

// ---- the links the cards and the refusal offer -------------------------------

// A topic link opens that topic, not the whole file, and reading it does not
// unfold the re-review checklist.
const viewAll = page.locator('[data-testid="research-dossier"] a', { hasText: "View all" }).first();
if (await viewAll.count()) {
  const href = await viewAll.getAttribute("href");
  c.is("a topic link addresses a topic rather than the whole dossier", /[?&]topic=/.test(href) && !/all=1/.test(href), true);
  await viewAll.click();
  await page.waitForSelector('[data-testid="research-topic"]', { timeout: 15000 });
  const topicPanel = await page.locator('[data-testid="research-topic"]').innerText();
  c.is("the topic says how many of its findings this note keeps", /retained finding/.test(topicPanel), true);
  c.is("reading a topic does not open the adjustment controls", await page.locator('[data-testid="research-adjust"]').count(), 0);
  // An address: reload keeps it, Back leaves it.
  await page.reload();
  await page.waitForSelector('[data-testid="research-topic"]', { timeout: 15000 });
  c.is("the topic survives a reload", await page.locator('[data-testid="research-topic"]').count(), 1);
  await page.goBack();
  await page.waitForSelector('[data-testid="research-dossier"]', { timeout: 15000 });
  c.is("and Back returns to the topic cards", await page.locator('[data-testid="research-topic"]').count(), 0);
}

// The refusal's link opens the exact finding it cited.
const citedLink = page.locator('[data-testid="research-withheld"] a').first();
const citedHref = await citedLink.getAttribute("href");
c.is("the withheld suggestion cites a finding, not just a note", /[?&]finding=\d+/.test(citedHref), true);
await citedLink.click();
await page.waitForSelector('[data-testid="research-finding"]', { timeout: 15000 });
c.is("the cited finding opens on its own", await page.locator('[data-testid="research-finding"]').count(), 1);
c.is("and not as a re-review of its note", await page.locator('[data-testid="research-adjust"]').count(), 0);
await page.goto(`${accountUrl}/research?view=open`);

// ---- through to pending review, and an accepted record -----------------------

const reviewLink = page.locator('[data-testid="research-updates-review"]');
c.is("a review link is offered because proposals are actually pending", await reviewLink.count(), 1);
const pendingBefore = Number((await reviewLink.innerText()).match(/Review (\d+)/)[1]);
c.is("and it counts more than one waiting", pendingBefore > 1, true);
await reviewLink.click();
await page.waitForURL(/kind=changes&account=/, { timeout: 15000 });
await reviewAsList(page);
const review = await page.innerText("body");
c.is("the pending suggestions are there to decide on", /Accept|Reject/.test(review), true);
c.is("and nothing was applied on the way", /pending|waiting|review/i.test(review), true);
// The withheld suggestion never became a proposal, so it cannot be accepted by
// accident here.
c.is("the withheld suggestion is not in the queue", /Replayed Unsupported City/.test(review), false);

// Accept exactly one supported suggestion: a follow-up, which the fake answer
// always produces from retained evidence and which lands on a record this flow
// can read back.
const rows = page.locator("li").filter({ hasText: "Internal discovery" });
const target = rows.first();
c.is("a supported suggestion is there to accept", await target.count() > 0, true);
// A distinctive fragment of what this proposal would write, so the record can
// be recognised on the account afterwards.
const targetText = ((await target.innerText()).replace(/\s+/g, " ").match(/Internal discovery[^.]{10,70}/) ?? [])[0];
c.is("the suggestion says what it would write", !!targetText, true);
const ack = target.locator('input[type="checkbox"]');
if (await ack.count()) await ack.first().check();
await target.getByRole("button", { name: "Accept" }).click();
await page.waitForTimeout(2500);
c.is("the accepted row says it was applied", /accepted|applied/i.test(await target.innerText()), true);

// Reject one more, so the remaining count has to come from the server rather
// than from what the run prepared.
const nextRow = page.locator("li").filter({ hasText: "Internal discovery" }).nth(1);
let rejected = 0;
if (await nextRow.count()) {
  await nextRow.getByRole("button", { name: "Reject" }).click();
  await page.waitForTimeout(2000);
  rejected = 1;
  c.is("the rejected row says so", /rejected/i.test(await nextRow.innerText()), true);
}

// The account record itself, read back.
// A follow-up, so it is on the Overview.
await page.goto(accountUrl);
const accountBody = (await page.innerText("body")).replace(/\s+/g, " ");
c.is("the accepted suggestion reached the account's own records", accountBody.includes(targetText), true);
// Nothing the evidence did not support was written, by any path.
c.is("the withheld value never reached the account", /Replayed Unsupported City/.test(accountBody), false);

// And research now counts what is actually left.
await page.goto(`${accountUrl}/research?view=open`);
const afterLink = page.locator('[data-testid="research-updates-review"]');
const remaining = (await afterLink.count()) ? Number((await afterLink.innerText()).match(/Review (\d+)/)[1]) : 0;
c.is("the pending count drops by exactly what was decided", remaining, pendingBefore - 1 - rejected);
c.is("and the stored run result is labelled as the last preparation, not as the queue", /Last preparation on this account/i.test(await page.innerText("body")), true);

await page.goBack();
await page.waitForSelector("body", { timeout: 15000 });
await page.goto(`${accountUrl}/research?view=open`);
await page.waitForSelector('[data-testid="research-updates"]', { timeout: 15000 });
c.is("with the same outcome still on it", await page.locator('[data-testid="research-updates-result"]').count(), 1);

// ---- a phone -----------------------------------------------------------------

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(accountUrl);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
c.is("the account page does not scroll sideways at 390", overflow <= 1, true);
const phoneResearch = await page.locator("#research").boundingBox();
const phoneFollowUps = await page.locator("#follow-ups").boundingBox();
const phoneNeeds = await page.locator("#needs-you").boundingBox();
c.is("on a phone: what needs you, then follow-ups, then research", phoneNeeds.y < phoneFollowUps.y && phoneFollowUps.y < phoneResearch.y, true);
c.is("and it is one column", Math.abs(phoneResearch.x - phoneFollowUps.x) < 2, true);
for (const width of [390, 320]) {
  await page.setViewportSize({ width, height: 844 });
  c.is(`the tabs scroll inside themselves, not the page, at ${width}`, await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 1, true);
  await page.goto(`${accountUrl}#follow-ups`);
  await page.waitForFunction(() => {
    const target = document.querySelector("#follow-ups");
    const header = document.querySelector("header");
    const sticky = header && getComputedStyle(header).position === "sticky";
    return target && header && (!sticky || target.getBoundingClientRect().top >= header.getBoundingClientRect().bottom);
  });
  c.is(`a jump to follow-ups clears the header at ${width}`, true, true);
}
// Every research tab, at both phone widths.
for (const width of [390, 320]) {
  await page.setViewportSize({ width, height: 844 });
  for (const view of ["", "?view=peers", "?view=documents", "?view=open", "?view=report"]) {
    await page.goto(`${accountUrl}/research${view}`);
    const researchOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    c.is(`nor does research${view || " (what we know)"} at ${width}`, researchOverflow <= 1, true);
  }
}
// Back from the full report returns to what we know.
await page.goto(`${accountUrl}/research`);
await page.getByTestId("research-tab-report").click();
await page.waitForURL(/view=report/, { timeout: 15000 });
await page.goBack();
await page.waitForURL((u) => !u.search.includes("view="), { timeout: 15000 });
// App-router history can update the address before the restored tree commits.
// Wait for the actual selected tab; the URL alone is not restoration evidence.
await page.locator('[data-testid="research-tab-known"][aria-current="page"]').waitFor({ state: "visible", timeout: 15000 });
c.is("Back from the full report returns to what we know", await page.locator('[data-testid="research-tab-known"][aria-current="page"]').count(), 1);

await browser.close();
process.exit(c.done() ? 0 : 1);
