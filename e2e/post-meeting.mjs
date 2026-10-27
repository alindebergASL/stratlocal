// Disposable AI_FAKE=1 journey, registered in run.mjs. No paid provider calls.
import Database from "better-sqlite3";
import { checker, launch, signIn, openTab } from "./browser.mjs";
const browser = await launch();
const c = checker("post-meeting follow-through");
const db = new Database(process.env.E2E_DB_PATH, { readonly: true });
try {
  const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);
  const trigger = page.getByTestId("account-new-open");
  if (await trigger.count()) await trigger.click();
  await page.fill('[data-testid="account-new"] [name="name"]', "Synthetic Follow Through Lab");
  await page.getByTestId("account-new-submit").click();
  await page.waitForURL(/\/accounts\//);
  await openTab(page, "meetings");
  await page.getByTestId("meeting-new-open").click();
  await page.fill('[data-testid="meeting-new"] [name="title"]', "Synthetic post-call review");
  await page.fill('[data-testid="meeting-new"] [name="held_at"]', "2026-01-02");
  await page.getByTestId("meeting-new-submit").click();
  await page.waitForURL(/\/meetings\//);
  const url = page.url();
  const mid = new URL(url).pathname.split("/").at(-1);
  const meeting = () => db.prepare("SELECT * FROM meetings WHERE id = ?").get(mid);
  const items = () => db.prepare("SELECT * FROM action_items WHERE meeting_id = ? AND archived_at IS NULL").all(mid);
  const proposals = () => db.prepare("SELECT * FROM proposals WHERE origin_kind = 'meeting' AND origin_id = ?").all(mid);
  const notes = page.locator('textarea[name="raw_notes"]');
  const status = page.getByTestId("post-meeting-status");
  const save = page.getByRole("button", { name: "Save only", exact: true });
  const settleSaved = () => page.waitForFunction(() => document.querySelector('[data-testid="post-meeting-status"]')?.textContent.includes("Notes saved.") && [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Save only" && b.disabled));
  c.is("blank notes are not complete", (await status.innerText()).includes("No notes saved yet"), true);
  c.is("initial DB is blank", meeting().raw_notes ?? "", "");
  const text = "Send the synthetic storage sizing document after this call.";
  await notes.fill(text);
  c.is("typing is unsaved", (await status.innerText()).includes("Unsaved notes"), true);
  c.is("typing writes nothing", meeting().raw_notes ?? "", "");
  let posts = 0;
  const countPosts = (r) => { if (r.method() === "POST") posts++; };
  page.on("request", countPosts);
  for (const hash of ["#review", "#follow-ups", "#notes"]) {
    await page.locator(`[data-testid="meeting-nav"] a[href="${hash}"]`).click();
    await page.waitForURL((u) => u.hash === hash);
    c.is(`draft survives ${hash}`, await notes.inputValue(), text);
  }
  await page.goBack();
  await page.waitForURL((u) => u.hash === "#follow-ups");
  c.is("Back preserves draft", await notes.inputValue(), text);
  c.is("navigation posts nothing", posts, 0);
  page.off("request", countPosts);
  c.is("navigation leaves DB blank", meeting().raw_notes ?? "", "");
  await save.click();
  await settleSaved();
  c.is("Save only persisted exact notes", meeting().raw_notes, text);
  c.is("Save only created no proposals", proposals().length, 0);
  c.is("Save only does not claim extraction", (await status.innerText()).includes("Saving notes does not extract changes."), true);
  c.is("no zero-gap detail without open follow-ups", await page.getByTestId("follow-up-gaps").count(), 0);
  await page.getByRole("button", { name: "Save and extract changes", exact: true }).click();
  // The deck is the default; this flow checks the list, one click away.
  await page.getByTestId("review-as-list").click({ timeout: 15000 });
  await page.getByTestId("proposal-row").first().waitFor({ timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="post-meeting-status"]')?.textContent.includes("2 proposed changes awaiting explicit review"));
  c.is("extraction saved no accepted follow-ups", items().length, 0);
  c.is("fake extraction produced two pending proposals", proposals().filter((p) => p.status === "pending").length, 2);
  const summary = proposals().find((p) => p.entity_type === "meeting");
  await page.locator(`[data-proposal-id="${summary.id}"]`).getByTestId("row-reject").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="post-meeting-status"]')?.textContent.includes("1 proposed change awaiting explicit review"));
  c.is("reject leaves summary unchanged", meeting().summary ?? "", "");
  c.is("reject recorded in DB", proposals().find((p) => p.id === summary.id).status, "rejected");
  const draft = `${text} Draft clarification not yet saved.`;
  await notes.fill(draft);
  await page.getByTestId("row-accept").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="follow-up-gaps"]')?.textContent.includes("1 follow-up missing details"));
  c.is("explicit review creates a recorded follow-up", items().length, 1);
  c.is("proposal is no longer pending", proposals().filter((p) => p.status === "pending").length, 0);
  c.is("review RSC refresh preserves dirty draft", await notes.inputValue(), draft);
  c.is("review does not save dirty notes", meeting().raw_notes, text);
  c.is("dirty status outranks old extraction", (await status.innerText()).includes("Unsaved notes"), true);
  await save.click();
  await settleSaved();
  c.is("new draft saves without re-extraction", meeting().raw_notes, draft);
  c.is("saved new draft is not called extracted", await page.locator('#notes-controls [role="status"]').innerText(), "Saved");
  c.is("one follow-up has both labels", await page.getByTestId("follow-up-gaps").innerText(), "1 follow-up missing details (1 missing owner; 1 missing date)");
  await page.getByTestId("post-meeting-next").click();
  await page.waitForURL((u) => u.hash === "#follow-ups");
  await page.locator("#follow-ups").getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator('[data-testid="follow-up-form"] [data-testid="follow-up-owner"]').selectOption({ label: "Alex" });
  await page.fill('[data-testid="follow-up-form"] [name="due"]', "2026-10-01");
  await page.getByTestId("follow-up-save").click();
  await page.getByTestId("follow-up-form").waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.querySelector('[data-testid="follow-up-gaps"]')?.textContent.includes("0 follow-ups missing details"));
  c.is("date persisted", items()[0].due, "2026-10-01");
  c.is("owner persisted", !!items()[0].owner_user_id, true);
  await page.reload();
  await status.waitFor();
  c.is("reload preserves saved notes", await notes.inputValue(), draft);
  c.is("reload does not infer completion", (await status.innerText()).includes("Notes saved. Review or extract when ready."), true);
  c.is("reload explains Save only", (await status.innerText()).includes("Saving notes does not extract changes."), true);
  const extractPath = `**/api/meetings/${mid}/extract`;
  await page.route(extractPath, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic start rejected" }) }));
  await page.getByRole("button", { name: "Save and extract changes", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#notes-controls [role="status"]')?.textContent === "Synthetic start rejected");
  c.is("rejected start is scoped to current notes", (await status.innerText()).includes("Extraction needs attention"), true);
  const afterFailure = `${draft} Edited after synthetic start failure.`;
  await notes.fill(afterFailure);
  c.is("edited notes have their own unsaved status", (await status.innerText()).includes("Unsaved notes"), true);
  await save.click(); await settleSaved();
  c.is("post-failure Save only persists changed notes", meeting().raw_notes, afterFailure);
  c.is("lower status is neither stale Read nor old failure", await page.locator('#notes-controls [role="status"]').innerText(), "Saved");
  c.is("post-failure current summary is saved", await status.locator('p').first().innerText(), "Notes saved. Review or extract when ready.");
  await page.unroute(extractPath);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    c.is(`fits ${width}px`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    c.is(`review is outside the notes workspace at ${width}`, await page.locator('[data-testid="meeting-workspace"] #review').count(), 0);
    c.is(`review uses workspace width at ${width}`, await page.evaluate(() => document.querySelector('#review').getBoundingClientRect().width >= document.querySelector('[data-testid="meeting-workspace"]').getBoundingClientRect().width * 0.95), true);
    c.is(`source notes stay reachable at ${width}`, await page.locator('#review a[href="#notes"]').count(), 1);
  }

  // The deck: the same decisions, one card at a time. Every card accepted
  // through it is accepted in the database, and the last one says so.
  await page.setViewportSize({ width: 390, height: 1000 });
  const before = proposals().filter((p) => p.status === "accepted").length;
  // Fresh notes, so nothing the deck proposes duplicates what was accepted above.
  await notes.fill("Synthetic second call. We agreed to send the revised depot sizing outline next week.");
  await page.getByRole("button", { name: "Save and extract changes", exact: true }).click();
  await page.getByTestId("change-deck").waitFor({ timeout: 15000 });
  const fresh = proposals().filter((p) => p.status === "pending").length;
  c.is("a new extraction deals a deck", fresh > 0, true);
  for (let i = 0; i < 10 && (await page.getByTestId("change-done").count()) === 0; i++) {
    await page.getByTestId("change-accept").click();
    await page.waitForFunction(() => !document.querySelector('[data-testid="change-accept"]')?.disabled);
  }
  await page.getByTestId("change-done").waitFor();
  c.is("the deck accepted every card in the database", proposals().filter((p) => p.status === "accepted").length, before + fresh);
  c.is("nothing from the deck is left pending", proposals().filter((p) => p.status === "pending").length, 0);
  c.is("the deck fits a phone", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);

  // The recap: drafted from the notes, quoted line by line, never sent.
  const accepted = proposals().filter((p) => p.status === "accepted").length;
  await page.getByTestId("change-show-updated").click();
  await page.locator("#recap").scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Draft the recap email", exact: true }).click();
  await page.getByTestId("recap-draft").waitFor({ timeout: 15000 });
  const recap = await page.getByTestId("recap-draft").innerText();
  c.is("the recap is signed by the person, not the model", recap.includes("Best,"), true);
  c.is("the recap opens in the person's own mail", (await page.getByTestId("recap-mail").getAttribute("href")).startsWith("mailto:"), true);
  await page.locator('[data-testid="recap-draft"] li button').first().click();
  c.is("a recap line shows the note it came from", (await page.getByTestId("recap-draft").innerText()).includes("You wrote:"), true);
  c.is("drafting the recap changes no records", proposals().filter((p) => p.status === "accepted").length, accepted);
  c.is("the recap fits a phone", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
} finally {
  db.close();
  await browser.close();
}
process.exit(c.done() ? 0 : 1);
