// How much does a page weigh?
//
// This app's stated case is a phone before a meeting, and at a year of use
// /pipeline was shipping 1.6 MB of HTML and Home 247 KB — because both
// rendered every row they had. Neither is visible from a screen: the page
// looks right, it is just enormous, and nothing in the repo would ever have
// said so.
//
// Two kinds of check, because one of them alone would be decorative.
//
// The byte budgets are set just above what these pages weigh now, so an
// order-of-magnitude regression trips them. They are weak on their own: this
// flow builds fifty deals, and fifty deals uncapped is about 205 KB against
// the 1.6 MB that 540 produce — a budget loose enough to pass at this size
// would not have caught the bug that prompted this.
//
// So the assertions that actually bite are structural: the capped list must
// not contain the rows it says it is hiding. That is true at any size, and it
// is the precise mistake — a <details> hides rows and still ships them.
import { BASE, checker, launch, signIn, openTab, reviewAsList } from "./browser.mjs";
import { join } from "node:path";

// Enough rows that an uncapped list would blow the budget, few enough that the
// flow stays under a minute. The real fixture is scripts/load-fixture.mts.
const DEALS = 40;
const FOLLOW_UPS = 30;
// Plays, because the account page's weight is mostly a function of them: each
// one used to render an edit form carrying a checkbox per deal and per person.
// The flow built zero of them, so the budget below was guarding a shape the
// documented measurement never had — the fixture in scripts/load-fixture.mts
// builds eight per account, and that is the number the README quotes.
const PLAYS = 8;
// More than the Meetings tab's cap of twelve, because the meetings list was the
// last one whose tail was a <details> — rendered in a second markup and
// shipped whether or not anyone opened it. The flow built none, so nothing
// measured that.
const MEETINGS = 13;

const BUDGET_KB = {
  "/": 110,
  "/pipeline": 180,
  "/activity?days=30": 200,
  "/follow-ups": 110,
};

// The account page gets its own budget below, because it is measured after the
// account exists and it is the one that was 890 KB. Measured at 254 KB with
// the deals, follow-ups, plays, meetings and research run this flow builds.
//
// It is also the clearest evidence for why the byte budget is not the check
// that matters: uncapping the meetings list again took this page to 259 KB,
// still under budget, while the structural assertion below caught it at once.
// Two fixed planning capture controls and a three-task preview add bounded
// markup, not per-row editors. Keep the hidden-row structural checks below.
const ACCOUNT_BUDGET_KB = 180;

// The account's tabs, measured at the same volume (deals 212, plays 81,
// people 58, meetings 66, details 65 KB when the tabs arrived). The Overview
// was 280 KB as the one long page; as a summary it measured 150.
// The plays tab was 96 KB before plays were ranked; the rank and the
// ↑ ↓ ⋯ controls cost about 0.4 KB a play (in the HTML and again in the
// page's data), and it measured 105 KB with this flow's twelve plays.
const TAB_BUDGET_KB = { deals: 240, plays: 110, people: 80, meetings: 90, details: 90 };

// The research page is measured after a fake run and an accept, so it carries
// a real note with its findings, its coverage and its original report. Set
// from the measurement, not from a guess: 81 KB, then 94 KB once the page
// opened on a briefing (three leading findings and coverage by topic); 108
// KB once it carried peers and competitors and the customer's own documents,
// both capped sections rather than lists that grow with the account; 95 KB
// once those, and the full report, moved onto tabs of their own.
const RESEARCH_BUDGET_KB = 100;

const browser = await launch();
const c = checker("no page ships an unbounded list");
const alex = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);

const trigger = alex.locator('[data-testid="account-new-open"]');
if (await trigger.count()) await trigger.click();
await alex.fill('[data-testid="account-new"] [name="name"]', "Synthetic Orchard Lab");
await alex.click('[data-testid="account-new-submit"]');
await alex.waitForURL(/\/accounts\//, { timeout: 15000 });
const accountUrl = alex.url();
const accountId = accountUrl.split("/accounts/")[1].split(/[#/?]/)[0];

// The report gives us deals and an install base without forty form submissions.
await alex.goto(`${BASE}/accounts/${accountId}/import`);
await alex.setInputFiles('input[type="file"]', join(process.cwd(), "tests/fixtures/agent-report.html"));
await alex.click('button:has-text("Upload and extract")');
await alex.waitForSelector("text=/proposed change/", { timeout: 60000 });
await alex.goto(`${BASE}/accounts/${accountId}/review`);
await reviewAsList(alex);
await alex.click('[data-testid="accept-all"]');
await alex.waitForSelector("text=/applied/", { timeout: 30000 });

// The rest through the API-free path the app itself uses, so this measures the
// real rendering rather than a fixture shape.
for (let i = 0; i < DEALS; i += 1) {
  await alex.goto(accountUrl);
  await openTab(alex, "deals");
  const open = alex.locator('[data-testid="deal-new-open"]');
  if (await open.count()) await open.click();
  await alex.fill('[data-testid="deal-new"] [name="name"]', `Filler deal ${i}`);
  await alex.fill('[data-testid="deal-new"] [name="close_date"]', "2027-02-15");
  await alex.fill('[data-testid="deal-new"] [name="tcv_usd"]', "250000");
  await alex.click('[data-testid="deal-new-submit"]');
  await alex.waitForTimeout(120);
}

for (let i = 0; i < FOLLOW_UPS; i += 1) {
  await alex.goto(accountUrl);
  await openTab(alex, "follow-ups");
  await alex.click('[data-testid="follow-up-add"]');
  await alex.fill('[data-testid="follow-up-form"] [name="text"]', `Filler follow-up ${i}`);
  // Past due, so it reaches Home's attention list — the list with no cap.
  await alex.fill('[data-testid="follow-up-form"] [name="due"]', "2020-03-01");
  await alex.click('[data-testid="follow-up-save"]');
  await alex.waitForTimeout(120);
}

for (let i = 0; i < PLAYS; i += 1) {
  await alex.goto(accountUrl);
  await openTab(alex, "plays");
  await alex.click('[data-testid="play-new-open"]');
  await alex.fill('[data-testid="play-new"] [name="title"]', `Filler play ${i}`);
  await alex.fill('[data-testid="play-new"] [name="next_step"]', "Get the architect in a room with ours");
  await alex.click('[data-testid="play-new-submit"]');
  await alex.waitForTimeout(120);
}

for (let i = 0; i < MEETINGS; i += 1) {
  await alex.goto(accountUrl);
  await openTab(alex, "meetings");
  await alex.click('[data-testid="meeting-new-open"]');
  await alex.fill('[data-testid="meeting-new"] [name="title"]', `Filler meeting ${i}`);
  await alex.fill('[data-testid="meeting-new"] [name="held_at"]', `2026-03-${String((i % 28) + 1).padStart(2, "0")}`);
  await alex.click('[data-testid="meeting-new-submit"]');
  await alex.waitForTimeout(120);
}

// The research page, which had no budget here at all — which is why nothing
// caught it rendering one note's findings five times over: a run-on paragraph
// of every kept finding's text, then the coverage counts, then the findings
// themselves uncapped, then the whole original report, then the re-review
// panel with every original finding *and* a second copy of that report, then
// the resolve picker with all of them again as <option> text. A note holds
// fifty findings, so that is the page's real shape, not its worst case.
{
  await alex.goto(`${BASE}/accounts/${accountId}/research`);
  await alex.fill('[data-testid="research-focus"]', "what is published about their next data centre");
  await alex.click('[data-testid="research-run"]');
  await alex.waitForSelector('[data-testid="research-result"]', { timeout: 60000 });
  await alex.goto(`${BASE}/accounts/${accountId}/research`);
  await alex.click('[data-testid="note-accept"]');
  await alex.waitForTimeout(2000);
  const res = await alex.goto(`${BASE}/accounts/${accountId}/research`, { waitUntil: "domcontentloaded" });
  const body = await res.text();
  const kb = Math.round(body.length / 1024);
  c.is(`the research page is under ${RESEARCH_BUDGET_KB} KB (${kb} KB)`, kb <= RESEARCH_BUDGET_KB, true);
  // One copy of the report per note. Three were being shipped, each inside
  // its own <details>, each the full prose whether or not anybody opened it.
  // The default page reads by topic and ships no report at all; a run's own
  // page ships it once.
  const reports = body.match(/data-testid="research-full-report"/g) ?? [];
  c.is(`and the default page ships no report (${reports.length})`, reports.length, 0);
  // The Full report tab ships the newest run's report, once.
  const reportTab = await (await alex.goto(`${BASE}/accounts/${accountId}/research?view=report`, { waitUntil: "domcontentloaded" })).text();
  c.is(`and the Full report tab ships it once (${(reportTab.match(/data-testid="research-full-report"/g) ?? []).length})`, (reportTab.match(/data-testid="research-full-report"/g) ?? []).length, 1);
  const noteId = (reportTab.match(/research\?read=([0-9a-f-]+)/) ?? [])[1];
  const one = await (await alex.goto(`${BASE}/accounts/${accountId}/research?read=${noteId}`, { waitUntil: "domcontentloaded" })).text();
  const copies = one.match(/data-testid="research-full-report"/g) ?? [];
  c.is(`and a run's own page ships one copy of the report, not three (${copies.length})`, copies.length, 1);
}

for (const [route, budget] of Object.entries(BUDGET_KB)) {
  const res = await alex.goto(BASE + route, { waitUntil: "domcontentloaded" });
  const kb = Math.round((await res.text()).length / 1024);
  c.is(`${route} is under ${budget} KB (${kb} KB)`, kb <= budget, true);
}

// The account Overview, which was the heaviest screen in the app when it was
// every record on file in one scroll. It is a summary now, with each full
// list on its own tab, and each tab has a budget of its own.
{
  const res = await alex.goto(accountUrl, { waitUntil: "domcontentloaded" });
  const kb = Math.round((await res.text()).length / 1024);
  c.is(`the account Overview is under ${ACCOUNT_BUDGET_KB} KB (${kb} KB)`, kb <= ACCOUNT_BUDGET_KB, true);
  // One "Add task" and one "Add meeting" for the whole page is right; one
  // form per row is what made it heavy.
  const forms = (await alex.content()).match(/data-testid="[^"]*-open"/g) ?? [];
  c.is(`and carries a handful of add-forms, not one per row (${forms.length})`, forms.length <= 9, true);
  c.is("and summarises the deals rather than listing them", await alex.locator('[data-testid="top-deals"] li').count(), 5);
}
for (const [tab, budget] of Object.entries(TAB_BUDGET_KB)) {
  const res = await alex.goto(`${accountUrl}/${tab}`, { waitUntil: "domcontentloaded" });
  const kb = Math.round((await res.text()).length / 1024);
  c.is(`the ${tab} tab is under ${budget} KB (${kb} KB)`, kb <= budget, true);
}
{
  // The meetings tail: capped, with the rest behind a parameter, and the
  // hidden rows not in the markup. Meetings sort newest first, so the hidden
  // one is the earliest: "Filler meeting 0", on 2026-03-01.
  await alex.goto(`${accountUrl}/meetings`, { waitUntil: "domcontentloaded" });
  const capped = await alex.content();
  c.is("the meetings list says what it is not showing", /more meeting/.test(capped), true);
  c.is("and the hidden meetings are not in the markup", capped.includes("Filler meeting 0"), false);
  const all = await alex.goto(`${accountUrl}/meetings?all=1`, { waitUntil: "domcontentloaded" });
  c.is("?all=1 renders the rest", (await all.text()).includes("Filler meeting 0"), true);
}

// The cap has to be a cap, not a hidden <details> that ships the rows anyway.
await alex.goto(`${BASE}/pipeline`);
const capped = await alex.innerText("body");
c.is("the pipeline says what it is not showing", /Show the other \d+ in/.test(capped), true);
const shown = await alex.locator('[data-testid^="deal-quick-"]').count();
c.is("and the hidden rows are not in the page at all", shown < DEALS, true);
// Counted from the markup rather than from what is painted, because a row
// inside a closed <details> is still in the markup and would pass a visual
// check while costing every byte it costs.
const html = await alex.content();
c.is("not even in the markup", (html.match(/deal-quick-/g) ?? []).length < DEALS, true);

// Show-all really shows all, and keeps the filters it was reached with.
await alex.goto(`${BASE}/pipeline?all=1`);
c.is("?all=1 renders the rest", (await alex.locator('[data-testid^="deal-quick-"]').count()) > shown, true);

// Today picks at most five things by its printed rule, counts the rest, and
// links the complete list. The invariant is unchanged: an honest total, a
// bounded shipped preview, every row reachable.
await alex.goto(BASE);
const glance = alex.getByTestId("today-glance");
const home = await glance.innerText();
c.is("Home names the complete past-due follow-up count", home.includes(`${FOLLOW_UPS} follow-ups past due`), true);
const picks = glance.getByTestId("today-item");
c.is("Today renders at most five picks rather than all rows", (await picks.count()) <= 5, true);
const previewMarkup = await glance.innerHTML();
c.is("personal task preview stays bounded to three rows", await glance.getByTestId("today-open-tasks").locator("li").count(), 3);
c.is("only three personal tasks plus five picks are shipped", new Set(previewMarkup.match(/Filler follow-up \d+/g) ?? []).size <= 8, true);
await alex.getByTestId("glance-all-overdue").click();
await alex.waitForURL(u => u.searchParams.get("view") === "overdue");
const fullList = alex.getByTestId("glance-list");
await fullList.waitFor();
c.is("the full past-due view exposes every follow-up", await fullList.locator("li").filter({ hasText: "Filler follow-up" }).count(), FOLLOW_UPS);
await alex.getByRole("link", { name: "← Back to Today", exact: true }).click();
await alex.waitForURL(u => !u.searchParams.has("view"));
await glance.waitFor();
c.is("returning to Today restores the bounded preview", (await picks.count()) <= 5, true);

await browser.close();
process.exit(c.done() ? 0 : 1);
