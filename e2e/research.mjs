// Research, from the button to a finding that survives review.
//
// This is the largest surface in the app with no browser flow behind it. The
// library tests prove the two evidence guards drop what they should, and the
// acceptance route has its own regressions — but nothing until now opened the
// page, pressed the button, ticked a box and checked that the thing ticked is
// the thing stored. A deleted control would have looked exactly like a passing
// suite, which is the failure this project has already paid for twice.
//
// Everything here runs under AI_FAKE=1: no search, no fetch, no spend. The
// canned answer is built from the real prose and the real harvested sources,
// so the guards do their actual work rather than being stubbed out.
import { checker, launch, signIn } from "./browser.mjs";

const browser = await launch();
const c = checker("research, reviewed before it counts");
const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);

const trigger = page.locator('[data-testid="account-new-open"]');
if (await trigger.count()) await trigger.click();
await page.fill('[data-testid="account-new"] [name="name"]', "Fenwick Regional Authority");
await page.click('[data-testid="account-new-submit"]');
await page.waitForURL(/\/accounts\//, { timeout: 15000 });
const accountUrl = page.url();

// The affordance has to be reachable from the account, not only at a URL.
c.is("the account page offers research", await page.locator('a[href$="/research"]').count() > 0, true);
await page.goto(`${accountUrl}/research`);

// The spend line is on the page before the expensive button, not after it.
const beforeRun = await page.innerText("body");
c.is("the day's spend is shown before you press anything", /AI today|\$\d/.test(beforeRun), true);

// What the button is about to spend, before it is pressed. The figure is
// computed on the server from the same rate the run is charged at, so this
// also proves the page is wiring that through rather than the component
// defaulting to something plausible.
const beforeThePress = await page.innerText("body");
c.is("the plan says what it looks for before what it costs", /What it looks for/.test(beforeThePress) && beforeThePress.indexOf("What it looks for") < beforeThePress.indexOf("search charges"), true);
c.is("and what a thorough run costs in search", /15 searches and 10 pages fetched · about \$0\.15/.test(beforeThePress), true);
c.is("and what the quicker one costs", /quicker look: up to 8 searches and 5 pages fetched, about \$0\.08/i.test(beforeThePress), true);
c.is("the first time, it says what you get", await page.getByTestId("research-first-time").count(), 1);

await page.fill('[data-testid="research-focus"]', "what is published about their next data centre");
await page.click('[data-testid="research-run"]');
// What it is doing, while it does it.
await page.waitForSelector('[data-testid="research-steps"] li', { timeout: 30000 });
c.is("the run shows its searches as it makes them", /Searched/.test(await page.innerText('[data-testid="research-steps"]')), true);
await page.waitForSelector('[data-testid="research-result"]', { timeout: 60000 });

const result = await page.innerText('[data-testid="research-result"]');
c.is("the run reports what it found", /finding/.test(result), true);
// Fetches are requests, not proof a page was read, and the copy says fetched.
c.is("and counts fetches, never pages read", /pages? fetched/.test(result) && !/pages read/.test(result), true);

// The note is a draft: it does not count until a person accepts it.
await page.goto(`${accountUrl}/research`);
const body = await page.innerText("body");
c.is("the note is waiting for review, not applied", /Review findings/i.test(body), true);

const boxes = page.locator('[data-testid="keep-finding"]');
const found = await boxes.count();
c.is("every surviving finding is offered for review", found > 0, true);
// All are ticked by default; untick the first, so what is stored is what was
// chosen rather than everything that came back.
await boxes.first().uncheck();
const keptCount = found - 1;

await page.click('[data-testid="note-accept"]');
await page.waitForTimeout(2000);
await page.goto(`${accountUrl}/research?view=report`);
c.is("the accepted note appears in saved research", await page.locator('[data-testid="research-runs"] a').count(), 1);
c.is("and its full report is open on the Full report tab", await page.locator('[data-testid="research-report-tab"] [data-testid="research-full-report"][open]').count(), 1);
await page.goto(`${accountUrl}/research`);
const after = await page.innerText("body");
c.is("and what it kept is read by topic", await page.locator('#research-notes [data-testid="research-topic-row"]').count() >= 1, true);
c.is("saved reading does not load adjustment controls", await page.getByTestId("research-adjust").count(), 0);
c.is("and it is no longer waiting for review", /Review findings/i.test(after), false);
// The run itself, read whole, is one link from what we know.
await page.goto(`${accountUrl}/research?view=report`);
await page.locator('[data-testid="research-report-tab"] a[href*="read="]').first().click();
await page.waitForURL(/[?&]read=/, { timeout: 15000 });
await page.waitForSelector('[data-testid="research-reading-note"]', { timeout: 15000 });

// The one that matters: what is stored is what was ticked. The acceptance
// endpoint used to slice the selection at 100 and report the request's own
// length back, so it claimed success for findings it had just dropped.
//
// Two ways of asking, because they fail differently. The re-review panel
// re-opens every original finding with the kept ones ticked, so its checked
// count is the stored selection read back. The list above it renders only the
// kept ones, so its length is what the note now counts as true.
// Re-review, resolve and the resolution record are one affordance now, and it
// is a link rather than a disclosure: as a <details> it shipped every finding
// of every accepted note on every load, which at four notes of fifty was 200
// checkboxes and 888 <option>s nobody had asked to see.
c.is("management starts secondary", await page.getByTestId("research-manage").evaluate(el => el.open), false);
await page.getByTestId("research-manage").locator("summary").click();
await page.click('[data-testid="research-adjust-link"]');
await page.waitForSelector('[data-testid="research-adjust"]', { timeout: 15000 });
const boxesAfter = page.locator('[data-testid="keep-finding"]');
c.is("re-review still offers every original finding", await boxesAfter.count(), found);
let stillChecked = 0;
for (let i = 0; i < (await boxesAfter.count()); i++) if (await boxesAfter.nth(i).isChecked()) stillChecked++;
c.is("and exactly the ones kept are ticked", stillChecked, keptCount);
c.is("the unticked one did not come back", stillChecked < found, true);

// The full report is kept whatever review decided, so a note can be re-read
// and re-extracted without paying for the searches twice.
//
// Exactly one copy of it. The run form rendered it, the note rendered it, and
// the re-review panel inside the note rendered it again — three copies of the
// same few hundred KB of prose on one screen, each inside its own <details>,
// each shipped whether or not anybody opened it.
c.is("the full research report is retained, once", await page.locator('[data-testid="research-full-report"]').count(), 1);

// The note reads back its own summary. The paragraph above the findings used
// to be every kept finding's text joined with spaces and cut at 1200
// characters — the list below it with the line breaks taken out — while the
// model's summary was shown once, while the note was still a draft, and never
// again. The fake answer's summary is a sentence that appears in no finding,
// so its presence is the assertion.
//
// It is now behind a disclosure under the retained findings rather than above
// them — unreviewed model prose does not lead a card whose subject is what
// review kept — so this opens it first. Kept, labelled and complete; not
// deleted, and not promoted.
const summaryDisclosure = page.locator('[data-testid="research-original-summary"]').first();
c.is("the model's summary is secondary to the retained findings", await summaryDisclosure.count(), 1);
await summaryDisclosure.locator("summary").first().click();
const afterOpen = await page.innerText("body");
c.is("the accepted note shows its summary, not its findings glued together", /has published a multi-year capital plan/.test(afterOpen), true);

// And it is the *model's* summary, said to be that. It was written over
// everything the run found, before anybody ticked anything, so it can repeat a
// finding this review rejected — printed as an unqualified paragraph beside
// the kept findings, that is the rejected claim coming back in the app's own
// voice. It is kept whole (nothing here is deleted) and labelled.
const original = page.locator('[data-testid="original-summary"]');
c.is("the original summary is kept, in one labelled block", await original.count(), 1);
// Eyebrow uses CSS uppercase, which Playwright innerText reflects.
const label = await original.innerText();
c.is("it holds the model's own paragraph", /has published a multi-year capital plan/.test(label), true);
c.is("and says whose words they are and that review did not pass over them", /Original model summary/i.test(label) && /not reviewed/i.test(label), true);
c.is("and says how much of the note was actually accepted", new RegExp(`${keptCount} of ${found} finding`).test(label), true);
// The reviewed surface is the findings, which are rendered outside that block.
const dossier = await page.innerText('[data-testid="research-dossier"]');
c.is("the kept findings are shown apart from the model's prose", dossier.length > 0, true);
c.is("and the model's summary is not repeated among them", /has published a multi-year capital plan/.test(dossier), false);

// The account page is a preview of research, not a second copy of it. It used
// to inline three whole notes — each with its unreviewed model summary and ten
// findings — a third of the way down a column of account work.
await page.goto(accountUrl);
const account = await page.innerText("body");
c.is("the account page has its own Research section", /Research/i.test(account), true);
const panel = page.locator('[data-testid="research-panel-counts"]');
c.is("which says how much research is on file", await panel.count(), 1);
c.is("counted as findings kept after review", /retained finding/i.test(await panel.innerText()), true);
// The model's unreviewed paragraph belongs on the page that holds the note,
// not on the account overview, where it read as the account's own answer.
c.is("and does not reprint the unreviewed model summary", await page.locator('[data-testid="original-summary"]').count(), 0);
c.is("nor the model's paragraph in any other guise", /has published a multi-year capital plan/.test(account), false);
// What it does have is one way through to all of it.
c.is("the panel opens the research page", await page.locator('[data-testid="research-open"]').count(), 1);

await browser.close();
process.exit(c.done() ? 0 : 1);
