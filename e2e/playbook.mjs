// The team's playbook: started from the neutral starter, a document read into
// a draft and saved after review, and the earlier version brought back.
// Synthetic text only; the fake reader returns the starter under the
// document's own title.
import { readFile } from "node:fs/promises";
import { BASE, checker, launch, reviewAsList, signIn } from "./browser.mjs";

const c = checker("playbook");
const browser = await launch();
const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);
const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

try {
  await page.goto(`${BASE}/settings/playbook`);
  c.is("with none, the page offers the neutral starter", await page.getByTestId("playbook-use-starter").count(), 1);
  await page.getByTestId("playbook-use-starter").click();
  await page.getByTestId("playbook-view").waitFor({ timeout: 15000 });
  c.is("the starter is the playbook", (await page.locator('[data-testid="playbook-view"] h2').innerText()).trim(), "AI outcome starter");
  c.is("its seven steps are listed", await page.locator('[data-testid="playbook-steps"] > li').count(), 7);

  // A document, pasted, read into a draft.
  await page.fill('[data-testid="playbook-import-text"]', `Synthetic Region Outcome Playbook\n\n${"Steps, archetypes and questions for the team. ".repeat(20)}`);
  await page.getByTestId("playbook-import-run").click();
  await page.getByTestId("playbook-import-review").waitFor({ timeout: 30000 });
  await page.getByTestId("playbook-import-review").click();
  await page.waitForURL(/\/settings\/playbook\/import\//);
  c.is("the draft is shown before anything is saved", (await page.locator('[data-testid="playbook-view"] h2').innerText()).trim(), "Synthetic Region Outcome Playbook");
  await page.getByTestId("playbook-import-save").click();
  await page.waitForTimeout(800);
  await page.goto(`${BASE}/settings/playbook`);
  c.is("saved, it is the playbook", (await page.locator('[data-testid="playbook-view"] h2').innerText()).trim(), "Synthetic Region Outcome Playbook");
  c.is("and the starter is an earlier version", (await page.getByTestId("playbook-history").innerText()).includes("AI outcome starter"), true);

  await page.getByTestId("playbook-restore").first().click();
  await page.waitForFunction(() => document.querySelector('[data-testid="playbook-view"] h2')?.textContent?.trim() === "AI outcome starter", null, { timeout: 15000 });
  c.is("an earlier version comes back", true, true);

  // Edited in place: a new name and a new question, saved as a version.
  await page.getByTestId("playbook-edit-open").click();
  await page.getByTestId("playbook-editor").waitFor();
  await page.fill('[data-testid="playbook-edit-name"]', "Synthetic edited playbook");
  await page.getByTestId("pe-questions-add").click();
  const added = page.getByTestId("pe-questions-item").last();
  await added.locator("summary").click();
  await added.locator("textarea").first().fill("What would a good first year look like to you?");
  await added.locator("select").nth(1).selectOption("M");
  await page.getByTestId("playbook-edit-save").click();
  await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent?.includes("Saved"), null, { timeout: 15000 });
  await page.goto(`${BASE}/settings/playbook`);
  c.is("the edit is the playbook", (await page.locator('[data-testid="playbook-view"] h2').innerText()).trim(), "Synthetic edited playbook");
  c.is("with the new question, tagged", (await page.getByTestId("playbook-view").innerText()).includes("What would a good first year look like to you?"), true);
  c.is("and the history says what changed", /Renamed to “Synthetic edited playbook”, 1 question added|Renamed to “Synthetic edited playbook”; 1 question added/.test(await page.getByTestId("playbook-history").innerText()), true);
  const exported = await page.evaluate(async () => (await fetch("/api/playbook/export")).json());
  c.is("it downloads as a file another team can load", exported.kind === "playbook" && exported.playbook.name === "Synthetic edited playbook", true);
  // An empty name cannot be saved: the editor says why.
  await page.getByTestId("playbook-edit-open").click();
  await page.fill('[data-testid="playbook-edit-name"]', "");
  await page.getByTestId("playbook-edit-save").click();
  await page.getByTestId("playbook-edit-error").waitFor({ timeout: 15000 });
  c.is("a broken edit is refused with the reason", (await page.getByTestId("playbook-edit-error").innerText()).includes("name"), true);

  // Each account gets an archetype: suggested, accepted, then shown where
  // accounts are listed.
  await page.goto(`${BASE}/accounts`);
  const trigger = page.locator('[data-testid="account-new-open"]');
  if (await trigger.count()) await trigger.click();
  await page.fill('[data-testid="account-new"] [name="name"]', "Synthetic Archetype County");
  await page.click('[data-testid="account-new-submit"]');
  await page.waitForURL(/\/accounts\//, { timeout: 15000 });
  const accountId = page.url().split("/accounts/")[1].split(/[#/?]/)[0];
  await page.goto(`${BASE}/accounts/${accountId}/playbook`);
  await page.getByRole("button", { name: "Suggest an archetype" }).click();
  await page.getByTestId("archetype-suggestion").waitFor({ timeout: 30000 });
  await page.getByTestId("archetype-accept").click();
  await page.getByTestId("archetype-current").waitFor({ timeout: 15000 });
  const archetype = (await page.getByTestId("archetype-current").innerText()).trim();
  c.is("the accepted suggestion is the account's archetype", archetype.length > 0, true);
  c.is("with its hypothesis", (await page.getByTestId("archetype-hypothesis").innerText()).length > 20, true);
  c.is("the header names it", (await page.getByTestId("account-archetype").innerText()).trim(), archetype);
  // The lifecycle: start on step one, tick an item, and the next one is what
  // the Overview and the header show.
  await page.getByTestId("playbook-start").click();
  await page.getByTestId("playbook-next").waitFor({ timeout: 15000 });
  const firstItem = (await page.getByTestId("playbook-next").innerText()).replace("Next in the playbook:", "").trim();
  await page.locator('[data-testid="playbook-step"][data-current="true"] [data-testid="playbook-check"]').first().click();
  await page.waitForFunction((first) => !document.querySelector('[data-testid="playbook-next"]')?.textContent?.includes(first), firstItem, { timeout: 15000 });
  const nextItem = (await page.getByTestId("playbook-next").innerText()).replace("Next in the playbook:", "").trim();
  c.is("ticking an item moves the next one up", nextItem !== firstItem && nextItem.length > 0, true);
  c.is("the header says which step", (await page.getByTestId("account-playbook-step").innerText()).startsWith("Step 1:"), true);
  await page.goto(`${BASE}/accounts/${accountId}`);
  c.is("the Overview's Needs you carries it", (await page.locator('[data-testid="needs-you-row"][data-kind="playbook"]').innerText()).includes(nextItem), true);
  // Move to a step with a deadline and make it a follow-up.
  await page.goto(`${BASE}/accounts/${accountId}/playbook`);
  const readout = page.getByTestId("playbook-step").filter({ hasText: "Outcome readout" });
  await readout.locator("summary").click();
  await readout.getByTestId("playbook-move").click();
  await page.getByTestId("playbook-step-follow-up").waitFor({ timeout: 15000 });
  await page.getByTestId("playbook-step-follow-up").click();
  await page.getByRole("status").filter({ hasText: /^Follow-up due/ }).waitFor({ timeout: 15000 });
  await page.goto(`${BASE}/accounts/${accountId}/follow-ups`);
  c.is("the step's timebox is a follow-up", (await page.locator("main").innerText()).includes("Outcome readout"), true);
  await page.goto(`${BASE}/settings/playbook`);
  c.is("the playbook page counts where accounts are", (await page.getByTestId("playbook-health").innerText()).includes("Outcome readout"), true);

  // Meeting prep carries the playbook's questions, tagged.
  await page.goto(`${BASE}/accounts/${accountId}/meetings`);
  await page.click('[data-testid="meeting-new-open"]');
  await page.fill('[data-testid="meeting-new"] [name="title"]', "Synthetic discovery call");
  await page.fill('[data-testid="meeting-new"] [name="held_at"]', "2026-12-01");
  await page.click('[data-testid="meeting-new-submit"]');
  await page.waitForURL(/\/meetings\//, { timeout: 15000 });
  await page.getByTestId("discovery-guide").waitFor({ timeout: 15000 });
  c.is("the meeting has questions from the playbook", (await page.getByTestId("discovery-question").count()) > 3, true);
  c.is("each tagged with what it qualifies", (await page.getByTestId("discovery-meddpicc").count()) > 0, true);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    c.is(`the meeting with its questions fits ${width}px`, await fits(), true);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // Notes from the meeting propose qualification evidence; accepted, it is
  // on the scorecard and in the text for the CRM.
  await page.locator('textarea[name="raw_notes"]').fill("Synthetic discovery notes.\nThe director said the budget for this is set each spring by the finance board.\nWe agreed to send the readout within two days.");
  await page.getByRole("button", { name: "Save and extract changes", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#review")?.textContent.includes("Accept"), null, { timeout: 60000 });
  await page.goto(`${BASE}/accounts/${accountId}/playbook`);
  c.is("the Playbook tab says qualification is waiting", (await page.getByTestId("qualification-waiting").innerText()).includes("waiting"), true);
  await page.goto(`${BASE}/accounts/${accountId}/review`);
  await reviewAsList(page);
  c.is("review shows the element by name", (await page.locator("main").innerText()).includes("Economic buyer"), true);
  await page.click('[data-testid="accept-all"]');
  await page.waitForSelector("text=/applied/", { timeout: 30000 });
  await page.goto(`${BASE}/accounts/${accountId}/playbook#qualification`);
  c.is("accepted, the economic buyer is partial", await page.locator('[data-testid="qualification-row"][data-element="E"]').getAttribute("data-status"), "partial");
  await page.getByTestId("qualification-copy").locator("summary").click();
  c.is("the text for the CRM carries it", (await page.getByTestId("qualification-copy").locator("pre").innerText()).includes("Economic buyer: [Partial]"), true);

  // The workshop: a use case placed by the rubric, put on the roadmap in
  // its phase, with a dated milestone against the budget calendar.
  await page.goto(`${BASE}/accounts/${accountId}/playbook/workshop`);
  await page.getByTestId("workshop-agenda").waitFor({ timeout: 15000 });
  await page.getByTestId("workshop-add-use-case").click();
  const uc = page.getByTestId("workshop-use-case").last();
  await uc.getByTestId("use-case-name").fill("Synthetic permit triage");
  await uc.getByTestId("use-case-value").selectOption("5");
  await uc.getByTestId("use-case-feasibility").selectOption("4");
  await uc.getByText("Where should it run?").click();
  await uc.getByTestId("use-case-relevance").first().selectOption("3");
  c.is("the rubric places it and says why", /Run: .+, because of /.test(await uc.getByTestId("use-case-placement").innerText()), true);
  await uc.getByTestId("use-case-phase").selectOption("1");
  await page.getByTestId("workshop-save").click();
  await page.getByRole("status").filter({ hasText: "Saved." }).waitFor({ timeout: 15000 });
  await page.getByTestId("use-case-roadmap").click();
  await page.getByTestId("use-case-play").waitFor({ timeout: 15000 });
  await page.goto(`${BASE}/accounts/${accountId}/playbook/roadmap`);
  c.is("it is on the roadmap in phase 1", (await page.locator('[data-testid="roadmap-phase"][data-phase="1"]').innerText()).includes("Synthetic permit triage"), true);

  // Turn the rubric round: data sensitivity now favours running in an
  // application, and the workshop's suggestion follows.
  await page.goto(`${BASE}/settings/playbook?edit=1`);
  const sensitivity = page.getByTestId("pe-placement-item").first();
  await sensitivity.locator("summary").click();
  await sensitivity.getByTestId("pe-score-saas").selectOption("2");
  await sensitivity.getByTestId("pe-score-on-prem").selectOption("-2");
  await page.getByTestId("playbook-edit-save").click();
  await page.getByRole("status").filter({ hasText: "Saved" }).waitFor({ timeout: 15000 });
  await page.goto(`${BASE}/settings/playbook`);
  c.is("the history says the placement scores changed", (await page.getByTestId("playbook-history").innerText()).includes("placement scores changed"), true);
  await page.goto(`${BASE}/accounts/${accountId}/playbook/workshop`);
  c.is("the workshop's suggestion follows the edited scores", (await page.getByTestId("use-case-placement").first().innerText()).includes("Run: In an application"), true);
  await page.goto(`${BASE}/accounts/${accountId}/playbook/roadmap`);
  await page.getByTestId("budget-edit-open").click();
  await page.locator('[data-testid="budget-edit"] select[name="fiscal_year_start_month"]').selectOption("7");
  await page.getByTestId("budget-edit-submit").click();
  await page.getByTestId("fiscal-next").waitFor({ timeout: 15000 });
  await page.getByTestId("map-add-open").click();
  await page.fill('[data-testid="map-add"] [name="text"]', "Synthetic pilot readout");
  await page.fill('[data-testid="map-add"] [name="due"]', "2027-08-03");
  await page.getByTestId("map-add-submit").click();
  await page.getByTestId("map-milestone").first().waitFor({ timeout: 15000 });
  c.is("the milestone is dated against the fiscal year", (await page.getByTestId("map-milestone").first().innerText()).includes("next fiscal year"), true);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}/accounts/${accountId}/playbook/workshop`);
    c.is(`the workshop fits ${width}px`, await fits(), true);
    await page.goto(`${BASE}/accounts/${accountId}/playbook/roadmap`);
    c.is(`the roadmap fits ${width}px`, await fits(), true);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // What the playbook asks for, written with Ask, downloads as a deck.
  await page.goto(`${BASE}/accounts/${accountId}/playbook`);
  await page.getByTestId("playbook-artifacts").getByRole("link", { name: "Outcome readout" }).click();
  // A template link asks on arrival.
  await page.getByTestId("ask-report").waitFor({ timeout: 30000 });
  c.is("Ask read the account through the playbook", (await page.locator("main").innerText()).includes("through the playbook"), true);
  await page.getByTestId("ask-report").click();
  await page.waitForURL(/\/reports\/[0-9a-f-]{36}$/, { timeout: 15000 });
  c.is("the readout has the playbook's headings", (await page.getByTestId("report").innerText()).includes("A note to forward"), true);
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.getByTestId("report-deck").click()]);
  const deck = await readFile(await download.path());
  c.is("it downloads as a PowerPoint deck", download.suggestedFilename().endsWith(".pptx") && deck.subarray(0, 2).toString() === "PK" && deck.length > 20000, true);

  // The action plan as a calendar file.
  await page.goto(`${BASE}/accounts/${accountId}/playbook/roadmap`);
  const [ics] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.getByTestId("map-ics").click()]);
  const cal = (await readFile(await ics.path())).toString();
  c.is("the action plan downloads as a calendar file", cal.startsWith("BEGIN:VCALENDAR") && cal.includes("Synthetic pilot readout") && cal.includes("DTSTART;VALUE=DATE:20270803"), true);

  // The first step shows what is on file.
  await page.goto(`${BASE}/accounts/${accountId}/playbook`);
  c.is("the first step shows what is on file", (await page.getByTestId("playbook-dossier").count()) === 1, true);

  // The quarterly refresh, run by hand, proposes for this account.
  await page.goto(`${BASE}/assistants`);
  await page.getByTestId("assistant-mode-quarterly_refresh-ask").click();
  await page.getByTestId("assistant-run-quarterly_refresh").waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector('[data-testid="assistant-run-quarterly_refresh"]')?.hasAttribute("disabled"), null, { timeout: 15000 });
  await page.getByTestId("assistant-run-quarterly_refresh").click();
  const said = page.getByTestId("assistant-message-quarterly_refresh").filter({ hasText: /refresh|account/i });
  await said.waitFor({ timeout: 30000 });
  const refreshSaid = await said.innerText();
  c.is("the quarterly refresh proposes a follow-up", refreshSaid.includes("Proposed a refresh follow-up for Synthetic Archetype County"), true);

  // Salesforce, with synthetic records: turned on, checked, read into review,
  // and the scorecard sent after its preview.
  await page.goto(`${BASE}/settings/salesforce`);
  c.is("Salesforce starts off", (await page.getByTestId("sf-state").innerText()).trim(), "Off");
  await page.getByTestId("sf-settings-open").click();
  await page.locator('[data-testid="sf-settings"] [name="enabled"]').check();
  await page.fill('[data-testid="sf-settings"] [name="ib_object"]', "Asset");
  await page.fill('[data-testid="sf-settings"] [name="ib_product"]', "Product2.Name");
  await page.fill('[data-testid="sf-settings"] [name="ib_value"]', "Price");
  await page.fill('[data-testid="sf-settings"] [name="q_combined"]', "MEDDPICC_Notes__c");
  await page.getByTestId("sf-settings-submit").click();
  await page.getByTestId("sf-check").waitFor({ timeout: 15000 });
  await page.getByTestId("sf-check").click();
  await page.getByRole("status").filter({ hasText: "Salesforce answered" }).waitFor({ timeout: 15000 });
  await page.goto(`${BASE}/accounts/${accountId}/details`);
  if (await page.getByTestId("account-edit-open").count()) await page.getByTestId("account-edit-open").click();
  await page.fill('[data-testid="account-edit"] [name="crm_id"]', "001000000000001AAA");
  await page.getByTestId("account-edit-submit").click();
  await page.waitForFunction(() => document.body.innerText.includes("001000000000001AAA"), null, { timeout: 15000 });
  await page.goto(`${BASE}/accounts/${accountId}/playbook#qualification`);
  await page.getByTestId("sf-read").click();
  await page.getByRole("status").filter({ hasText: "from Salesforce to review" }).waitFor({ timeout: 30000 });
  await page.goto(`${BASE}/accounts/${accountId}/review`);
  await reviewAsList(page);
  const fromSf = page.locator("section").filter({ has: page.getByRole("heading", { name: "From Salesforce" }) });
  c.is("Salesforce's opportunities wait in review, said to be from Salesforce", (await fromSf.innerText()).includes("Synthetic platform renewal"), true);
  await fromSf.getByTestId("accept-all").click();
  await page.waitForSelector("text=/applied/", { timeout: 30000 });
  await page.goto(`${BASE}/accounts/${accountId}/playbook#qualification`);
  await page.getByTestId("sf-send-open").click();
  c.is("the send shows exactly what will be written", (await page.getByTestId("sf-preview").innerText()).startsWith("MEDDPICC_Notes__c: MEDDPICC ("), true);
  await page.getByTestId("sf-send-submit").click();
  await page.goto(`${BASE}/settings/salesforce`);
  c.is("the write is on file", (await page.getByTestId("sf-log").innerText()).includes("Wrote the qualification scorecard to opportunity"), true);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}/settings/salesforce`);
    c.is(`the Salesforce page fits ${width}px`, await fits(), true);
    await page.goto(`${BASE}/accounts/${accountId}/playbook`);
    c.is(`the Playbook tab with Salesforce fits ${width}px`, await fits(), true);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // A second playbook, and this account using it.
  await page.goto(`${BASE}/settings/playbook`);
  await page.getByTestId("playbook-new-open").click();
  await page.fill('[data-testid="playbook-new"] [name="name"]', "Synthetic Commercial");
  await page.getByTestId("playbook-new-submit").click();
  await page.getByTestId("playbook-switcher").getByRole("link", { name: /Synthetic Commercial/ }).waitFor({ timeout: 15000 });
  await page.goto(`${BASE}/accounts/${accountId}/playbook`);
  c.is("with two playbooks, the account says which it uses", (await page.getByTestId("account-playbook-name").innerText()).trim() !== "", true);
  await page.getByTestId("account-playbook-set-open").click();
  await page.locator('[data-testid="account-playbook-set"] select[name="playbook_slug"]').selectOption("synthetic-commercial");
  await page.getByTestId("account-playbook-set-submit").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="account-playbook-name"]')?.textContent === "Synthetic Commercial", null, { timeout: 15000 });
  c.is("and uses the one chosen", (await page.getByTestId("account-playbook-name").innerText()).trim(), "Synthetic Commercial");

  // A second account without one, so the filter has something to leave out.
  await page.goto(`${BASE}/accounts`);
  if (await trigger.count()) await trigger.click();
  await page.fill('[data-testid="account-new"] [name="name"]', "Synthetic Other Borough");
  await page.click('[data-testid="account-new-submit"]');
  await page.waitForURL(/\/accounts\/[^/]+$/, { timeout: 15000 });
  await page.goto(`${BASE}/accounts`);
  c.is("the list row names it", (await page.getByTestId("account-row-archetype").first().innerText()).trim(), archetype);
  await page.getByTestId("accounts-archetypes").getByRole("link", { name: archetype }).first().click();
  await page.waitForURL(/archetype=/, { timeout: 15000 });
  const listed = await page.locator("main").innerText();
  c.is("the Accounts list filters to it", listed.includes("Synthetic Archetype County") && !listed.includes("Synthetic Other Borough"), true);

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}/settings/playbook`);
    c.is(`the playbook page fits ${width}px`, await fits(), true);
    await page.goto(`${BASE}/accounts/${accountId}/playbook`);
    c.is(`the account's Playbook tab fits ${width}px`, await fits(), true);
  }
} finally {
  await browser.close();
}
process.exit(c.done() ? 0 : 1);
