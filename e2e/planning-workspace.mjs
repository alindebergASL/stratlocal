// Synthetic-only desktop + phone acceptance. AI_FAKE=1 is a canned replay,
// proving application plumbing, never live model quality or provider access.
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { BASE, checker, launch, signIn } from "./browser.mjs";
if (!process.env.E2E_DB_PATH?.includes("strategy-e2e-")) throw Error("Disposable synthetic DB required");
const browser = await launch();
const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);
const db = new Database(process.env.E2E_DB_PATH);
const c = checker("planning workspace · desktop and phone · AI_FAKE replay");
const runs = () => db.prepare("SELECT COUNT(*) n FROM ai_runs").get().n;
const items = () => db.prepare("SELECT COUNT(*) n FROM action_items").get().n;
const shotDir = process.env.E2E_SCREENSHOT_DIR;
if (shotDir) mkdirSync(shotDir, { recursive: true });
async function fits(label) { c.is(label, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); }
try {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 950 });
    await page.goto(BASE);
    const title = `Synthetic loose workshop thought ${width}`;
    const beforeRuns = runs();
    await page.getByTestId("task-capture-open").click();
    await page.locator('[data-testid="task-capture"] [name="text"]').fill(title);
    await fits(`title-only capture fits at ${width}`);
    await page.getByTestId("task-capture-submit").click();
    await page.getByTestId("task-capture").waitFor({ state: "hidden" });
    const task = db.prepare("SELECT * FROM action_items WHERE text=?").get(title);
    c.is(`title-only capture persists at ${width}`, !!task, true);
    c.is("no account hierarchy required", task.account_id, "own-work");
    c.is("no date inferred", task.due, null);
    c.is("no AI launched by capture", runs(), beforeRuns);
    await page.reload();
    c.is("undated work is visible on Today after reload", await page.getByTestId("today-open-tasks").getByRole("link", { name: `${title} →`, exact: true }).count(), 1);
    // Tasks lives in the More menu (DECISIONS #95).
    await page.getByTestId(width >= 1024 ? "nav-more-column" : "nav-more").click();
    await page.locator('[data-testid="nav-follow-ups"]:visible').first().click();
    await page.getByRole("link", { name: /^Unscheduled \(/ }).click();
    await page.reload();
    const row = page.locator(`#action-${task.id}`);
    c.is("task remains discoverable without a date", await row.count(), 1);
    await row.getByRole("link", { name: "Task details →", exact: true }).click();
    await page.waitForURL(new RegExp(`/follow-ups/${task.id}`));
    const edit = page.getByTestId("task-edit");
    await edit.locator('[name="notes"]').fill("Ask what the workshop should resolve. Synthetic planning note.");
    await edit.locator('[name="owner_user_id"]').selectOption("");
    await page.getByTestId("task-edit-submit").click();
    await page.getByTestId("task-edit").waitFor({ state: "hidden" });
    await page.reload();
    c.is("notes survive reload", (await page.getByTestId("task-notes").textContent()).includes("workshop should resolve"), true);
    c.is("assignee is optional", db.prepare("SELECT owner_user_id FROM action_items WHERE id=?").get(task.id).owner_user_id, null);
    await fits(`task details fit at ${width}`);

    // An account is added only when context becomes useful.
    await page.goto(BASE);
    if (await page.getByTestId("account-new-open").count()) await page.getByTestId("account-new-open").click();
    await page.locator('[data-testid="account-new"] [name="name"]').fill(`Synthetic Planning Lab ${width}`);
    await page.getByTestId("account-new-submit").click();
    await page.waitForURL(/\/accounts\//);
    const accountUrl = page.url();
    const accountId = new URL(accountUrl).pathname.split("/")[2];
    c.is("account has its own capture entry", await page.getByTestId("planning-capture").count(), 1);
    await page.goto(`${BASE}/follow-ups/${task.id}`);
    await page.locator('[name="context"]').selectOption(accountId);
    await page.getByRole("button", { name: "Choose context", exact: true }).click();
    await page.waitForURL(new RegExp(`context=${accountId}`));
    await page.getByTestId("task-connect-submit").click();
    await page.getByTestId("task-connect").waitFor({ state: "hidden" });
    let linked = db.prepare("SELECT * FROM action_items WHERE id=?").get(task.id);
    c.is("connecting keeps the ID and moves account context", linked.account_id, accountId);
    c.is("connecting retains notes", linked.notes.includes("workshop should resolve"), true);
    c.is("connecting retains created_at", linked.created_at, task.created_at);
    c.is("connecting still makes no AI call", runs(), beforeRuns);

    // Retained synthetic research plus the existing task feed preparation.
    await page.goto(`${accountUrl}/research`);
    await page.getByTestId("research-focus").fill("Published synthetic reliability plans");
    await page.getByTestId("research-run").click();
    await page.getByTestId("research-result").waitFor({ timeout: 60000 });
    await page.goto(`${accountUrl}/research`);
    const accept = page.waitForResponse(r => r.request().method() === "POST" && r.url().includes("/api/research-notes/"));
    await page.getByTestId("note-accept").click();
    c.is("synthetic research is retained", (await accept).status(), 200);

    await page.goto(`${BASE}/?who=all`);
    await page.getByTestId("planning-meeting-open").click();
    const mf = page.getByTestId("planning-meeting");
    await mf.locator('[name="account_id"]').selectOption(accountId);
    const meetingTitle = `Synthetic workshop preparation ${width}`;
    await mf.locator('[name="title"]').fill(meetingTitle);
    await mf.locator('[name="held_at"]').fill(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
    await page.getByTestId("planning-meeting-submit").click();
    await page.waitForURL(/\/meetings\//);
    const meetingUrl = page.url();
    const meetingId = new URL(meetingUrl).pathname.split("/").at(-1);
    c.is("meeting page offers task capture", await page.getByTestId("task-capture-open").count(), 1);
    await page.goto(`${BASE}/follow-ups/${task.id}`);
    await page.locator('[data-testid="task-connect"] [name="meeting_id"]').selectOption(meetingId);
    await page.getByTestId("task-connect-submit").click();
    await page.getByTestId("task-connect").waitFor({ state: "hidden" });
    linked = db.prepare("SELECT * FROM action_items WHERE id=?").get(task.id);
    c.is("meeting connected later without recreation", linked.meeting_id, meetingId);
    c.is("task identity unchanged", linked.id, task.id);
    await page.goto(`${BASE}/?who=all`);
    const preview = page.locator('[data-testid="glance-primary"], [data-testid="home-meeting-row"]').filter({ hasText: meetingTitle });
    const beforePrepare = runs(), beforeItems = items();
    if (!(await preview.count())) { await page.getByTestId("glance-all-upcoming").click(); }
    // Two tabs retain their rendered no-brief version while this tab prepares
    // and then saves human wording. Neither may overwrite that newer work.
    const staleMeeting = await page.context().newPage();
    await staleMeeting.goto(meetingUrl);
    await staleMeeting.getByRole("button", { name: "Prepare this meeting", exact: true }).waitFor();
    const staleOverview = await page.context().newPage();
    await staleOverview.goto(`${BASE}/?who=all&view=upcoming`);
    const staleRow = staleOverview.locator('[data-testid="home-meeting-row"]').filter({ hasText: meetingTitle });
    await staleRow.getByRole("button", { name: "Prepare this meeting", exact: true }).waitFor();
    await preview.getByRole("button", { name: "Prepare this meeting", exact: true }).waitFor();
    const posted = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith(`/api/meetings/${meetingId}/brief`));
    await preview.getByRole("button", { name: "Prepare this meeting", exact: true }).click();
    c.is("inline preparation starts successfully", (await posted).status(), 200);
    // Leave/reload rather than starting again: the persisted run owns execution.
    await page.reload();
    await preview.getByTestId("prepared-brief-link").waitFor({ timeout: 60000 });
    c.is("reload never launches a duplicate", runs(), beforePrepare + 1);
    c.is("preparation creates no tasks", items(), beforeItems);
    await preview.getByTestId("prepared-brief-link").click();
    await page.getByTestId("brief-conversation").waitFor();
    c.is("source citations retained", await page.getByTestId("brief-ref").count() > 0, true);
    c.is("brief task context was not a commitment", items(), beforeItems);
    const original = db.prepare("SELECT brief_json FROM meetings WHERE id=?").get(meetingId).brief_json;
    await page.getByTestId("preparation-edit-open").click();
    const bf = page.getByTestId("preparation-edit");
    await bf.locator('[name="purpose"]').fill(`Human purpose ${width}: agree what the workshop should resolve.`);
    await bf.locator('[name="questions"]').fill("Who needs to decide?\nWhat is still unknown?");
    await bf.locator('[name="action"]').fill("Ask the team for a technical workshop date.");
    await bf.locator('[name="concern"]').fill("The scope needs human confirmation.");
    await fits(`preparation editor fits at ${width}`);
    await page.getByTestId("preparation-edit-submit").click();
    await page.getByTestId("preparation-edit").waitFor({ state: "hidden" });
    await page.reload();
    c.is("human edits labelled after reload", await page.getByTestId("brief-human-edit").count(), 1);
    c.is("edited purpose is the working brief", (await page.getByTestId("brief-purpose").first().textContent()).includes(`Human purpose ${width}`), true);
    const saved = db.prepare("SELECT * FROM meetings WHERE id=?").get(meetingId);
    c.is("original evidence-backed document preserved", JSON.stringify(JSON.parse(saved.brief_edits_json).original), JSON.stringify(JSON.parse(original)));
    c.is("saving a brief still creates no tasks", items(), beforeItems);
    const beforeStaleRuns = runs();
    for (const [name, stalePage, button] of [
      ["meeting tab", staleMeeting, staleMeeting.getByRole("button", { name: "Prepare this meeting", exact: true })],
      ["overview tab", staleOverview, staleRow.getByRole("button", { name: "Prepare this meeting", exact: true })],
    ]) {
      const rejected = stalePage.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith(`/api/meetings/${meetingId}/brief`));
      await button.click();
      c.is(`stale ${name} is rejected before execution`, (await rejected).status(), 409);
      await stalePage.getByText(/changed since you opened it/).waitFor();
      c.is(`stale ${name} creates no run`, runs(), beforeStaleRuns);
      c.is(`stale ${name} preserves human wording and original draft`, JSON.stringify(db.prepare("SELECT * FROM meetings WHERE id=?").get(meetingId)), JSON.stringify(saved));
      await stalePage.close();
    }
    await page.getByTestId("brief-original").locator("summary").first().click();
    c.is("original draft stays reachable", (await page.getByTestId("brief-original").innerText()).length > 100, true);
    await page.getByTestId("brief-original").locator("summary").first().click();
    await fits(`meeting preparation fits at ${width}`);
    if (shotDir) await page.screenshot({ path: join(shotDir, `planning-brief-${width}.png`), fullPage: true });

    // Notes -> proposals remains reachable, with no auto-accept.
    await page.locator('textarea[name="raw_notes"]').fill("Synthetic workshop notes. The team discussed evaluation scope. Alex will ask who needs to join a technical review. No calendar date was agreed.");
    await page.getByRole("button", { name: "Save and extract changes", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#review')?.textContent.includes("Accept"), null, { timeout: 60000 });
    c.is("extracted suggestions remain pending", db.prepare("SELECT COUNT(*) n FROM proposals WHERE account_id=? AND status='pending'").get(accountId).n > 0, true);
    c.is("review does not auto-accept tasks", items(), beforeItems);
    await fits(`notes and proposal review fit at ${width}`);

    // The old deep link survives assignment filters and task pagination.
    await page.goto(`${BASE}/follow-ups#action-${task.id}`);
    await page.waitForURL(new RegExp(`/follow-ups/${task.id}`));
    c.is("legacy deep link reaches an unassigned task", await page.getByTestId("task-edit").count(), 1);
    await page.goto(`${BASE}/?who=all`);
    if (shotDir) await page.screenshot({ path: join(shotDir, `planning-today-${width}.png`), fullPage: true });
  }
} finally { db.close(); await browser.close(); }
process.exit(c.done() ? 0 : 1);
