// The loop the whole app is built around: a report arrives, the model reads
// it, a person decides, and only then does anything change.
//
// Runs against the synthetic fixture under AI_FAKE=1, so no model is called
// and no money is spent — but everything after the model is real. The canned
// answer still goes through the actual Zod schema and the actual guards
// (lib/ai/runStructured.ts), so this also catches a schema change that would
// break the demo path, which is the thing `npm test` cannot see.
import { join } from "node:path";
import { BASE, checker, launch, signIn, openTab, reviewAsList } from "./browser.mjs";

const browser = await launch();
const c = checker("a report becomes reviewable changes");
const alex = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);

const trigger = alex.locator('[data-testid="account-new-open"]');
if (await trigger.count()) await trigger.click();
await alex.fill('[data-testid="account-new"] [name="name"]', "Synthetic Orchard Lab");
await alex.click('[data-testid="account-new-submit"]');
await alex.waitForURL(/\/accounts\//, { timeout: 15000 });
const accountUrl = alex.url();

await alex.goto(`${accountUrl}/import`);
await alex.setInputFiles('input[type="file"]', join(process.cwd(), "tests/fixtures/agent-report.html"));
await alex.click('button:has-text("Upload and extract")');

// The run is in-process and the page polls for it.
await alex.waitForSelector("text=/proposed change|proposed changes/", { timeout: 60000 });
const summary = await alex.innerText("body");
c.is("the report produced changes to review", /\d+ proposed change/.test(summary), true);

// Nothing is on the account yet: that is the whole point of the proposal step.
await alex.goto(accountUrl);
// Said once, where it can be decided: Since you last looked (DECISIONS #100).
c.is("but the account says something is waiting", (await alex.locator('[data-testid="since-waiting"]').innerText()).includes("waiting"), true);
await openTab(alex, "deals");
const beforeAccepting = await alex.innerText("body");
c.is("nothing applied before anyone said so", beforeAccepting.includes("SyntheticOrchard_EHR-Refresh"), false);

await alex.goto(`${accountUrl}/review`);
// One change at a time by default, with its place in the queue.
c.is("review opens on one card", await alex.getByTestId("change-card").count(), 1);
c.is("and says where it is in the queue", /^1 of \d+$/.test((await alex.locator('[data-testid="change-deck"] [aria-live="polite"]').innerText()).trim()), true);
const firstCard = (await alex.getByTestId("change-card").innerText()).replace(/\s+/g, " ");
c.is("a card shows no raw record id", /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/.test(firstCard), false);
const ackCard = alex.getByTestId("change-card").locator('input[type="checkbox"]');
if (await ackCard.count()) await ackCard.check();
await alex.getByTestId("change-accept").click();
await alex.waitForFunction(() => /^2 of /.test(document.querySelector('[data-testid="change-deck"] [aria-live="polite"]')?.textContent?.trim() ?? "") || !!document.querySelector('[data-testid="change-done"]'), null, { timeout: 15000 });
c.is("accepting moves to the next card", true, true);

// The rest from the whole list, as someone with a forty-row import would.
await alex.goto(`${accountUrl}/review`);
await reviewAsList(alex);
await alex.click('[data-testid="accept-all"]');
await alex.waitForSelector("text=/applied/", { timeout: 30000 });

await alex.goto(accountUrl);
await openTab(alex, "deals");
const afterAccepting = await alex.innerText("body");
c.is("the deals are on the account now", afterAccepting.includes("SyntheticOrchard_EHR-Refresh"), true);
await alex.goto(accountUrl);
c.is("and nothing is waiting any more", await alex.locator('[data-testid="needs-you-row"][data-kind="review"], [data-testid="since-waiting"]').count(), 0);

// The same report again proposes nothing: the diff is against what is already
// there, so re-importing is not a way to duplicate an account.
await alex.goto(`${accountUrl}/import`);
await alex.setInputFiles('input[type="file"]', join(process.cwd(), "tests/fixtures/agent-report.html"));
await alex.click('button:has-text("Upload and extract")');
// Named exactly, because the import now tells three outcomes apart and only
// one of them is the right answer here. "Nothing came through" is the other
// empty result — every deal dropped for an id that is not verbatim in the
// report — and a selector loose enough to accept either would pass on the
// failure it exists to catch. This assertion drifted once already: the copy
// changed and the old pattern ("Nothing to review") matched nothing, so the
// flow sat at its 60-second timeout.
await alex.waitForSelector("text=/already matches this report|Nothing came through|proposed change/i", { timeout: 60000 });
const second = await alex.innerText("body");
c.is("importing the same report again changes nothing", /already matches this report/i.test(second), true);

await browser.close();
process.exit(c.done() ? 0 : 1);
