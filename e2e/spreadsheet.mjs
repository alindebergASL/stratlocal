// A CRM export, read without a model.
//
// The library tests cover the parser, the guess and the diff. What they cannot
// see is whether the two-step screen exists and whether the second step is
// really gated on the first: the whole design is that a mapping is confirmed
// before anything is proposed, and a version of this that quietly applied the
// guess would pass every test in tests/sheet.test.ts.
import { join } from "node:path";
import { BASE, checker, launch, signIn, openTab, reviewAsList } from "./browser.mjs";

const browser = await launch();
const c = checker("a spreadsheet becomes reviewable changes");
const alex = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);

const trigger = alex.locator('[data-testid="account-new-open"]');
if (await trigger.count()) await trigger.click();
await alex.fill('[data-testid="account-new"] [name="name"]', "Synthetic Orchard Lab");
await alex.click('[data-testid="account-new-submit"]');
await alex.waitForURL(/\/accounts\//, { timeout: 15000 });
const accountUrl = alex.url();

// A deal already on file, so the import has something to update as well as
// something to create — one-sided would not prove the diff ran.
await openTab(alex, "deals");
await alex.click('[data-testid="deal-new-open"]');
await alex.fill('[data-testid="deal-new"] [name="deal_id"]', "SYN-DEAL-001");
await alex.fill('[data-testid="deal-new"] [name="name"]', "EHR Refresh");
await alex.fill('[data-testid="deal-new"] [name="tcv_usd"]', "1K");
await alex.click('[data-testid="deal-new-submit"]');
await alex.waitForTimeout(1500);

// The link has to be on the account page, not just the route reachable by URL.
await alex.goto(accountUrl);
await openTab(alex, "deals");
c.is("the account page offers it", await alex.locator('[data-testid="import-sheet"]').count(), 1);
await alex.click('[data-testid="import-sheet"]');
await alex.waitForURL(/\/import-sheet$/, { timeout: 15000 });

await alex.setInputFiles('[data-testid="sheet-file"]', join(process.cwd(), "tests/fixtures/pipeline-export.csv"));
await alex.click('[data-testid="sheet-upload"]');
await alex.waitForSelector('[data-testid="sheet-mapping"]', { timeout: 20000 });

// Step one proposes nothing. This is the assertion the design exists for.
c.is("nothing is proposed from the upload alone", /proposed change/.test(await alex.innerText("body")), false);
// Checked from a second tab rather than by navigating away: the mapping lives
// in the form's own state, so leaving the page and coming back would throw it
// away and the rest of this flow would be testing a fresh upload.
const other = await alex.context().newPage();
await other.goto(accountUrl);
c.is("and the account is not waiting on anything yet", await other.locator('[data-testid="needs-you-row"][data-kind="review"]').count(), 0);
await other.close();

// The guess reached the screen, in the export's own words.
const guessed = await alex.locator('[data-testid="map-close_date"]').inputValue();
c.is("the close date column is guessed", guessed !== "", true);
const closeHeader = await alex.locator(`[data-testid="map-close_date"] option[value="${guessed}"]`).innerText();
c.is("and it is the close date, not the created date", closeHeader.trim(), "Expected Close");

// The mapping grid is the one shape e2e/widths.mjs cannot reach: it exists
// only after a file has been chosen, and that flow measures pages by URL. A
// row of it is a label, a select and a sample of the column's values, which is
// exactly the kind of row that overflows a phone (DECISIONS #11).
await alex.setViewportSize({ width: 390, height: 900 });
const overflow = await alex.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
c.is("the mapping fits a phone", overflow <= 0, true);
await alex.setViewportSize({ width: 1280, height: 900 });

// A mapping that cannot be applied is refused on the screen rather than by the
// server after the press.
await alex.selectOption('[data-testid="map-name"]', "");
c.is("no name means it cannot be applied", await alex.locator('[data-testid="sheet-apply"]').isDisabled(), true);
c.is("and says why", await alex.locator('[data-testid="sheet-mapping-problem"]').count(), 1);

// Put it back, and apply.
const nameOption = await alex.locator('[data-testid="map-name"] option', { hasText: "Opportunity Name" }).getAttribute("value");
await alex.selectOption('[data-testid="map-name"]', nameOption);
c.is("and it can be applied again", await alex.locator('[data-testid="sheet-apply"]').isDisabled(), false);
await alex.click('[data-testid="sheet-apply"]');
await alex.waitForSelector('[data-testid="sheet-result"]', { timeout: 20000 });

const result = await alex.innerText('[data-testid="sheet-result"]');
c.is("it proposes the difference", /4 proposed changes/.test(result), true);
// The rows it could not read are named, by row number and reason. A row
// silently missing is the failure this screen exists to avoid.
c.is("and says what it could not read", /3 rows could not be read/.test(result), true);
await alex.click('[data-testid="sheet-skipped"] summary');
const skipped = await alex.innerText('[data-testid="sheet-skipped"]');
c.is("naming the row", /Row 6/.test(skipped), true);
c.is("and the reason", /different quarter/.test(skipped), true);

// Accept, and the deals are on the account.
await alex.goto(`${accountUrl}/review`);
await reviewAsList(alex);
await alex.click('[data-testid="accept-all"]');
await alex.waitForSelector("text=/applied/", { timeout: 30000 });
await alex.goto(accountUrl);
await openTab(alex, "deals");
const account = await alex.innerText("body");
c.is("the new deals are here", account.includes("SyntheticOrchard_Campus-Wireless"), true);
c.is("the row with no CRM id came too", account.includes("SyntheticOrchard_Analytics-Pilot"), true);
// The deal row renders tcv with fmtMoney, so this is the long form. Two
// earlier spellings of this assertion ("$1.2K", then "$1.20K") were guesses at
// a format the page does not use on that row, and both failed against an
// import that had worked.
c.is("and the existing deal took the spreadsheet's value", account.includes("$1,200"), true);

// The same file again. Every row that carries a CRM id matches what is now on
// file and proposes nothing — re-importing is not a way to duplicate a
// pipeline. The one row with no id is the exception, and it is the exception
// on purpose: there is nothing to match it on, matching by name would let a
// rename in the CRM overwrite an unrelated deal, so it comes back as a
// proposal that says it would be a second row.
await alex.goto(`${accountUrl}/import-sheet`);
await alex.setInputFiles('[data-testid="sheet-file"]', join(process.cwd(), "tests/fixtures/pipeline-export.csv"));
await alex.click('[data-testid="sheet-upload"]');
await alex.waitForSelector('[data-testid="sheet-mapping"]', { timeout: 20000 });
await alex.click('[data-testid="sheet-apply"]');
await alex.waitForSelector('[data-testid="sheet-result"]', { timeout: 20000 });
c.is("importing it again proposes only the row with no id", /1 proposed change/.test(await alex.innerText('[data-testid="sheet-result"]')), true);
await alex.goto(`${accountUrl}/review`);
await reviewAsList(alex);
const again = await alex.innerText("body");
c.is("and the card says it would be a second row", /Accepting adds a second row/.test(again), true);

// The other list a seller has lying around: people.
//
// Same screen, same two steps. What is its own is the kind — guessed from the
// headers and confirmed, because a people file read as deals does not fail, it
// proposes a pipeline named after colleagues, one plausible card at a time.
await alex.goto(`${accountUrl}/import-sheet`);
await alex.setInputFiles('[data-testid="sheet-file"]', join(process.cwd(), "tests/fixtures/people-export.csv"));
await alex.click('[data-testid="sheet-upload"]');
await alex.waitForSelector('[data-testid="sheet-mapping"]', { timeout: 20000 });

c.is("a file of people is guessed as people", await alex.locator('[data-testid="sheet-kind-contact"]').isChecked(), true);
c.is("and the fields shown are a person's", await alex.locator('[data-testid="map-email"]').count(), 1);
c.is("not a deal's", await alex.locator('[data-testid="map-close_date"]').count(), 0);

// Switching the kind is what the radio is for, and it has to change the field
// table with it — a leftover Close Date mapping would point at a column on a
// screen that no longer shows it.
await alex.click('[data-testid="sheet-kind-deal"]');
c.is("switching to deals swaps the fields", await alex.locator('[data-testid="map-close_date"]').count(), 1);
await alex.click('[data-testid="sheet-kind-contact"]');
c.is("and back again", await alex.locator('[data-testid="map-email"]').count(), 1);
c.is("with the columns guessed afresh", await alex.locator('[data-testid="map-email"]').inputValue() !== "", true);

await alex.click('[data-testid="sheet-apply"]');
await alex.waitForSelector('[data-testid="sheet-result"]', { timeout: 20000 });
const people = await alex.innerText('[data-testid="sheet-result"]');
c.is("it proposes the people", /4 proposed changes/.test(people), true);
c.is("and names the rows it could not read", /3 rows could not be read/.test(people), true);
await alex.click('[data-testid="sheet-skipped"] summary');
const badPeople = await alex.innerText('[data-testid="sheet-skipped"]');
c.is("including the one whose address is not one", /Row 4/.test(badPeople), true);
c.is("saying why", /not-an-address/.test(badPeople), true);

// Review groups by batch, and the re-import above deliberately left one deal
// proposal pending — so there are two Accept alls here, and pressing the first
// one applies the deals and leaves the people exactly where they were. That is
// the scoping working (DECISIONS: a batch is one accept), not a bug, so this
// presses each group in turn.
await alex.goto(`${accountUrl}/review`);
await reviewAsList(alex);
for (let i = 0; i < 5; i += 1) {
  const buttons = alex.locator('[data-testid="accept-all"]');
  if ((await buttons.count()) === 0) break;
  await buttons.first().click();
  await alex.waitForSelector("text=/applied/", { timeout: 30000 });
  await alex.goto(`${accountUrl}/review`);
  await reviewAsList(alex);
}
await alex.goto(accountUrl);
await openTab(alex, "people");
const withPeople = await alex.innerText("body");
c.is("the new people are on the account", withPeople.includes("Rowan Example"), true);
c.is("including the one at a partner", withPeople.includes("Sasha Example"), true);

// The same file again finds all four — by address, and by name for the one
// with none. No id anywhere in it, which is the whole matching rule working.
await alex.goto(`${accountUrl}/import-sheet`);
await alex.setInputFiles('[data-testid="sheet-file"]', join(process.cwd(), "tests/fixtures/people-export.csv"));
await alex.click('[data-testid="sheet-upload"]');
await alex.waitForSelector('[data-testid="sheet-mapping"]', { timeout: 20000 });
await alex.click('[data-testid="sheet-apply"]');
await alex.waitForSelector('[data-testid="sheet-result"]', { timeout: 20000 });
c.is("importing the people again proposes nothing", /Nothing to propose/.test(await alex.innerText('[data-testid="sheet-result"]')), true);

// The third kind: an install base, which is a dated snapshot rather than a
// list of records — so the screen asks for the date as well as the columns.
await alex.goto(`${accountUrl}/import-sheet`);
await alex.setInputFiles('[data-testid="sheet-file"]', join(process.cwd(), "tests/fixtures/install-base-export.csv"));
await alex.click('[data-testid="sheet-upload"]');
await alex.waitForSelector('[data-testid="sheet-mapping"]', { timeout: 20000 });

c.is("an install base is guessed from its headers", await alex.locator('[data-testid="sheet-kind-install_base"]').isChecked(), true);
c.is("and it asks for the date the snapshot describes", await alex.locator('[data-testid="sheet-as-of"]').count(), 1);
c.is("which the other kinds do not", await alex.locator('[data-testid="map-share_pct"]').count(), 1);

await alex.fill('[data-testid="sheet-as-of"]', "2026-03-31");
await alex.click('[data-testid="sheet-apply"]');
await alex.waitForSelector('[data-testid="sheet-result"]', { timeout: 20000 });
const ib = await alex.innerText('[data-testid="sheet-result"]');
c.is("it proposes a line per family it could read", /3 proposed changes/.test(ib), true);
c.is("and names the rows it could not", /4 rows could not be read/.test(ib), true);
await alex.click('[data-testid="sheet-skipped"] summary');
const ibBad = await alex.innerText('[data-testid="sheet-skipped"]');
c.is("including a share outside 0 to 100", /between 0 and 100/.test(ibBad), true);
c.is("and a family listed twice in one snapshot", /earlier row/.test(ibBad), true);

await alex.goto(`${accountUrl}/review`);

await reviewAsList(alex);
for (let i = 0; i < 5; i += 1) {
  const buttons = alex.locator('[data-testid="accept-all"]');
  if ((await buttons.count()) === 0) break;
  await buttons.first().click();
  await alex.waitForSelector("text=/applied/", { timeout: 30000 });
  await alex.goto(`${accountUrl}/review`);
  await reviewAsList(alex);
}
await alex.goto(`${accountUrl}/install-base`);
const ibPage = await alex.innerText("body");
c.is("the snapshot is on the install base page", ibPage.includes("2026-03-31"), true);
c.is("with the families from the file", ibPage.includes("Compute") && ibPage.includes("Networking"), true);

// A partial file under a *new* date is the trap: every family it does not
// mention reads as a fall to zero on the account page, and every review card
// for it is an ordinary create, so the review screen could never tell you.
await alex.goto(`${accountUrl}/import-sheet`);
await alex.setInputFiles('[data-testid="sheet-file"]', join(process.cwd(), "tests/fixtures/install-base-partial.csv"));
await alex.click('[data-testid="sheet-upload"]');
await alex.waitForSelector('[data-testid="sheet-mapping"]', { timeout: 20000 });
await alex.fill('[data-testid="sheet-as-of"]', "2026-06-30");
await alex.click('[data-testid="sheet-apply"]');
await alex.waitForSelector('[data-testid="sheet-result"]', { timeout: 20000 });
c.is("a partial file says what it will do to the trend", await alex.locator('[data-testid="sheet-warning"]').count(), 1);
c.is("naming the snapshot it is shorter than", /2026-03-31/.test(await alex.innerText('[data-testid="sheet-warning"]')), true);

// And it cost nothing, which is the point of not using a model to read a
// header row: Home's spend tile is still at zero.
await alex.goto(BASE);
await alex.locator('[data-testid="system-status"] > summary').click();
c.is("no model was called", /AI today:\s*\$0\.00/i.test(await alex.innerText("body")), true);

await browser.close();
process.exit(c.done() ? 0 : 1);
