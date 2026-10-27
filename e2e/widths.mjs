// Does it work on a phone?
//
// The app once had four responsive utilities across 454 className attributes
// and a header that forced horizontal scroll on every page, so this asks the
// one question that can be asked mechanically: does any route scroll sideways
// at any width. It is not a substitute for looking at the screens — a route
// that renders a blank page passes this — but it is the entire class of bug
// that audit found, and it regresses silently.
//
// This used to be scripts/check-widths.mjs, importing a playwright that was
// not a dependency, documented in the README as a command that threw
// ERR_MODULE_NOT_FOUND on any machine that had not been set up by hand.
import { BASE, checker, launch, signIn, openTab, reviewAsList } from "./browser.mjs";
import { join } from "node:path";

const WIDTHS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1440, height: 900 },
];

const browser = await launch();
const c = checker("no route scrolls sideways");

// Signed-in routes. /login cannot be one of them: app/login/page.tsx redirects
// to / for anyone who already has a session, so measuring it on the signed-in
// page measured the home page three more times and left the first page anyone
// sees as the one page never checked. It gets its own context below.
const routes = new Set();

const alex = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);

const status = alex.locator('[data-testid="system-status"]');
c.is("Home system status starts closed", await status.evaluate(el => el.open), false);
await status.locator("summary").focus();
await alex.keyboard.press("Enter");
c.is("Home system status opens with the keyboard", await status.evaluate(el => el.open), true);
c.is("setup remains available inside it", await status.locator('[data-testid="setup-link"]').isVisible(), true);
await status.locator("summary").click();

// A populated account, so the deal, meeting and research routes exist to be
// measured. An empty database silently skipped whole route families before,
// and "checked N routes" was the only sign — a number nobody diffed.
const trigger = alex.locator('[data-testid="account-new-open"]');
if (await trigger.count()) await trigger.click();
await alex.fill('[data-testid="account-new"] [name="name"]', "Synthetic Orchard Lab");
await alex.click('[data-testid="account-new-submit"]');
await alex.waitForURL(/\/accounts\//, { timeout: 15000 });
const accountId = alex.url().split("/accounts/")[1].split(/[#/?]/)[0];

await alex.goto(`${BASE}/accounts/${accountId}/import`);
await alex.setInputFiles('input[type="file"]', join(process.cwd(), "tests/fixtures/agent-report.html"));
await alex.click('button:has-text("Upload and extract")');
await alex.waitForSelector("text=/proposed change/", { timeout: 60000 });
await alex.goto(`${BASE}/accounts/${accountId}/review`);
await reviewAsList(alex);
await alex.click('[data-testid="accept-all"]');
await alex.waitForSelector("text=/applied/", { timeout: 30000 });

await alex.goto(`${BASE}/accounts/${accountId}`);
await openTab(alex, "meetings");
await alex.click('[data-testid="meeting-new-open"]');
await alex.fill('[data-testid="meeting-new"] [name="title"]', "Quarterly review");
await alex.fill('[data-testid="meeting-new"] [name="held_at"]', "2026-09-15");
await alex.click('[data-testid="meeting-new-submit"]');
await alex.waitForURL(/\/meetings\//, { timeout: 15000 });

// A playbook in place, so its page is measured full rather than empty.
await alex.goto(`${BASE}/settings/playbook`);
await alex.click('[data-testid="playbook-use-starter"]');
await alex.getByTestId("playbook-view").waitFor({ timeout: 15000 });

for (const r of ["/", "/inbox", "/accounts", "/follow-ups/sort", "/assistants", "/promises", "/calendar", "/plans", "/handoff", "/settings/direction", "/settings/playbook", "/settings/salesforce", "/settings/team", "/pipeline/owners", "/pipeline", "/pipeline?moved=7", "/search?q=a", "/activity", "/setup"]) routes.add(r);
for (const s of ["", "/deals", "/plays", "/people", "/meetings", "/details", "/research", "/review", "/import", "/import-sheet", "/install-base", "/handoff", "/summary", "/plan", "/playbook", "/playbook/workshop", "/playbook/roadmap"]) routes.add(`/accounts/${accountId}${s}`);

// Each found on the tab that lists it.
for (const [what, sel, tab] of [
  ["a meeting", 'a[href*="/meetings/"]', "meetings"],
  ["a deal", 'a[href*="/deals/"]', "deals"],
  ["a person", 'a[href*="/contacts/"]', "people"],
  ["a play", 'a[href*="/plays/"]', "plays"],
]) {
  await alex.goto(`${BASE}/accounts/${accountId}/${tab}`);
  const href = await alex.getAttribute(sel, "href").catch(() => null);
  // Loudly, rather than quietly skipping the route family, which is how a
  // whole page goes unmeasured for a round without anyone noticing.
  c.is(`${what} exists to measure`, href !== null, true);
  if (href) routes.add(href);
}

const overflow = [];

async function measure(page, route, { name, width, height }) {
  await page.setViewportSize({ width, height });
  await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(150);
  const m = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  // One pixel of slack: sub-pixel layout rounding is not a bug.
  if (m.scroll > m.inner + 1) overflow.push(`${name} (${width}px) ${route}: content is ${m.scroll}px wide`);
}

// Signed in, so every route renders its real content rather than redirecting.
const signedIn = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);
// Signed out, so /login is the login form rather than a redirect to Home.
const anonymous = await (await browser.newContext()).newPage();

for (const size of WIDTHS) {
  for (const route of routes) await measure(signedIn, route, size);
  await measure(anonymous, "/login", size);
}

c.is(`${routes.size + 1} routes at ${WIDTHS.length} widths`, overflow.join("; "), "");
await browser.close();
process.exit(c.done() ? 0 : 1);
