// The weekly rhythm: walk the quarter, slip what slipped, without leaving
// the page — and then the two screens that used to need a page load each.
//
// /pipeline was already the right shape and then stopped: the quick edit
// submitted stage, next step and status only, so the commonest outcome of a
// review — a close date moving — meant the deal page, a disclosure, a save,
// and coming back to a list that had lost your place. Per deal.
import { BASE, checker, launch, signIn, openTab, reviewAsList } from "./browser.mjs";
import { join } from "node:path";

const browser = await launch();
const c = checker("the weekly review");
const alex = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);

const trigger = alex.locator('[data-testid="account-new-open"]');
if (await trigger.count()) await trigger.click();
await alex.fill('[data-testid="account-new"] [name="name"]', "Synthetic Orchard Lab");
await alex.click('[data-testid="account-new-submit"]');
await alex.waitForURL(/\/accounts\//, { timeout: 15000 });
const accountUrl = alex.url();
const accountId = accountUrl.split("/accounts/")[1].split(/[#/?]/)[0];

// A report, so there are deals to review and an install base to compare
// against. The date is the report's, not the clock's.
async function importReport(asOf) {
  await alex.goto(`${BASE}/accounts/${accountId}/import`);
  await alex.setInputFiles('input[type="file"]', join(process.cwd(), "tests/fixtures/agent-report.html"));
  await alex.fill('input[name="as_of"]', asOf);
  await alex.click('button:has-text("Upload and extract")');
  await alex.waitForSelector("text=/proposed change/", { timeout: 60000 });
  await alex.goto(`${BASE}/accounts/${accountId}/review`);
  await reviewAsList(alex);
  await alex.click('[data-testid="accept-all"]');
  await alex.waitForSelector("text=/applied/", { timeout: 30000 });
}

await importReport("2026-03-31");

// --- the review itself -------------------------------------------------------

await alex.goto(`${BASE}/pipeline`);
const quarters = await alex.locator('select[name="fq"] option').count();
c.is("the quarter filter offers the quarters on file", quarters > 1, true);

// Narrow to one quarter, then edit a row in place.
const firstQuarter = await alex.locator('select[name="fq"] option').nth(1).getAttribute("value");
await alex.goto(`${BASE}/pipeline?fq=${encodeURIComponent(firstQuarter)}`);
const rows = await alex.locator('[data-testid^="deal-quick-"]').count();
c.is("the list is narrowed to it", rows > 0, true);

const quick = alex.locator('[data-testid^="deal-quick-"]').first();
const dealId = (await quick.getAttribute("data-testid")).replace("deal-quick-", "");
await quick.click();
const form = alex.locator(`form:has(textarea[name="next_step"])`).first();
await form.locator('textarea[name="next_step"]').fill("Walk the sizing through with Dana");
await form.locator('input[name="close_date"]').fill("2027-05-14");
// Typed the way it gets said out loud in a review, not as digits.
await form.locator('input[name="tcv_usd"]').fill("1.4M");
await form.locator('button[type="submit"]').click();
await alex.waitForTimeout(1500);

await alex.goto(`${BASE}/accounts/${accountId}/deals/${encodeURIComponent(dealId)}`);
const dealPage = await alex.innerText("body");
c.is("the next step stuck", dealPage.includes("Walk the sizing through with Dana"), true);
c.is("the date slipped", dealPage.includes("2027-05-14") || dealPage.includes("14 May 2027"), true);
c.is("the value moved, read as 1.4M", /\$1\.4M|1,400,000/.test(dealPage), true);

// The whole point of slipping a date: the deal moves quarter.
await alex.goto(`${BASE}/pipeline?fq=${encodeURIComponent(firstQuarter)}`);
c.is("and it left the quarter it was in", (await alex.innerText("body")).includes("Walk the sizing through with Dana"), false);

// --- and it leaves as a spreadsheet ------------------------------------------

// Through the page's own link and the browser's own cookie, because a CSV
// route that works under curl and 401s from the app would be worse than none.
const exportHref = await alex.getAttribute('[data-testid="pipeline-export"]', "href");
// URLSearchParams encodes a space as "+", not "%20" — both are correct in a
// query string, and the route reads it back through the same API.
c.is("the pipeline offers an export carrying the filters", new URL(exportHref, BASE).searchParams.get("fq"), firstQuarter);
const csv = await alex.evaluate(async (href) => {
  const r = await fetch(href, { credentials: "same-origin" });
  return { status: r.status, type: r.headers.get("content-type"), body: await r.text() };
}, exportHref);
c.is("it comes back as a CSV", csv.status === 200 && (csv.type ?? "").startsWith("text/csv"), true);
// No BOM in this assertion: Response.text() decodes UTF-8 and strips a leading
// byte order mark by spec, so the browser never sees the one the file carries
// for Excel's sake. tests/csv.test.ts checks the bytes.
c.is("with a header row naming the account", csv.body.split("\r\n")[0], "account,deal_id,name,stage,stage_label,close_date,fiscal_quarter,tcv_usd,owner,competitor,partner,architecture,next_step,notes,status");
c.is("and only the quarter that was filtered", csv.body.split("\r\n").slice(1).filter(Boolean).every((l) => l.includes(firstQuarter)), true);

// --- a person has a page -----------------------------------------------------

await alex.goto(`${accountUrl}/people`);
const personHref = await alex.getAttribute('a[href*="/contacts/"]', "href").catch(() => null);
c.is("a person is reachable from the account", personHref !== null, true);
if (personHref) {
  await alex.goto(BASE + personHref);
  const person = await alex.innerText("body");
  c.is("their page names their meetings section", /meetings/i.test(person), true);
  c.is("and their history", /history/i.test(person), true);
}

// --- install base over time --------------------------------------------------

// The same report filed under a later date. Every figure is identical, so a
// trend that invented a movement here would be showing noise.
await importReport("2026-06-30");
await alex.goto(accountUrl);
await openTab(alex, "details");
const account = await alex.innerText("body");
c.is("the account names both snapshots", account.includes("as of 2026-06-30") && account.includes("was 2026-03-31"), true);

// --- correcting a snapshot ---------------------------------------------------

// Until now this was the one record with no manual path at all: a figure the
// model misread from a report table was permanent, and the trend is read off
// it. The account page stays a read and sends you here.
await openTab(alex, "details");
c.is("the account page offers the install base page", await alex.locator('[data-testid="install-base-page"]').count(), 1);
await alex.click('[data-testid="install-base-page"]');
await alex.waitForURL(/\/install-base$/, { timeout: 15000 });

const page1 = await alex.innerText("body");
c.is("every snapshot is here, not just the newest two", page1.includes("2026-06-30") && page1.includes("2026-03-31"), true);
const rowsBefore = await alex.locator('[data-testid="ib-row"]').count();
c.is("with its lines", rowsBefore > 0, true);

// The edit forms are on one snapshot, not on all of them. This is the
// assertion that matters rather than the byte count: a closed ActionForm
// serialises its children into the payload, so a form per row on every
// snapshot put this page at 570 KB against twenty snapshots of twenty-five
// families — the exact cost this page exists to keep off the account page,
// reproduced one level down. Measured, then bounded to a parameter.
// Counted by their triggers, because a *closed* ActionForm renders only a
// button — which is exactly why bounding this mattered: the button is cheap
// and the children it carries in the payload are not.
const editForms = await alex.locator('[data-testid^="ib-edit-"][data-testid$="-open"]').count();
c.is("the newest snapshot carries the edit forms", editForms > 0, true);
c.is("and only it does", editForms <= rowsBefore / 2 + 1, true);
c.is("the older snapshot offers to be corrected instead", await alex.locator('[data-testid="ib-edit-snapshot-2026-03-31"]').count(), 1);

// And following that link moves the forms rather than adding more.
await alex.click('[data-testid="ib-edit-snapshot-2026-03-31"]');
await alex.waitForURL(/edit=2026-03-31/, { timeout: 15000 });
c.is("the older snapshot can be corrected when asked", await alex.locator('[data-testid^="ib-edit-"][data-testid$="-open"]').count(), editForms);
c.is("and the newest one steps back", await alex.locator('[data-testid="ib-edit-snapshot-2026-06-30"]').count(), 1);
await alex.goto(`${accountUrl}/install-base`);

// Add a line the report missed, under the newest snapshot's date, which is
// what the form defaults to.
await alex.click('[data-testid="install-base-new-open"]');
await alex.waitForSelector('[data-testid="ib-family"]', { timeout: 15000 });
c.is("the date defaults to the newest snapshot", await alex.locator('[data-testid="ib-as-of"]').inputValue(), "2026-06-30");
await alex.fill('[data-testid="ib-family"]', "Synthetic Edge");
await alex.fill('[data-testid="ib-value"]', "1.5M");
await alex.fill('[data-testid="ib-share"]', "12");
await alex.click('[data-testid="install-base-new-submit"]');
await alex.waitForTimeout(1500);
await alex.goto(`${accountUrl}/install-base`);
const added = await alex.innerText("body");
c.is("the line is on file", added.includes("Synthetic Edge"), true);
c.is("with the value read the way it was typed", added.includes("$1,500,000"), true);

// And it reaches the account page's trend, which is the whole point of being
// able to write one down.
await alex.goto(accountUrl);
await openTab(alex, "details");
c.is("and the account page counts it", (await alex.innerText("body")).includes("Synthetic Edge"), true);

// A share out of range is refused by name rather than clamped to something
// plausible — the lesson TCV taught about a number quietly becoming another.
await alex.goto(`${accountUrl}/install-base`);
await alex.click('[data-testid="install-base-new-open"]');
await alex.waitForSelector('[data-testid="ib-family"]', { timeout: 15000 });
await alex.fill('[data-testid="ib-family"]', "Synthetic Nonsense");
await alex.fill('[data-testid="ib-share"]', "140");
await alex.click('[data-testid="install-base-new-submit"]');
await alex.waitForTimeout(1200);
c.is("a share of 140% is refused by name", /between 0 and 100/.test(await alex.innerText("body")), true);
await alex.goto(`${accountUrl}/install-base`);
c.is("and nothing was written", (await alex.innerText("body")).includes("Synthetic Nonsense"), false);

// Correcting a figure, which is what this round is for: the number changes and
// the old one stays on the record.
await alex.click('[data-testid="install-base-new-open"]').catch(() => {});
const editOpen = alex.locator('[data-testid$="-open"]').filter({ hasText: "Edit" }).first();
await editOpen.click();
await alex.waitForTimeout(500);
const valueBox = alex.locator('form[data-testid^="ib-edit-"] [name="value_usd"]').first();
await valueBox.fill("9000000");
await alex.locator('form[data-testid^="ib-edit-"] button[type="submit"]').first().click();
await alex.waitForTimeout(1500);
await alex.goto(`${accountUrl}/install-base`);
c.is("the corrected figure is stored", (await alex.innerText("body")).includes("$9,000,000"), true);

await browser.close();
process.exit(c.done() ? 0 : 1);
