// Two people, one record.
//
// The case this whole check exists for: both of them have the deal page open,
// one saves, and then the other saves from a page that was rendered before
// that. Until this round the second save won silently and the screen said
// "Saved" in green.
//
// Three things have to hold, and only the middle one is obvious:
//   1. Editing different fields is not a collision and must not be refused,
//      or the refusal becomes noise and both of them learn to click through it.
//      Note what "different fields" has to mean: the deal edit form submits
//      every field it renders, so a stale one really would revert their notes
//      along with everything else, and refusing it is right. The quick edit on
//      the account page sends three fields, so it is the honest test of the
//      allowance — and it is also how these two actually work, one in the deal
//      page and one running down the list.
//   2. Editing the same field is refused, and the refusal says what the
//      record holds now and who put it there.
//   3. Save anyway works — the answer "mine, I know" has to be available or
//      the refusal is a dead end.
import { BASE, checker, launch, signIn, openTab } from "./browser.mjs";

const browser = await launch();
const c = checker("two people, one record");

const alex = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);
const jamie = await signIn(browser, process.env.E2E_USER2_EMAIL, process.env.E2E_USER2_PASSWORD);

// Forms are addressed by name, not by their words. Every one of these flows
// used to break on copy changes that were deliberate improvements, which made
// them read as noise rather than as signal.
async function form(page, id) {
  const trigger = page.locator(`[data-testid="${id}-open"]`);
  if (await trigger.count()) await trigger.click();
  return {
    fill: (name, value) => page.fill(`[data-testid="${id}"] [name="${name}"]`, value),
    read: (name) => page.inputValue(`[data-testid="${id}"] [name="${name}"]`),
    attr: (name, attribute) => page.getAttribute(`[data-testid="${id}"] [name="${name}"]`, attribute),
    async save() {
      await page.click(`[data-testid="${id}-submit"]`);
      await page.waitForTimeout(1200);
    },
    alert: () => page.locator(`[data-testid="${id}"] [role="alert"]`),
  };
}

// An account with one deal on it.
const newAccount = await form(alex, "account-new");
await newAccount.fill("name", "Synthetic Orchard Lab");
await newAccount.save();
await alex.waitForURL(/\/accounts\//, { timeout: 15000 });
const accountUrl = alex.url();

await openTab(alex, "deals");
const newDeal = await form(alex, "deal-new");
await newDeal.fill("name", "EHR Refresh");
await newDeal.fill("tcv_usd", "1K");
await newDeal.save();

const dealUrl = `${BASE}${await alex.getAttribute('a[href*="/deals/"]', "href")}`;

// Both of them on the deal page with the form open, holding the same picture
// of the record.
async function bothOpenTheDeal() {
  await alex.goto(dealUrl);
  await jamie.goto(dealUrl);
  return [await form(alex, "deal-edit"), await form(jamie, "deal-edit")];
}

// 1. Different fields, from the two places a person actually edits from.
let [mine, theirs] = await bothOpenTheDeal();
c.is("both forms carry the same version", await mine.attr("base_version", "value"), await theirs.attr("base_version", "value"));

// Jamie, on the deal page, writes something down about the account.
await theirs.fill("notes", "Their CFO started in March.");
await theirs.save();

// Alex, on the account page from before that, sets a next step. The quick
// edit sends stage, next step and status and nothing else, so there is
// genuinely nothing of Jamie's for it to tread on.
await alex.goto(accountUrl);
await openTab(alex, "deals");
await alex.click('[data-testid^="deal-quick-"]');
await alex.fill('form [name="next_step"]', "Book the architecture review");
await alex.click('form button[type="submit"]:has-text("Save")');
await alex.waitForTimeout(1200);

c.is("a save touching other fields is not refused", await alex.locator('[role="alert"]:has-text("Not saved")').count(), 0);
await alex.goto(dealUrl);
const bothKept = await alex.innerText("body");
c.is("their notes survived", bothKept.includes("CFO started in March"), true);
c.is("my next step survived", bothKept.includes("Book the architecture review"), true);

// 2. The same field.
[mine, theirs] = await bothOpenTheDeal();
await theirs.fill("next_step", "Send the sizing document");
await theirs.save();
await mine.fill("next_step", "Walk the pricing through with procurement");
await mine.save();

const notice = mine.alert();
c.is("the same field is refused", await notice.count(), 1);
const text = (await notice.count()) ? await notice.innerText() : "";
c.is("the refusal names the field", text.includes("next step"), true);
c.is("the refusal shows what the record says now", text.includes("Send the sizing document"), true);
c.is("the refusal names who wrote it", text.includes("Jamie"), true);
// React 19 empties an uncontrolled form once its action resolves, which after
// a refusal would clear the edit while the notice says nothing was lost.
c.is("what I typed is still in the form", await mine.read("next_step"), "Walk the pricing through with procurement");

await jamie.goto(dealUrl);
c.is("nothing was written", (await jamie.innerText("body")).includes("Send the sizing document"), true);

// 3. Save anyway.
await alex.click('button:has-text("Save anyway")');
await alex.waitForTimeout(1500);
await alex.goto(dealUrl);
c.is("save anyway applies", (await alex.innerText("body")).includes("Walk the pricing through with procurement"), true);

// ---- the team's direction, written by one and edited by the other -----------
await alex.goto(`${BASE}/settings/direction`);
await jamie.goto(`${BASE}/settings/direction`); // Jamie's page is now drawn on "nothing written yet"
await alex.fill('[data-testid="direction-edit"] [name="focus_areas"]', "AI agents\nAI security\nObservability");
await alex.fill('[data-testid="direction-edit"] [name="goals"]', "Three agent pilots this half");
await alex.click('[data-testid="direction-edit-submit"]');
await alex.waitForTimeout(1500);
await alex.reload();
const written = await alex.innerText('[data-testid="direction-current"]');
c.is("the direction reads back after a reload", written.includes("AI security") && written.includes("Three agent pilots this half"), true);
await jamie.fill('[data-testid="direction-edit"] [name="focus_areas"]', "Something else entirely");
await jamie.click('[data-testid="direction-edit-submit"]');
await jamie.waitForTimeout(1500);
c.is("an edit from a page drawn before the other's save is refused", /changed since this page was opened/.test(await jamie.innerText("body")), true);
await alex.reload();
c.is("and the first one's direction stands", (await alex.innerText('[data-testid="direction-current"]')).includes("AI security"), true);

await browser.close();
process.exit(c.done() ? 0 : 1);
