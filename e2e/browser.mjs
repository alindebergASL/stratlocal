// One place that knows how to get a browser and how to sign in.
//
// Playwright is a devDependency so these run from a clean clone, but the
// browser binary is not: it is ~150MB, it is not needed to build or ship the
// app, and a machine may already have one. So `npx playwright install
// chromium` is the ordinary path, and PLAYWRIGHT_CHROMIUM_PATH is the way out
// when the browser on the box is not the build this Playwright expects — which
// is the common case in a container that ships its own.
import { chromium } from "playwright";

export const BASE = process.env.BASE ?? "http://localhost:3100";

export async function launch() {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
  return chromium.launch({ executablePath });
}

// A signed-in page of its own, so two of these are two people.
export async function signIn(browser, email, password) {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/`, { timeout: 15000 });
  return page;
}

// Account records live on tabs (components/AccountHeader.tsx). Opens one for
// the account the page is on — from its Overview, another tab, or a record.
export async function openTab(page, tab) {
  const m = /^(.*\/accounts\/[^/?#]+)/.exec(page.url());
  if (!m) throw new Error(`not on an account page: ${page.url()}`);
  const target = tab === "overview" ? m[1] : `${m[1]}/${tab}`;
  if (page.url().split(/[?#]/)[0] !== target) await page.goto(target);
}

// The review page opens one change at a time. Flows that only need the
// changes applied use the whole list, the way someone accepting a forty-row
// import would.
export async function reviewAsList(page) {
  const toggle = page.getByTestId("review-as-list");
  if (await toggle.count()) await toggle.click();
}

// Reports as it goes and remembers whether anything failed, so a flow reads
// like a description of what it checked.
export function checker(name) {
  const failures = [];
  return {
    is(label, actual, expected) {
      const ok = actual === expected;
      if (!ok) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
      return ok;
    },
    done() {
      if (failures.length === 0) {
        console.log(`✓ ${name}\n`);
        return true;
      }
      console.log(`✗ ${name}`);
      for (const f of failures) console.log(`    ${f}`);
      console.log();
      return false;
    },
  };
}

// On a researched account, running research again sits behind one closed
// "Research again" action (DECISIONS #94); on a new account the form is open.
export async function openResearchRun(page) {
  const toggle = page.getByTestId("research-run-open");
  if ((await toggle.count()) && !(await toggle.evaluate((d) => d.open))) await toggle.locator("summary").click();
}
