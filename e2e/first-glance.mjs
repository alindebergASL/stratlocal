import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import { BASE, checker, launch, signIn } from "./browser.mjs";
if (!process.env.E2E_DB_PATH?.includes("strategy-e2e-")) throw Error("Disposable e2e DB required");
const browser = await launch(), c = checker("first glance, scoped complete lists and Back");
const db = new Database(process.env.E2E_DB_PATH);
try {
  const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);
  const f = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "e2e/glance-seed.mts"], { encoding: "utf8", env: { ...process.env, DB_PATH: process.env.E2E_DB_PATH } }));
  const snapshot = () => JSON.stringify(["accounts", "meetings", "plays", "action_items", "proposals", "ai_runs", "change_log"].map(t => db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()));
  const before = snapshot();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${BASE}/?who=mine`);
    const meeting = page.getByTestId("home-meeting-row");
    c.is(`one upcoming preview at ${width}`, await meeting.count(), 1);
    for (const [label, el] of [["inline meeting preparation", meeting.getByRole("button", { name: "Prepare this meeting", exact: true })], ["task capture", page.getByTestId("task-capture-open")]]) {
      const box = await el.boundingBox();
      c.is(`${label} in initial viewport at ${width}`, box.y >= 0 && box.y + box.height <= 844, true);
    }
    c.is(`no overflow at ${width}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    c.is(`correct review count units at ${width}`, (await page.getByTestId("today-glance").innerText()).includes("8 changes across 4 accounts to review"), true);
    c.is(`follow-ups distinct from plays at ${width}`, (await page.getByTestId("today-glance").innerText()).includes("3 follow-ups past due · 1 play past due"), true);
  }
  for (const [view, count] of [["upcoming", 12], ["notes", 8], ["review", 4], ["overdue", 4], ["next-steps", 2]]) {
    await page.getByTestId(`glance-all-${view}`).click();
    await page.waitForURL(u => u.searchParams.get("view") === view);
    await page.getByTestId("glance-list").waitFor();
    c.is(`${view} preserves owner`, new URL(page.url()).searchParams.get("who"), "mine");
    c.is(`${view} complete list`, await page.getByTestId("glance-list").locator("li").count(), count);
    c.is(`${view} replaces overview`, await page.getByTestId("today-glance").count(), 0);
    await page.getByRole("link", { name: "← Back to Today", exact: true }).click();
    await page.waitForURL(u => !u.searchParams.has("view"));
    await page.getByTestId("today-glance").waitFor();
    c.is(`${view} Back preserves owner`, new URL(page.url()).search, "?who=mine");
  }
  await page.getByTestId("glance-all-review").click();
  await page.waitForURL(u => u.searchParams.get("view") === "review");
  await page.getByTestId("glance-list").waitFor();
  await page.goBack();
  await page.getByTestId("today-glance").waitFor();
  c.is("browser Back restores bounded overview", await page.getByTestId("home-meeting-row").count(), 1);
  await page.goto(`${BASE}/?who=shared&view=review`);
  c.is("shared view excludes owned reviews", await page.getByTestId("glance-list").locator("li").count(), 1);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${BASE}/accounts/${f.accountId}`);
    // The Overview says the next meeting once, as a "Needs you" row with one
    // way in, near the top of the first screen.
    const next = page.locator('[data-testid="needs-you-row"][data-kind="meeting"]');
    await next.waitFor();
    c.is(`account offers specific brief action at ${width}`, (await next.innerText()).includes("Prepare"), true);
    const action = next.getByRole("link");
    const box = await action.boundingBox();
    c.is(`account next action in first viewport at ${width}`, box.y + box.height <= 844, true);
    c.is(`account uses scheduled not past meeting at ${width}`, await action.getAttribute("href"), `/accounts/${f.accountId}/meetings/${f.upcoming[0]}#brief`);
    c.is(`overdue follow-ups are one row, not three at ${width}`, await page.locator('[data-testid="needs-you-row"][data-kind="follow-ups"]').count(), 1);
    c.is(`account shows the open follow-ups at ${width}`, await page.locator("#follow-ups li").count(), 3);
  }
  c.is("read-only navigation changes no records or proposals", snapshot(), before);
} finally { db.close(); await browser.close(); }
process.exit(c.done() ? 0 : 1);
