// The duplicate the app used to guarantee, and the merge that has to survive
// the next report.
//
// A deal exists before the CRM has an id for it. You add it, work it for a
// fortnight, and then the report arrives carrying the real id — and the import
// matches deals on id alone, so it proposes a create. Two rows for one
// opportunity, both in open pipeline, both in every prompt.
//
// The part that is easy to get wrong is the direction. Keep the row you have
// been working and the real CRM id ends up on the archived tombstone — and the
// import reads archived rows on purpose, so the next report finds that id and
// proposes restoring it. Accept all, and the duplicate is back. Every time.
// This walks the whole story and then re-imports to prove it stays dead.
import { join } from "node:path";
import { BASE, checker, launch, signIn, openTab, reviewAsList } from "./browser.mjs";

const browser = await launch();
const c = checker("two rows for one deal");
const alex = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);

const trigger = alex.locator('[data-testid="account-new-open"]');
if (await trigger.count()) await trigger.click();
await alex.fill('[data-testid="account-new"] [name="name"]', "Synthetic Orchard Lab");
await alex.click('[data-testid="account-new-submit"]');
await alex.waitForURL(/\/accounts\//, { timeout: 15000 });
const accountUrl = alex.url();

// A deal with the id left blank, named exactly as the report will name it.
await openTab(alex, "deals");
await alex.click('[data-testid="deal-new-open"]');
await alex.fill('[data-testid="deal-new"] [name="name"]', "SyntheticOrchard_EHR-Refresh");
await alex.fill('[data-testid="deal-new"] [name="tcv_usd"]', "1.8M");
await alex.click('[data-testid="deal-new-submit"]');
await alex.waitForTimeout(1500);

await alex.goto(accountUrl);
const localHref = await alex.getAttribute('a[href*="/deals/local-"]', "href");
c.is("a deal can be added with no CRM id", localHref !== null, true);

// Work it, so it has history worth keeping.
await alex.goto(`${BASE}${localHref}`);
await alex.click('[data-testid="deal-edit-open"]');
await alex.fill('[data-testid="deal-edit"] [name="next_step"]', "Confirm the sizing with their architect");
await alex.click('[data-testid="deal-edit-submit"]');
await alex.waitForTimeout(1500);

// The report arrives, carrying the real id for the same opportunity.
await alex.goto(`${accountUrl}/import`);
await alex.setInputFiles('input[type="file"]', join(process.cwd(), "tests/fixtures/agent-report.html"));
await alex.click('button:has-text("Upload and extract")');
await alex.waitForSelector("text=/proposed change/", { timeout: 60000 });

await alex.goto(`${accountUrl}/review`);

await reviewAsList(alex);
const review = await alex.innerText("body");
// The import cannot match on a name, so it proposes a create — but it says so
// under the card, because a rationale nobody reads is not a fix on its own.
c.is("the review says this looks like the deal already there", /looks like|same deal|already/i.test(review), true);

await alex.click('[data-testid="accept-all"]');
await alex.waitForSelector("text=/applied/", { timeout: 30000 });

await alex.goto(`${accountUrl}/deals`);
c.is(
  "there are now two rows for one opportunity",
  // Scoped to the Deals section. Unscoped, this also counted the same deal
  // named from a play card — which links to it now rather than printing its
  // name as text — so the assertion drifted from "how many rows" to "how many
  // mentions" the moment plays started linking properly.
  await alex.locator('#deals a[href*="/deals/"]').filter({ hasText: "SyntheticOrchard_EHR-Refresh" }).count(),
  2,
);

// Merge, the right way round: the CRM row survives, because its id is the one
// every future report will use.
await alex.goto(`${BASE}${localHref}`);
c.is("the deal page offers the merge", await alex.locator('[data-testid="deal-merge-open"]').count(), 1);

// From the local row the app must refuse, and say which way to go.
await alex.click('[data-testid="deal-merge-open"]');
await alex.click('[data-testid="deal-merge-submit"]');
await alex.waitForTimeout(1500);
const refusal = await alex.innerText("body");
c.is("merging the CRM row into the local one is refused", /merge this deal into that one instead/.test(refusal), true);

// So do it from the CRM row instead.
await alex.goto(`${accountUrl}/deals`);
// The report brings ten deals; the one that matters is the one carrying the
// same name as the row added by hand.
const crmHref = await alex
  .locator('#deals a[href*="/deals/"]:not([href*="local-"])')
  .filter({ hasText: "SyntheticOrchard_EHR-Refresh" })
  .first()
  .getAttribute("href");
await alex.goto(`${BASE}${crmHref}`);
await alex.click('[data-testid="deal-merge-open"]');
await alex.click('[data-testid="deal-merge-submit"]');
await alex.waitForTimeout(2000);

await alex.goto(`${BASE}${crmHref}`);
const survivor = await alex.innerText("body");
c.is("the earlier work is on the surviving deal", survivor.includes("Confirm the sizing with their architect"), true);

await alex.goto(`${accountUrl}/deals`);
// Counting links, not occurrences of the name in the page text: the name also
// appears in the merge narrative and in the archived block, and counting text
// has produced two confident wrong answers on this project already.
c.is(
  "one deal row for the opportunity again",
  await alex.locator('#deals a[href*="/deals/"]').filter({ hasText: "SyntheticOrchard_EHR-Refresh" }).count(),
  1,
);

// And the report that started it all cannot bring the duplicate back.
await alex.goto(`${accountUrl}/import`);
await alex.setInputFiles('input[type="file"]', join(process.cwd(), "tests/fixtures/agent-report.html"));
await alex.click('button:has-text("Upload and extract")');
// Whichever of the import's three outcomes it is — the point of this flow is
// what the review screen holds afterwards, not which sentence the form shows.
// "Nothing to review" was one of the old two and is no longer written
// anywhere, so this waited out its full minute and then failed.
await alex.waitForSelector("text=/proposed change|already matches this report|Nothing came through/i", { timeout: 60000 });
await alex.goto(`${accountUrl}/review`);
await reviewAsList(alex);
const reimport = await alex.innerText("body");
c.is("re-importing does not propose restoring the merged-away row", /Archived, but the report still lists it/.test(reimport), false);

// ---- one owner, two spellings ---------------------------------------------
// The CRM writes the owner as text, so one person arrives as "Jamie" on one
// deal and "Jamie Lee" on another. The pipeline treats them as two owners
// until a person says otherwise; the deals keep what was written.
for (const [name, owner] of [["Synthetic Owner Deal A", "Jamie"], ["Synthetic Owner Deal B", "Jamie Lee"]]) {
  await alex.goto(accountUrl);
  await openTab(alex, "deals");
  await alex.click('[data-testid="deal-new-open"]');
  await alex.fill('[data-testid="deal-new"] [name="name"]', name);
  await alex.fill('[data-testid="deal-new"] [name="owner"]', owner);
  await alex.click('[data-testid="deal-new-submit"]');
  await alex.waitForTimeout(1200);
}
const ownerOptions = async () => (await alex.locator('select[name="owner"] option').allInnerTexts()).filter((o) => o !== "all");
await alex.goto(`${BASE}/pipeline`);
const beforeOwners = await ownerOptions();
c.is("two spellings are two owners until someone says otherwise", beforeOwners.includes("Jamie") && beforeOwners.includes("Jamie Lee"), true);
await alex.click('[data-testid="pipeline-owners"]');
await alex.waitForURL(/\/pipeline\/owners/);
c.is("the owners page suggests the pair", /Jamie\s+reads as\s+Jamie Lee/.test(await alex.innerText('[data-testid="owner-suggestions"]')), true);
await alex.click('[data-testid="owner-suggest-jamie-open"]');
await alex.click('[data-testid="owner-suggest-jamie-submit"]');
await alex.waitForTimeout(1500);
await alex.goto(`${BASE}/pipeline`);
const afterOwners = await ownerOptions();
c.is("once confirmed, the filter offers one owner", afterOwners.includes("Jamie Lee") && !afterOwners.includes("Jamie"), true);
c.is("and nobody else's entry changed", afterOwners.length, beforeOwners.length - 1);
await alex.goto(`${BASE}/pipeline?owner=${encodeURIComponent("Jamie Lee")}`);
const filtered = await alex.innerText("body");
c.is("and filtering by them finds both deals", filtered.includes("Synthetic Owner Deal A") && filtered.includes("Synthetic Owner Deal B"), true);

await browser.close();
process.exit(c.done() ? 0 : 1);
