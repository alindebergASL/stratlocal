// The collision that cannot be undone afterwards.
//
// raw_notes is a LARGE_FIELD: change_log records "4.1 KB → 1.2 KB" and not the
// text, and the column is the only copy there has ever been. So a stale save
// here is not an inconvenience that history can reconstruct — it is ten
// minutes of somebody's typing, gone, with "Saved" on screen in green.
//
// Which is why this is the one field in the app that gets a way out other than
// picking a winner: Keep both puts the two halves in one document under a line
// saying whose is whose.
import { BASE, checker, launch, signIn, openTab } from "./browser.mjs";
import Database from "better-sqlite3";

const browser = await launch();
const c = checker("a meeting's notes");

const alex = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);
const jamie = await signIn(browser, process.env.E2E_USER2_EMAIL, process.env.E2E_USER2_PASSWORD);

// An account with a meeting on it.
const newAccountTrigger = alex.locator('[data-testid="account-new-open"]');
if (await newAccountTrigger.count()) await newAccountTrigger.click();
await alex.fill('[data-testid="account-new"] [name="name"]', "Synthetic Orchard Lab");
await alex.click('[data-testid="account-new-submit"]');
await alex.waitForURL(/\/accounts\//, { timeout: 15000 });

await openTab(alex, "meetings");
await alex.click('[data-testid="meeting-new-open"]');
await alex.fill('[data-testid="meeting-new"] [name="title"]', "Quarterly review");
await alex.fill('[data-testid="meeting-new"] [name="held_at"]', "2026-09-15");
await alex.click('[data-testid="meeting-new-submit"]');
await alex.waitForURL(/\/meetings\//, { timeout: 15000 });
const meetingUrl = alex.url();

const NOTES = 'textarea[name="raw_notes"]';
const THEIRS = "They are midway through the migration and want the storage decision settled first.";
const MINE = "Ran long on introductions. Budget sits with finance until March.";

// Both open it. Jamie types for a while and saves.
await jamie.goto(meetingUrl);
await alex.goto(meetingUrl);
await jamie.fill(NOTES, THEIRS);
await jamie.click('button:has-text("Save only")');
await jamie.waitForTimeout(1500);

// Alex, from the page he opened before that, types his own and saves.
await alex.fill(NOTES, MINE);
await alex.click('button:has-text("Save only")');
await alex.waitForTimeout(1500);

const notice = alex.locator('[role="alert"]:has-text("Not saved")');
c.is("the second save is refused", await notice.count(), 1);
c.is("it names who wrote what is there", (await notice.count()) ? (await notice.innerText()).includes("Jamie") : false, true);
c.is("what I typed is still in the box", await alex.inputValue(NOTES), MINE);

await jamie.reload();
c.is("their notes are untouched", await jamie.inputValue(NOTES), THEIRS);

// Keep both.
await alex.click('button:has-text("Keep both")');
await alex.waitForTimeout(2500);
const merged = await alex.inputValue(NOTES);
c.is("keeps theirs", merged.includes("midway through the migration"), true);
c.is("keeps mine", merged.includes("Budget sits with finance"), true);
c.is("says which is which", merged.includes("Alex added"), true);

// An explicit Keep theirs is local adoption, not another write or reload.
async function collide(theirs, mine) {
  await jamie.reload();
  await alex.reload();
  await jamie.fill(NOTES, theirs);
  await jamie.getByRole("button", { name: "Save only", exact: true }).click();
  await jamie.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Save only" && b.disabled));
  await alex.fill(NOTES, mine);
  await alex.getByRole("button", { name: "Save only", exact: true }).click();
  await notice.waitFor();
}
const longNotes = `${THEIRS}\n\n${"Long-reference-".repeat(40)}\nFinal partner detail.`;
await collide(longNotes, MINE);
// FormData serializes textarea newlines as CRLF; compare the preview to the
// actual saved document, then separately verify its visible line content.
const db = new Database(process.env.E2E_DB_PATH, { readonly: true });
const storedNotes = db.prepare("SELECT raw_notes FROM meetings WHERE id = ?").get(new URL(meetingUrl).pathname.split("/").at(-1)).raw_notes;
db.close();
c.is("stored notes preserve all submitted lines", storedNotes.replace(/\r\n/g, "\n"), longNotes);
c.is("the preview includes the exact saved partner document", await alex.getByTestId("notes-conflict-preview").textContent(), storedNotes);
for (const width of [1440, 390]) {
  await alex.setViewportSize({ width, height: 1000 });
  c.is(`the conflict fits ${width}px`, await alex.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
}
let posts = 0;
let navigations = 0;
const countPost = (request) => { if (request.method() === "POST") posts++; };
const countNavigation = (frame) => { if (frame === alex.mainFrame()) navigations++; };
alex.on("request", countPost);
alex.on("framenavigated", countNavigation);
await alex.getByRole("button", { name: "Keep theirs", exact: true }).click();
await notice.waitFor({ state: "hidden" });
await alex.waitForTimeout(200);
c.is("Keep theirs posts nothing", posts, 0);
c.is("Keep theirs does not reload the page", navigations, 0);
alex.off("request", countPost);
alex.off("framenavigated", countNavigation);
c.is("the exact partner text replaces the draft", await alex.inputValue(NOTES), longNotes);
c.is("adopted notes are clean", await alex.getByRole("button", { name: "Save only", exact: true }).isDisabled(), true);
await jamie.reload();
c.is("Keep theirs leaves the server document alone", await jamie.inputValue(NOTES), longNotes);
// A newer partner save must not be overwritten using the adopted old version.
await jamie.fill(NOTES, "Later partner update: confirm the budget owner.");
await jamie.getByRole("button", { name: "Save only", exact: true }).click();
await jamie.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Save only" && b.disabled));
await alex.fill(NOTES, "My next draft after accepting their earlier notes.");
await alex.getByRole("button", { name: "Save only", exact: true }).click();
await notice.waitFor();
c.is("the later partner change still conflicts", await alex.getByTestId("notes-conflict-preview").textContent(), "Later partner update: confirm the budget owner.");
// Keep mine remains an explicit overwrite of the version just shown.
await alex.getByRole("button", { name: "Keep mine", exact: true }).click();
await notice.waitFor({ state: "hidden" });
await jamie.reload();
c.is("Keep mine saves the chosen draft", await jamie.inputValue(NOTES), "My next draft after accepting their earlier notes.");
await collide("", MINE);
c.is("cleared partner notes are explained", (await alex.getByTestId("notes-conflict-preview").textContent()).includes("they cleared the text"), true);
await alex.getByRole("button", { name: "Keep theirs", exact: true }).click();
await notice.waitFor({ state: "hidden" });
c.is("empty saved notes are adopted without a placeholder", await alex.inputValue(NOTES), "");

await browser.close();
process.exit(c.done() ? 0 : 1);
