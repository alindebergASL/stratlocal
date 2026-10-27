// Two rows for one play, and two records of one call.
//
// A library test cannot see a missing button — that is the lesson this repo
// paid for when the contact merge was implemented, tested, green, and
// unreachable from anywhere in the app for a whole phase. So the two merges
// that complete the set get the same treatment as that one: driven through
// the browser, from the control on the record's own page.
//
// What each one has to prove is not that the call returned. It is what did not
// get orphaned: the links only one of the two rows carried, and — for a
// meeting — the half of the notes the other one of us typed. (The follow-up
// relink is in tests/mergePlay.test.ts rather than here: the follow-up editor
// renders no play picker, so there is no way to write one against a play
// through the UI at all.)
import { BASE, checker, launch, signIn, openTab } from "./browser.mjs";

const browser = await launch();
const c = checker("two rows for one record");
const alex = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);

const trigger = alex.locator('[data-testid="account-new-open"]');
if (await trigger.count()) await trigger.click();
await alex.fill('[data-testid="account-new"] [name="name"]', "Northwind Grain");
await alex.click('[data-testid="account-new-submit"]');
await alex.waitForURL(/\/accounts\//, { timeout: 15000 });
const accountUrl = alex.url();

// --- two rows for one play ---------------------------------------------------

async function addPlay(title) {
  await alex.goto(`${accountUrl}/plays`);
  await alex.click('[data-testid="play-new-open"]');
  await alex.fill('[data-testid="play-new"] [name="title"]', title);
  await alex.click('[data-testid="play-new-submit"]');
  await alex.waitForTimeout(1200);
}

// Same play, written down twice, the second time with different capitals —
// which is exactly what `sameName` normalises and what pre-fills the picker.
await addPlay("Hold the grain terminal");
await addPlay("Hold The Grain Terminal");

await alex.goto(`${accountUrl}/plays`);
const playHrefs = [
  ...new Set(await alex.locator('a[href*="/plays/"]').evaluateAll((els) => els.map((e) => e.getAttribute("href")))),
];
c.is("two plays on the account", playHrefs.length, 2);

// The keeper is the first one; the other carries what only it knows — a
// thesis, and the deal this play is actually about. Both have to survive.
const keeperPlay = playHrefs[0];
const loserPlay = playHrefs[1];

await alex.goto(accountUrl);
await openTab(alex, "deals");
await alex.click('[data-testid="deal-new-open"]');
await alex.fill('[data-testid="deal-new"] [name="name"]', "Terminal silo expansion");
await alex.fill('[data-testid="deal-new"] [name="tcv_usd"]', "2.4M");
await alex.click('[data-testid="deal-new-submit"]');
await alex.waitForTimeout(1500);

await alex.goto(`${BASE}${loserPlay}`);
await alex.click('[data-testid="play-edit-open"]');
await alex.fill('[data-testid="play-edit"] [name="thesis"]', "The terminal contract is the whole account");
await alex.check('[data-testid="play-edit"] input[name="deal_ids"]');
await alex.click('[data-testid="play-edit-submit"]');
await alex.waitForTimeout(1500);

await alex.goto(`${BASE}${keeperPlay}`);
c.is("the play's page offers the merge", await alex.locator('[data-testid="play-merge-open"]').count(), 1);
c.is("and says another play has the same name", /same name/i.test(await alex.innerText("body")), true);
// A merge cannot be undone, so the page says what this pair would do before
// the press — from the same planner the merge applies.
const playPreview = await alex.locator('[data-testid="merge-preview"]').first().innerText();
c.is("the preview names the row that would be archived", playPreview.includes("Hold The Grain Terminal"), true);
c.is("and the thesis it would fill", /fills thesis/.test(playPreview), true);
c.is("and the deal it would bring", /1 deal/.test(playPreview), true);

await alex.click('[data-testid="play-merge-open"]');
await alex.click('[data-testid="play-merge-submit"]');
await alex.waitForTimeout(2000);

await alex.goto(`${BASE}${keeperPlay}`);
const afterPlay = await alex.innerText("body");
c.is("the survivor takes the thesis the other row had", afterPlay.includes("The terminal contract is the whole account"), true);
c.is("and the deal only the other row was linked to", afterPlay.includes("Terminal silo expansion"), true);
c.is("the merge is in its history", /merged.from/i.test(afterPlay), true);

await alex.goto(`${accountUrl}/plays`);
const remainingPlays = [
  ...new Set(await alex.locator('a[href*="/plays/"]').evaluateAll((els) => els.map((e) => e.getAttribute("href")))),
];
c.is("one play on the account again", remainingPlays.length, 1);

// A tombstone, not an archived record waiting to come back: it says where it
// went, and the button that would return half a play is not there.
await alex.goto(`${BASE}${loserPlay}`);
const tombstone = await alex.innerText("body");
c.is("the merged-away play says where it went", /merged into/i.test(tombstone), true);
c.is("and does not read as an archived play waiting to come back", /is archived on/.test(tombstone), false);

// --- two records of one call -------------------------------------------------

async function addMeeting(title) {
  await alex.goto(`${accountUrl}/meetings`);
  await alex.click('[data-testid="meeting-new-open"]');
  await alex.fill('[data-testid="meeting-new"] [name="title"]', title);
  await alex.fill('[data-testid="meeting-new"] [name="held_at"]', "2026-09-16");
  await alex.click('[data-testid="meeting-new-submit"]');
  await alex.waitForTimeout(1500);
}

await addMeeting("Terminal review");
await addMeeting("Terminal review (my notes)");

await alex.goto(`${accountUrl}/meetings`);
const meetingHrefs = [
  ...new Set(await alex.locator('a[href*="/meetings/"]').evaluateAll((els) => els.map((e) => e.getAttribute("href")))),
];
c.is("two records of the same day", meetingHrefs.length, 2);

// Each of us typed up our own half.
async function writeNotes(href, text) {
  await alex.goto(`${BASE}${href}`);
  await alex.fill('textarea[name="raw_notes"]', text);
  await alex.click('button:has-text("Save only")');
  await alex.waitForTimeout(1800);
}
// Which is which comes from the list's own order (newest first), not from the
// order they were made in — so the loser's title is read rather than assumed.
const keeperMeeting = meetingHrefs[0];
const loserMeeting = meetingHrefs[1];
await alex.goto(`${BASE}${loserMeeting}`);
const loserTitle = await alex.locator("h1").first().innerText();
await writeNotes(keeperMeeting, "Mine: they want the second silo online before harvest.");
await writeNotes(loserMeeting, "Theirs: budget sign-off sits with the board in November.");

await alex.goto(`${BASE}${keeperMeeting}`);
c.is("the meeting page offers the merge", await alex.locator('[data-testid="meeting-merge-open"]').count(), 1);
// These two share nothing but the date, which is the ordinary false offer the
// label exists for: it must not read like one sharing four attendees.
const meetingBody = await alex.innerText("body");
c.is("the candidate says how little is actually known about it", /nothing in common but the day/.test(meetingBody), true);
const meetingPreview = await alex.locator('[data-testid="merge-preview"]').first().innerText();
c.is("and the preview says both sets of notes would be kept", /keeps both sets of notes/i.test(meetingPreview), true);

await alex.click('[data-testid="meeting-merge-open"]');
await alex.click('[data-testid="meeting-merge-submit"]');
await alex.waitForTimeout(2000);

await alex.goto(`${BASE}${keeperMeeting}`);
// Read out of the textarea, not off the page: notes live in a form control, so
// innerText does not contain them and asserting against it would pass for the
// wrong reason — the loser's title is rendered elsewhere on this page anyway.
const afterMeeting = await alex.inputValue('textarea[name="raw_notes"]');
// Keep both. raw_notes is a large field, so history holds its size and not its
// text — this column is the only copy there has ever been, and neither half of
// it is something anyone should have to give up to merge two records.
c.is("the survivor still has our notes", afterMeeting.includes("second silo online before harvest"), true);
c.is("and now has theirs too", afterMeeting.includes("budget sign-off sits with the board"), true);
c.is("under a line saying which record they came from", afterMeeting.includes(`From \u201c${loserTitle}\u201d`), true);

await alex.goto(`${accountUrl}/meetings`);
const remainingMeetings = [
  ...new Set(await alex.locator('a[href*="/meetings/"]').evaluateAll((els) => els.map((e) => e.getAttribute("href")))),
];
c.is("one record of the call again", remainingMeetings.length, 1);

await alex.goto(`${BASE}${loserMeeting}`);
const meetingTombstone = await alex.innerText("body");
c.is("the merged-away record says where it went", /merged into/i.test(meetingTombstone), true);
c.is("and does not read as an archived record waiting to come back", /is archived on/.test(meetingTombstone), false);
// Nothing is deleted: its own half is still readable on its own page.
c.is("its own notes are still there", (await alex.inputValue('textarea[name="raw_notes"]')).includes("budget sign-off sits with the board"), true);

// ---- and undone ------------------------------------------------------------
// The account page lists the merges that can be undone, each saying what the
// undo would do. Undo the meeting merge: the other record comes back as its
// own, with its own notes, and the survivor's notes are what they were before.
await alex.goto(`${accountUrl}/details`);
c.is("the account lists both merges as undoable", await alex.locator('[data-testid="merge-list"] > li').count(), 2);
const meetingMerge = alex.locator('[data-testid="merge-list"] > li', { hasText: loserTitle }).first();
await meetingMerge.locator('[data-testid="unmerge-open"]').click();
c.is("the undo says what it will bring back", /comes back as its own record/.test(await meetingMerge.innerText()), true);
await meetingMerge.locator('[data-testid="unmerge-submit"]').click();
await alex.waitForTimeout(2000);

await alex.goto(`${BASE}${loserMeeting}`);
const undone = await alex.innerText("body");
c.is("the other record is its own again", /merged into/i.test(undone), false);
c.is("with its own notes", (await alex.inputValue('textarea[name="raw_notes"]')).includes("budget sign-off sits with the board"), true);
await alex.goto(`${BASE}${keeperMeeting}`);
const keeperNotes = await alex.inputValue('textarea[name="raw_notes"]');
c.is("and the survivor's notes are what they were before the merge", keeperNotes.includes("budget sign-off sits with the board"), false);
c.is("still holding its own", keeperNotes.includes("second silo online before harvest"), true);
await alex.goto(`${accountUrl}/meetings`);
const meetingsAgain = [
  ...new Set(await alex.locator('a[href*="/meetings/"]').evaluateAll((els) => els.map((e) => e.getAttribute("href")))),
];
c.is("two records of the call again", meetingsAgain.length, 2);

await browser.close();
process.exit(c.done() ? 0 : 1);
