// Synthetic layout regressions only: no generation or acceptance on navigation.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import Database from "better-sqlite3";
import { BASE, checker, launch, signIn, openTab } from "./browser.mjs";
if (!process.env.E2E_DB_PATH?.includes("strategy-e2e-")) throw Error("Disposable e2e DB required");
const browser = await launch();
const c = checker("reading layout and mobile title space");
const db = new Database(process.env.E2E_DB_PATH);
try {
  const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);
  const f = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "e2e/layout-seed.mts"], { encoding: "utf8", env: { ...process.env, DB_PATH: process.env.E2E_DB_PATH } }));
  const accountUrl = `${BASE}/accounts/${f.accountId}`;
  const runCount = () => db.prepare("SELECT COUNT(*) n FROM ai_runs").get().n;
  const pendingCount = () => db.prepare("SELECT COUNT(*) n FROM proposals WHERE status='pending'").get().n;
  const beforeRuns = runCount(), beforePending = pendingCount();
  const researchSnapshot = () => JSON.stringify(db.prepare("SELECT * FROM documents WHERE account_id=? AND kind='research_note' ORDER BY id").all(f.accountId));
  const beforeResearch = researchSnapshot();
  await page.goto(`${BASE}/accounts/${f.emptyId}`);
  c.is("empty follow-ups offer a way to add one", await page.locator(`#follow-ups a[href$="/follow-ups"]`).count(), 1);
  await openTab(page, "meetings");
  c.is("empty meetings retain an add control", await page.locator("#meetings button").count() > 0, true);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    await page.goto(`${BASE}/accounts/${f.emptyId}/meetings`);
    const meetings = page.locator('#meetings');
    const add = page.getByTestId('meeting-new-open'), paste = page.getByTestId('invite-paste-open');
    const rowDifference = await meetings.evaluate(el => Math.abs(el.querySelector('[data-testid="meeting-new-open"]').getBoundingClientRect().y - el.querySelector('[data-testid="invite-paste-open"]').getBoundingClientRect().y));
    c.is(`empty meeting controls share a row at ${width}`, rowDifference < 2, true);
    await add.click();
    c.is(`new meeting editor has full width at ${width}`, (await page.getByTestId('meeting-new').boundingBox()).width >= (await meetings.boundingBox()).width * 0.85, true);
    await page.getByTestId('meeting-new').getByRole('button', { name: 'Cancel', exact: true }).click();
    await paste.click();
    c.is(`invite input has usable width at ${width}`, (await page.getByTestId('invite-text').boundingBox()).width >= (await meetings.boundingBox()).width * 0.75, true);
    await page.getByTestId('invite-paste').getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.goto(`${BASE}/accounts/${f.emptyId}/follow-ups`);
    await page.getByTestId('follow-up-add').click();
    c.is(`empty follow-up editor has full width at ${width}`, (await page.locator('#follow-ups form').boundingBox()).width >= (await page.locator('#follow-ups').boundingBox()).width * 0.85, true);
    await page.locator('#follow-ups form').getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    await page.goto(`${BASE}/accounts/${f.emptyId}/plays`);
    const plan = page.locator('#plan');
    c.is(`draft availability guidance remains at ${width}`, (await plan.innerText()).includes('Import a report, add a deal, or run research first'), true);
    await page.getByTestId('play-new-open').click();
    c.is(`manual play fields remain at ${width}`, await page.getByTestId('play-new').locator('[name="title"],[name="thesis"],[name="owner"],[name="next_step"],[name="next_step_due"]').count(), 5);
    c.is(`manual play editor fits at ${width}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.getByTestId('play-new').getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  await page.goto(`${accountUrl}/plays`);
  c.is("all six plays are in the scan list", await page.locator('[data-testid="play-scan-row"]').count(), 6);
  c.is("a pending plan is a link to review, not rendered inline", await page.getByTestId("plan-draft-waiting").isVisible() && (await page.locator('[data-testid="proposal-row"]').count()) === 0, true);
  await page.goto(accountUrl);
  c.is("nonempty follow-up stays visible", await page.getByText("Keep the nonempty follow-up visible", { exact: true }).isVisible(), true);
  c.is("what needs you, then the work, then Research, in the DOM", await page.evaluate(() => {
    const ids = ["needs-you", "follow-ups", "research"];
    return ids.slice(1).every((id, i) => !!(document.getElementById(ids[i]).compareDocumentPosition(document.getElementById(id)) & Node.DOCUMENT_POSITION_FOLLOWING));
  }), true);
  c.is("only one primary Open research action", await page.getByRole('link', { name: 'Open research', exact: true }).count(), 1);
  c.is("all retained findings counted", await page.getByTestId('research-panel-counts').innerText(), '114 retained findings across 3 notes');
  const previews = page.locator('[data-testid="research-panel-recent"] li');
  c.is("three distinct topic previews", await previews.count(), 3);
  c.is("topics do not repeat", new Set(await page.getByTestId('research-preview-topic').allTextContents()).size, 3);
  for (const [i, index] of [1, 36, 71].entries()) {
    c.is(`original finding index ${index} preserved`, await previews.nth(i).locator('a').getAttribute('href'), `/accounts/${f.accountId}/research?note=${f.retainedNoteId}&finding=${index}#finding-${f.retainedNoteId}-${index}`);
  }
  for (const width of [1440, 1280, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    await page.goto(accountUrl);
    const card = await page.locator('#research').evaluate(el => {
      const date = el.querySelector('[data-testid="research-panel-latest"]');
      const range = document.createRange(); range.selectNodeContents(date.querySelector('time'));
      return { overflow: el.scrollWidth > el.clientWidth, dateLines: range.getClientRects().length, nowrap: getComputedStyle(date).whiteSpace, text: date.textContent, plain: [...el.querySelectorAll('[data-testid="research-panel-recent"] p')].every(p => !p.querySelector('a') && getComputedStyle(p).textDecorationLine === 'none') };
    });
    c.is(`research card does not overflow at ${width}`, card.overflow, false);
    c.is(`latest note date is one intact line at ${width}`, card.dateLines === 1 && card.nowrap === 'nowrap' && /^Latest note: \d{4}-\d{2}-\d{2}$/.test(card.text), true);
    c.is(`preview paragraphs are plain at ${width}`, card.plain, true);
    if (width >= 1024) {
      const work = await page.locator('#follow-ups').boundingBox(), research = await page.locator('#research').boundingBox();
      c.is(`desktop columns stay distinct at ${width}`, research.x >= work.x + work.width && work.width > research.width, true);
    }
    c.is(`no horizontal overflow on the Overview at ${width}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.goto(`${accountUrl}/meetings`);
    const row = page.locator('[data-testid="account-meeting-row"]').first();
    const metrics = await row.evaluate(el => {
      const title = el.querySelector('[data-testid="meeting-row-title"]');
      const actions = el.querySelector('.meeting-row-actions');
      const box = title.getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(title);
      return { available: el.clientWidth, titleWidth: box.width, titleHeight: box.height, lineHeight: parseFloat(getComputedStyle(title).lineHeight), lines: range.getClientRects().length, actionsBelow: actions.getBoundingClientRect().top >= box.bottom, clamped: getComputedStyle(title).webkitLineClamp, full: title.textContent.includes("infrastructure planning teams") };
    });
    c.is(`title has full row width at ${width}`, metrics.titleWidth >= metrics.available - 2, true);
    c.is(`title is complete and unclamped at ${width}`, metrics.full && ["none", "", "0"].includes(metrics.clamped), true);
    c.is(`statuses and actions are below title at ${width}`, metrics.actionsBelow, true);
    if (width < 640) {
      c.is(`long title uses readable lines at ${width}`, metrics.lines >= 2 && metrics.titleHeight >= metrics.lineHeight * 2, true);
      c.is(`archive has a touch target at ${width}`, (await row.getByRole("button", { name: /^Archive / }).boundingBox()).height >= 44, true);
    }
    c.is(`no horizontal overflow on Meetings at ${width}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  }
  await page.goto(accountUrl);
  await previews.nth(2).locator('a').click();
  const deep = page.locator(`#finding-${f.retainedNoteId}-71`);
  await deep.waitFor({ state: 'visible' });
  c.is("deep finding exposes the complete ending", (await deep.innerText()).includes('Full ending 71.'), true);
  await page.goto(accountUrl);
  await page.getByRole('link', { name: 'Open research', exact: true }).click();
  await page.waitForURL(`${accountUrl}/research`);
  // The page opens on what we know by topic, across every run, with the
  // runs themselves listed under it.
  await page.getByTestId("research-by-topic").waitFor({ state: "visible" });
  c.is("opens on what we know by topic", await page.getByTestId('research-topic-row').count() >= 1, true);
  c.is("no single note is the default reading", await page.getByTestId('research-reading-note').count(), 0);
  c.is("every run is a tab away", (await page.getByTestId("research-tab-report").innerText()).replace(/\D+/g, ""), "3");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    // The brief leads: why now begins on the first screen.
    const lead = await page.locator('[data-testid="research-brief"] h3').first().evaluate(el => { const b = el.getBoundingClientRect(); return { top: b.top, line: parseFloat(getComputedStyle(el).lineHeight) }; });
    c.is(`why now begins in the initial viewport at ${width}`, lead.top >= 0 && lead.top + lead.line * 3 <= 844, true);
    const targets = await page.locator('[data-testid="research-topic-more"], [data-testid="research-tabs"] a').evaluateAll(els => els.every(a => a.getBoundingClientRect().height >= 44));
    c.is(`topic links and tabs are comfortable targets at ${width}`, targets, true);
    c.is(`what we know fits ${width}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  }
  await page.setViewportSize({ width: 1440, height: 844 });
  await page.goto(`${accountUrl}/research?view=report`);
  c.is("every run is listed on the Full report tab", await page.getByTestId('research-runs').locator('a').count(), 3);
  await page.goto(`${accountUrl}/research?read=${f.retainedNoteId}`);
  await page.waitForURL(url => url.searchParams.get("read") === f.retainedNoteId);
  await page.getByTestId("research-dossier").waitFor({ state: "visible" });
  c.is("full dossier is reachable", await page.getByTestId('research-dossier').isVisible(), true);
  c.is("one reading note", await page.getByTestId('research-reading-note').count(), 1);
  c.is("three saved notes selectable", await page.getByTestId('research-note-picker').locator('a').count(), 3);
  c.is("saved note picker starts closed", await page.getByTestId("research-note-picker").evaluate(el => el.open), false);
  for (const width of [1440, 1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const geometry = await page.locator("[data-finding-anchor]").first().evaluate(el => {
      const text = el.querySelector(".text-body"), box = text.getBoundingClientRect(), css = getComputedStyle(text);
      return { firstFindingY: box.top, width: box.width, font: parseFloat(css.fontSize), line: parseFloat(css.lineHeight), clamped: css.webkitLineClamp };
    });
    const hierarchy = await page.locator('.research-topic').evaluateAll(cards => {
      const first = cards[0], second = cards[1], heading = first.querySelector('h3');
      const panel = getComputedStyle(first), band = getComputedStyle(heading.parentElement);
      const a = first.getBoundingClientRect(), b = second.getBoundingClientRect();
      return { border: parseFloat(panel.borderLeftWidth), panel: panel.backgroundColor, band: band.backgroundColor,
        heading: parseFloat(getComputedStyle(heading).fontSize), count: parseFloat(getComputedStyle(heading.nextElementSibling).fontSize),
        columns: b.x > a.x + a.width - 1, gap: b.x > a.x ? b.x - a.right : b.top - a.bottom,
        plainRows: [...first.querySelectorAll('li')].every(row => parseFloat(getComputedStyle(row).borderLeftWidth) === 0) };
    });
    c.is(`topic boundary and heading zone render at ${width}`, hierarchy.border >= 1 && hierarchy.panel !== hierarchy.band && hierarchy.heading > hierarchy.count, true);
    c.is(`topic columns match viewport at ${width}`, hierarchy.columns, width >= 768);
    c.is(`topics have external space and plain findings at ${width}`, hierarchy.gap >= 16 && hierarchy.plainRows, true);
    console.log(`  geometry ${width}: ${JSON.stringify({ ...geometry, hierarchy })}`);
    if (process.env.E2E_LAYOUT_DEBUG && width === 320) await page.screenshot({ path: process.env.E2E_LAYOUT_DEBUG });
    if (width <= 390) {
      c.is(`comfortable finding text at ${width}`, geometry.font >= 15 && geometry.line >= 22 && geometry.width >= width - 72 && ["none", "", "0"].includes(geometry.clamped), true);
    }
    c.is(`reading page fits ${width}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  }
  await page.getByTestId("research-note-picker").locator("summary").click();
  await page.getByTestId('research-note-picker').locator(`a[href*="read=${f.otherNoteIds[0]}"]`).click();
  await page.waitForURL(url => url.searchParams.get("read") === f.otherNoteIds[0]);
  await page.locator(`#research-${f.otherNoteIds[0]}`).waitFor({ state: "visible" });
  c.is("picker closes after selecting note", await page.getByTestId("research-note-picker").evaluate(el => el.open), false);
  c.is("other note is read only", await page.getByTestId('research-adjust').count(), 0);
  c.is("capture limitation stays visible", await page.getByText('The model output limit was reached; the saved report may be incomplete.', { exact: true }).isVisible(), true);
  await page.getByTestId('research-dossier').getByRole('link', { name: 'View all 6 →', exact: true }).click();
  await page.waitForURL(url => url.searchParams.get("topic") === "technology" && url.searchParams.get("note") === f.otherNoteIds[0]);
  await page.getByTestId('research-topic').waitFor({ state: 'visible' });
  await page.getByTestId('research-topic').getByRole('link', { name: 'Read finding →', exact: true }).nth(2).click();
  await page.waitForURL(url => url.searchParams.get("finding") === "3" && url.searchParams.get("note") === f.otherNoteIds[0]);
  const exact = page.getByTestId('research-finding');
  await exact.waitFor({ state: 'visible' });
  c.is("exact original index preserved", new URL(page.url()).searchParams.get('finding'), '3');
  await exact.locator('summary').click();
  c.is("evidence confidence and provenance readable", (await exact.innerText()).includes('Model confidence: medium') && (await exact.innerText()).includes('not an original-source quotation'), true);
  const exactUrl = page.url();
  await page.reload();
  // Server markup can precede App Router hydration; let the reload's client
  // bundles settle before exercising same-document browser history.
  await page.waitForLoadState('networkidle');
  await page.getByTestId("research-finding").waitFor({ state: "visible" });
  c.is("reload preserves exact finding and hash", page.url(), exactUrl);
  c.is("reload preserves full text", (await page.getByTestId('research-finding').innerText()).includes('Reading ending 1-3.'), true);
  await page.goBack();
  await page.waitForURL(url => url.searchParams.get("topic") === "technology" && url.searchParams.get("note") === f.otherNoteIds[0]);
  await page.getByTestId('research-topic').waitFor({ state: 'visible' });
  await page.goBack();
  await page.waitForURL(url => url.searchParams.get("read") === f.otherNoteIds[0]);
  await page.locator(`#research-${f.otherNoteIds[0]}`).waitFor({ state: "visible" });
  c.is("picker remains closed after Back", await page.getByTestId("research-note-picker").evaluate(el => el.open), false);
  c.is("Back restores selected note", new URL(page.url()).searchParams.get('read'), f.otherNoteIds[0]);
  await page.goto(`${accountUrl}/research?all=1`);
  c.is("all notes remain reachable", await page.getByTestId('research-reading-note').count(), 3);
  c.is("all retained findings remain reachable", await page.locator('[data-finding-anchor]').count(), 114);
  await page.goto(`${accountUrl}/meetings/${f.meetingId}`);
  c.is("pending review keeps notes first in DOM", await page.locator('[data-testid="meeting-workspace"]').evaluate(el => el.firstElementChild.id), "notes");
  c.is("pending review is the entry suggestion", await page.locator('[data-testid="meeting-focus"] a').getAttribute("href"), "#review");
  const mobileBrief = await page.locator('#brief').boundingBox(), mobileNotes = await page.locator('#notes').boundingBox();
  c.is("source notes lead visually on mobile", mobileNotes.y < mobileBrief.y, true);
  await page.setViewportSize({ width: 1440, height: 950 });
  const desktopBrief = await page.locator('#brief').boundingBox(), desktopNotes = await page.locator('#notes').boundingBox();
  c.is("desktop source notes are wider than retained brief", desktopNotes.width > desktopBrief.width && desktopBrief.x > desktopNotes.x, true);
  const reviewBox = await page.locator('#review').boundingBox();
  c.is("saved-brief review spans both columns", reviewBox.width >= desktopBrief.width + desktopNotes.width && reviewBox.y >= Math.max(desktopBrief.y + desktopBrief.height, desktopNotes.y + desktopNotes.height), true);
  c.is("one review and one notes editor", await page.locator('#review').count() === 1 && await page.locator('textarea[name="raw_notes"]').count() === 1, true);
  await page.setViewportSize({ width: 320, height: 950 });
  c.is("summary starts folded", await page.locator('#meeting-summary').evaluate(el => el.open), false);
  c.is("pending count is visible", await page.locator('[data-testid="meeting-nav"] a[href="#review"]').innerText(), "Review (1 pending)");
  const editor = page.locator('textarea[name="raw_notes"]');
  const original = await editor.inputValue();
  c.is("complete original notes remain", original.endsWith("complete final sentence."), true);
  await editor.fill(`${original}\nUnsaved synthetic edit.`);
  await editor.evaluate(el => { window.__layoutNotes = el; });
  for (const id of ["brief", "review", "notes"]) {
    await page.locator(`[data-testid="meeting-nav"] a[href="#${id}"]`).click();
    c.is(`${id} navigation keeps the same editor node`, await editor.evaluate(el => el === window.__layoutNotes), true);
    c.is(`${id} navigation keeps dirty text`, (await editor.inputValue()).endsWith("Unsaved synthetic edit."), true);
  }
  await page.locator('a[href="#meeting-summary"]').click();
  await page.waitForFunction(() => document.querySelector('#meeting-summary').open);
  c.is("summary anchor reveals the full ending", (await page.locator('#meeting-summary p').innerText()).endsWith("Complete summary ending."), true);
  // The same long title must also get real reading width in Home's upcoming list.
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  db.prepare("UPDATE meetings SET held_at=? WHERE id=?").run(tomorrow, f.meetingId);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    await page.goto(BASE);
    const row = page.locator('[data-testid="home-meeting-row"]').filter({ has: page.locator(`a[href$="/meetings/${f.meetingId}"]`) });
    c.is(`Home title has full reading width at ${width}`, await row.evaluate(el => el.querySelector('.home-meeting-title').getBoundingClientRect().width >= el.clientWidth - 2), true);
  }
  await page.goto(`${accountUrl}/research`);
  // Reading leads when notes are kept: the first research section is not the
  // run form or a draft, and running again waits behind one closed action.
  c.is("saved research leads when retained notes exist", ["research-run", "research-review"].includes(await page.locator('section[id^="research-"]').first().getAttribute("id")), false);
  c.is("generation waits behind one closed action", await page.locator('[data-testid="research-run-open"]:not([open])').count(), 1);
  c.is("one heading, the account's", await page.locator('h1').innerText(), "Synthetic Layout Lab");
  c.is("account context remains: Research is a tab of the account", await page.locator('[data-testid="account-tab-research"][aria-current="page"]').count(), 1);
  await page.goto(`${accountUrl}/summary/details`);
  const dealScroll = page.getByTestId('summary-deal-scroll').first();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${accountUrl}/summary/details?keyboard=${width}`);
    c.is(`full details fits ${width}`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
    c.is(`deal table stays readable within its scroller ${width}`, await dealScroll.evaluate(el => el.scrollWidth > el.clientWidth && el.querySelector('td').getBoundingClientRect().width >= 140), true);
    let reachedByTab = false;
    for (let step = 0; step < 30; step++) {
      await page.keyboard.press('Tab');
      if (await dealScroll.evaluate(el => document.activeElement === el)) { reachedByTab = true; break; }
    }
    c.is(`deal scroller reached by Tab ${width}`, reachedByTab, true);
    const originalScroll = await dealScroll.evaluate(el => el.scrollLeft);
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(({ selector, original }) => document.querySelector(selector).scrollLeft > original, { selector: '[data-testid="summary-deal-scroll"]', original: originalScroll });
    c.is(`ArrowRight scrolls deal table ${width}`, await dealScroll.evaluate(el => el.scrollLeft) > originalScroll, true);
    for (let step = 0; step < 12; step++) await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => { const el = document.querySelector('[data-testid="summary-deal-scroll"]'); return el.querySelector('td:last-child').getBoundingClientRect().right <= el.getBoundingClientRect().right + 1; });
    c.is(`deal amount reachable ${width}`, await dealScroll.evaluate(el => el.querySelector('td:last-child').getBoundingClientRect().right <= el.getBoundingClientRect().right + 1), true);
  }
  c.is('full deal title preserved', (await dealScroll.innerText()).includes('Synthetic planning opportunity with a preserved title'), true);
  await page.setViewportSize({ width: 794, height: 1123 });
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.fonts.ready);
  c.is('print removes deal-table scrolling', await dealScroll.evaluate(el => getComputedStyle(el).overflowX === 'visible' && getComputedStyle(el.querySelector('table')).minWidth === '0px'), true);
  c.is('all deal columns fit the print page', await dealScroll.evaluate(el => { const r = el.querySelector('table').getBoundingClientRect(); return r.left >= 0 && r.right <= document.documentElement.clientWidth + 1; }), true);
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  c.is('full PDF generated', pdf.subarray(0, 4).toString() === '%PDF' && pdf.length > 1000, true);
  if (process.env.E2E_PRINT_PATH) {
    writeFileSync(process.env.E2E_PRINT_PATH, pdf);
    await dealScroll.screenshot({ path: process.env.E2E_PRINT_PATH + '.png' });
  }
  await page.emulateMedia({ media: 'screen' });
  const quickDeal = db.prepare('SELECT deal_id, next_step FROM deals WHERE account_id=? AND name=?').get(f.accountId, 'Synthetic planning opportunity with a preserved title');
  let savedStep = quickDeal.next_step;
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    await page.goto(`${BASE}/pipeline`, { waitUntil: 'networkidle' });
    const trigger = page.getByTestId(`deal-quick-${quickDeal.deal_id}`);
    c.is(`next-step trigger is readable and touch sized at ${width}`, await trigger.evaluate(el => el.getBoundingClientRect().height >= 44 && !/line-clamp|truncate/.test(el.className)), true);
    c.is(`existing steps say they can be edited at ${width}`, savedStep ? (await trigger.getAttribute('aria-label')) === `Edit next step: ${savedStep}` : (await trigger.innerText()).includes('Set a next step'), true);
    await trigger.focus();
    await page.keyboard.press('Enter');
    const editor = page.locator('form').filter({ has: page.locator('textarea[name="next_step"]') });
    c.is(`keyboard opens existing step at ${width}`, await editor.locator('textarea').inputValue(), savedStep ?? '');
    await editor.locator('textarea').fill('Synthetic cancelled edit');
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    c.is(`Cancel preserves stored step at ${width}`, db.prepare('SELECT next_step FROM deals WHERE deal_id=?').get(quickDeal.deal_id).next_step, savedStep);
    await trigger.click();
    savedStep = `Confirm the synthetic planning date at width ${width}`;
    await editor.locator('textarea').fill(savedStep);
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await trigger.waitFor({ state: 'visible' });
    await page.reload({ waitUntil: 'networkidle' });
    c.is(`Save persists and stays editable at ${width}`, (await trigger.innerText()).includes(savedStep) && (await trigger.getAttribute('aria-label'))?.startsWith('Edit next step'), true);
    c.is(`saved editor fits at ${width}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  }
  await page.goto(`${BASE}/accounts/${f.emptyId}/research`);
  c.is("empty research starts with run form", await page.locator('section[id^="research-"]').first().getAttribute("id"), "research-run");
  c.is("navigation generated nothing", runCount(), beforeRuns);
  c.is("navigation accepted nothing", pendingCount(), beforePending);
  c.is("navigation left every research note untouched", researchSnapshot(), beforeResearch);
} finally {
  db.close();
  await browser.close();
}
process.exit(c.done() ? 0 : 1);
