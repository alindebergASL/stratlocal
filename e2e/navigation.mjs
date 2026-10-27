// Back goes where you came from, filters and all; arriving from outside the
// app it goes to the page's natural parent. Breadcrumbs name where a page sits.
import { join } from "node:path";
import { BASE, checker, launch, reviewAsList, signIn } from "./browser.mjs";

const c = checker("navigation");
const browser = await launch();
const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);

try {
  await page.goto(`${BASE}/accounts`);
  const trigger = page.locator('[data-testid="account-new-open"]');
  if (await trigger.count()) await trigger.click();
  await page.fill('[data-testid="account-new"] [name="name"]', "Synthetic Navigation County");
  await page.click('[data-testid="account-new-submit"]');
  await page.waitForURL(/\/accounts\//, { timeout: 15000 });
  const accountId = page.url().split("/accounts/")[1].split(/[#/?]/)[0];
  await page.goto(`${BASE}/accounts/${accountId}/import`);
  await page.setInputFiles('input[type="file"]', join(process.cwd(), "tests/fixtures/agent-report.html"));
  await page.click('button:has-text("Upload and extract")');
  await page.waitForSelector("text=/proposed change/", { timeout: 60000 });
  await page.goto(`${BASE}/accounts/${accountId}/review`);
  await reviewAsList(page);
  await page.click('[data-testid="accept-all"]');
  await page.waitForSelector("text=/applied/", { timeout: 30000 });

  // From a filtered pipeline into a deal, and Back.
  await page.goto(`${BASE}/pipeline?status=all`);
  const dealLink = page.locator(`a[href*="/accounts/${accountId}/deals/"]`).first();
  await dealLink.click();
  await page.waitForURL(/\/deals\//, { timeout: 15000 });
  // The link starts as the parent and becomes "Back to …" once the page has read the trail.
  await page.getByTestId("back-link").filter({ hasText: "Back to" }).waitFor({ timeout: 10000 });
  c.is("the deal page offers Back to the pipeline", (await page.getByTestId("back-link").innerText()).trim(), "← Back to Pipeline");
  c.is("and names where it sits", (await page.getByTestId("breadcrumb").innerText()).replace(/\s+/g, " ").includes("Accounts › Synthetic Navigation County › Deals ›"), true);
  await page.getByTestId("back-link").click();
  await page.waitForURL(/\/pipeline/, { timeout: 15000 });
  c.is("Back returns to the pipeline with its filter", new URL(page.url()).searchParams.get("status"), "all");

  // Opened directly, Back is the page's parent.
  const deal = await dealLink.getAttribute("href");
  const fresh = await (await browser.newContext({ storageState: await page.context().storageState() })).newPage();
  await fresh.goto(`${BASE}${deal}`);
  c.is("arriving from outside, Back goes to the account's Deals", (await fresh.getByTestId("back-link").getAttribute("href")) ?? "", `/accounts/${accountId}/deals`);
  // Plays ranked by the team; one set aside as information only.
  await page.goto(`${BASE}/accounts/${accountId}/plays`);
  for (const title of ["Synthetic second play", "Synthetic third play"]) {
    await page.getByTestId("play-new-open").click();
    await page.fill('[data-testid="play-new"] [name="title"]', title);
    await page.getByTestId("play-new-submit").click();
    await page.locator('[data-testid="play-scan-row"]', { hasText: title }).waitFor({ timeout: 15000 });
  }
  const rows = page.getByTestId("play-scan-list").getByTestId("play-scan-row");
  const last = rows.last();
  const lastTitle = (await last.locator("a").first().innerText()).trim();
  await last.getByTestId("play-up").click();
  await page.waitForFunction((t) => [...document.querySelectorAll('[data-testid="play-scan-list"] [data-testid="play-scan-row"]')].at(-2)?.textContent?.includes(t), lastTitle, { timeout: 15000 });
  c.is("a play moves up the ranking", (await rows.nth((await rows.count()) - 2).innerText()).includes(lastTitle), true);
  await rows.last().getByTestId("play-more").click();
  await rows.last().getByTestId("play-info-only").click();
  await page.getByTestId("play-section-info").waitFor({ timeout: 15000 });
  c.is("a play set to information only leaves the ranking", await page.getByTestId("play-section-info").count(), 1);
  // An open deal with no next step, acknowledged as informational: listed as
  // acknowledged, and asked about again once its stage moves.
  await page.goto(`${BASE}/accounts/${accountId}/deals?next=none`);
  const bare = page.locator(`a[href*="/accounts/${accountId}/deals/"]`).first();
  await bare.click();
  await page.waitForURL(/\/deals\/[^/?]+/, { timeout: 15000 });
  const dealUrl = page.url();
  await page.getByTestId("next-step-waive-open").click();
  await page.fill('[data-testid="next-step-waive"] [name="reason"]', "Synthetic: waiting on their budget vote");
  await page.check('[data-testid="next-step-waive"] [name="kind"][value="info"]');
  await page.getByTestId("next-step-waive-submit").click();
  await page.getByTestId("next-step-waived").waitFor({ timeout: 15000 });
  c.is("the deal says no next step is needed", (await page.getByTestId("next-step-waived").innerText()).includes("while it stands"), true);
  await page.goto(`${BASE}/accounts/${accountId}/deals`);
  c.is("and the Deals tab lists it as acknowledged", (await page.getByTestId("deals-filter-ack").innerText()).trim(), "1 acknowledged");
  await page.goto(dealUrl);
  await page.getByTestId("deal-edit-open").click();
  const stage = page.locator('[data-testid="deal-edit"] select[name="stage"]');
  await stage.selectOption((await stage.inputValue()) === "5" ? "4" : "5");
  await page.getByTestId("deal-edit-submit").click();
  await page.getByTestId("next-step-waive-open").waitFor({ timeout: 15000 });
  c.is("a change of stage asks again", await page.getByTestId("next-step-waived").count(), 0);
} finally {
  await browser.close();
}
process.exit(c.done() ? 0 : 1);
