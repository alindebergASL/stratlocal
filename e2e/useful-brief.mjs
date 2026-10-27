// Synthetic-only browser journey. AI_FAKE replay validates product plumbing,
// not live model quality. Direct DB writes below are explicitly legacy fixtures.
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { BASE, checker, launch, signIn, openTab } from "./browser.mjs";

if (!process.env.E2E_DB_PATH?.includes("strategy-e2e-")) throw Error("Disposable e2e DB required");
const browser = await launch();
const c = checker("useful brief, exact evidence, human-owned follow-up");
const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);
const db = new Database(process.env.E2E_DB_PATH);
try {
  const trigger = page.locator('[data-testid="account-new-open"]');
  if (await trigger.count()) await trigger.click();
  await page.fill('[data-testid="account-new"] [name="name"]', "Synthetic Harbor Conversation Lab");
  await page.click('[data-testid="account-new-submit"]');
  await page.waitForURL(/\/accounts\//);
  const accountUrl = page.url();
  const accountId = new URL(accountUrl).pathname.split("/")[2];
  const items = () => db.prepare("SELECT * FROM action_items WHERE account_id=?").all(accountId);
  const runCount = () => db.prepare("SELECT COUNT(*) n FROM ai_runs WHERE account_id=?").get(accountId).n;

  await openTab(page, "deals");
  await page.click('[data-testid="deal-new-open"]');
  await page.fill('[data-testid="deal-new"] [name="name"]', "Operational platform evaluation");
  await page.click('[data-testid="deal-new-submit"]');
  await page.waitForFunction(() => !document.querySelector('[data-testid="deal-new"]'));
  await page.goto(`${accountUrl}/research`);
  await page.fill('[data-testid="research-focus"]', "Published operational reliability plans");
  await page.click('[data-testid="research-run"]');
  await page.waitForSelector('[data-testid="research-result"]', { timeout: 60000 });
  await page.goto(`${accountUrl}/research`);
  const acceptResponse = page.waitForResponse(r => r.request().method() === "POST" && r.url().includes("/api/research-notes/"));
  await page.click('[data-testid="note-accept"]');
  c.is("research acceptance succeeds", (await acceptResponse).status(), 200);
  c.is("accepted research is actually stored", db.prepare("SELECT COUNT(*) n FROM documents WHERE account_id=? AND kind='research_note' AND status='accepted'").get(accountId).n > 0, true);

  async function meeting(title) {
    await page.goto(`${accountUrl}/meetings`);
    await page.click('[data-testid="meeting-new-open"]');
    await page.fill('[data-testid="meeting-new"] [name="title"]', title);
    await page.fill('[data-testid="meeting-new"] [name="held_at"]', "2027-01-15");
    await page.click('[data-testid="meeting-new-submit"]');
    await page.waitForURL(/\/meetings\//);
    return { url: page.url(), id: new URL(page.url()).pathname.split("/").at(-1) };
  }
  const first = await meeting("Operational reliability review");
  await page.getByRole("button", { name: "Prepare this meeting", exact: true }).click();
  await page.waitForSelector('[data-testid="brief-conversation"]', { timeout: 60000 });
  const stored = db.prepare("SELECT brief_json FROM meetings WHERE id=?").get(first.id).brief_json;
  c.is("fake generation stores the new conversation structure", !!JSON.parse(stored).conversation, true);
  c.is("the purpose is visible", (await page.locator('[data-testid="brief-purpose"]').innerText()).length > 10, true);
  const facts = await page.locator('[data-testid="brief-fact"]').count();
  const questions = await page.locator('[data-testid="brief-question"]').count();
  c.is("facts are bounded without padding", facts > 0 && facts <= 3, true);
  c.is("questions are bounded without padding", questions > 0 && questions <= 3, true);
  c.is("hypothesis is explicitly not established", /not established/i.test(await page.locator('[data-testid="brief-hypothesis"]').innerText()), true);
  c.is("what would settle it is visible", await page.locator('[data-testid="brief-hypothesis-unknown"]').count(), 1);
  c.is("full brief starts folded", await page.locator('[data-testid="brief-details"]').getAttribute("open"), null);
  c.is("evidence date is visible", /\d{4}-\d{2}-\d{2}/.test(await page.locator('[data-testid="brief-facts"]').innerText()), true);
  const researchLink = await page.locator('[data-testid="brief-ref"][href*="/research?"]').first().getAttribute("href");
  c.is("research citation names an exact finding", /[?&]finding=\d+/.test(researchLink), true);
  await page.goto(new URL(researchLink, BASE).href);
  c.is("citation reaches a real finding element", await page.evaluate(() => !!document.getElementById(decodeURIComponent(location.hash.slice(1)))), true);
  await page.goto(first.url);
  await page.locator('[data-testid="brief-details"] summary').click();
  c.is("the full situation remains available", await page.locator('[data-testid="brief-section-situation"]').isVisible(), true);
  c.is("full citation inventory is available", await page.locator('[data-testid="brief-sources"]').isVisible(), true);

  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    c.is(`no sideways scrolling at ${width}px`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  }
  await page.setViewportSize({ width: 1440, height: 950 });
  const beforeRuns = runCount();
  await page.click('[data-testid="brief-follow-up-open"]');
  c.is("opening a handoff writes no action", items().length, 0);
  c.is("opening the handoff makes no AI call", runCount(), beforeRuns);
  c.is("owner requires a human choice", await page.inputValue('[data-testid="brief-follow-up-owner"]'), "");
  c.is("no due date is invented", await page.inputValue('[data-testid="brief-follow-up-due"]'), "");
  const chosen = "Schedule the operational review with the account team";
  await page.fill('[data-testid="brief-follow-up-text"]', chosen);
  await page.selectOption('[data-testid="brief-follow-up-owner"]', { label: "Alex" });
  await page.fill('[data-testid="brief-follow-up-due"]', "2027-01-16");
  const writePromise = page.waitForRequest(r => r.method() === "POST" && !!r.headers()["next-action"] && r.url().includes(`/meetings/${first.id}`));
  await page.click('[data-testid="brief-follow-up-submit"]');
  const write = await writePromise;
  await page.waitForSelector('[data-testid="brief-follow-up-saved"]');
  c.is("human confirmation creates one action", items().length, 1);
  const saved = items()[0];
  const origin = JSON.parse(saved.source_ref_json);
  c.is("the edited action is persisted", saved.text, chosen);
  c.is("the chosen date is persisted", saved.due, "2027-01-16");
  c.is("the selected owner is persisted", db.prepare("SELECT display_name FROM users WHERE id=?").get(saved.owner_user_id).display_name, "Alex");
  c.is("AI origin survives human acceptance", origin.origin, "ai_generated");
  c.is("the original meeting remains in the evidence", origin.refs.some(r => r.kind === "meeting" && r.id === first.id), true);
  c.is("account evidence remains attached", origin.refs.some(r => r.kind === "deal"), true);
  c.is("no new AI call was needed for the handoff", runCount(), beforeRuns);

  // Replay the real action request with changed fields: the brief identity,
  // not editable wording, prevents a lost-reply retry making a second action.
  const replayBody = write.postData().replace(chosen, "A retry must not create another action").replace("2027-01-16", "2027-01-17");
  c.is("replay fixture really changes the submitted text", replayBody !== write.postData(), true);
  const replay = await page.request.post(write.url(), {
    headers: { "next-action": write.headers()["next-action"], "content-type": write.headers()["content-type"], origin: new URL(BASE).origin },
    data: replayBody,
  });
  c.is("the action replay is handled", replay.status(), 200);
  c.is("changed wording cannot duplicate the same brief action", items().length, 1);
  c.is("replay does not silently change the saved wording", items()[0].text, chosen);
  c.is("replay does not silently change its date", items()[0].due, "2027-01-16");

  // An old saved brief still works without spending money to regenerate it.
  const legacy = await meeting("Legacy saved conversation");
  const old = JSON.parse(stored);
  delete old.conversation;
  db.prepare("UPDATE meetings SET brief_json=? WHERE id=?").run(JSON.stringify(old), legacy.id);
  await page.goto(legacy.url);
  c.is("legacy brief exposes a compact selection", await page.locator('[data-testid="brief-facts-selected"]').count(), 1);
  c.is("legacy brief does not invent a hypothesis", await page.locator('[data-testid="brief-hypothesis"]').count(), 0);
  c.is("legacy brief keeps the full detail disclosure", await page.locator('[data-testid="brief-details"]').count(), 1);
  await page.click('[data-testid="brief-follow-up-open"]');
  const lostText = "Confirm the second meeting review date";
  await page.fill('[data-testid="brief-follow-up-text"]', lostText);
  await page.selectOption('[data-testid="brief-follow-up-owner"]', { label: "Alex" });
  await page.fill('[data-testid="brief-follow-up-due"]', "2027-01-20");
  let writeCount = 0;
  const loseReply = async route => {
    if (route.request().method() !== "POST" || !route.request().headers()["next-action"]) return route.continue();
    writeCount += 1;
    await route.fetch(); // The server commits; only its reply is lost.
    await route.abort("failed");
  };
  await page.route(legacy.url, loseReply);
  await page.click('[data-testid="brief-follow-up-submit"]');
  await page.waitForSelector('[data-testid="brief-follow-up-unknown"]');
  c.is("post-commit lost reply is unknown, not no-write", !/did not reach|nothing was (saved|applied)/i.test(await page.locator('[data-testid="brief-follow-up-unknown"]').innerText()), true);
  c.is("unknown keeps the entered action", await page.inputValue('[data-testid="brief-follow-up-text"]'), lostText);
  c.is("unknown locks another write", await page.locator('[data-testid="brief-follow-up-submit"]').isDisabled(), true);
  c.is("exactly one request was sent", writeCount, 1);
  c.is("the lost reply really followed a commit", items().length, 2);
  await page.unroute(legacy.url, loseReply);

  const recheckPattern = `**/api/meetings/${legacy.id}/brief-follow-up*`;
  const malformed = route => route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  await page.route(recheckPattern, malformed);
  await page.click('[data-testid="brief-follow-up-recheck"]');
  await page.waitForTimeout(400);
  c.is("malformed recheck cannot unlock writing", await page.locator('[data-testid="brief-follow-up-submit"]').isDisabled(), true);
  c.is("failed recheck retains the entered date", await page.inputValue('[data-testid="brief-follow-up-due"]'), "2027-01-20");
  await page.unroute(recheckPattern, malformed);
  const recheckRequest = page.waitForRequest(r => r.url().includes(`/api/meetings/${legacy.id}/brief-follow-up`));
  await page.click('[data-testid="brief-follow-up-recheck"]');
  c.is("reconciliation uses GET only", (await recheckRequest).method(), "GET");
  await page.waitForSelector('[data-testid="brief-follow-up-saved"]');
  c.is("reconciliation shows what was actually saved", (await page.locator('[data-testid="brief-follow-up-saved"]').innerText()).includes(lostText), true);
  c.is("reconciliation creates nothing", items().length, 2);

  const fingerprint = createHash("sha256").update(JSON.stringify(old)).digest("hex").slice(0, 16);
  const endpoint = `${BASE}/api/meetings/${legacy.id}/brief-follow-up?fingerprint=${fingerprint}`;
  const anonymous = await browser.newContext();
  const denied = await anonymous.request.get(endpoint, { maxRedirects: 0 });
  c.is("the read-back endpoint requires authentication", [401, 403, 307, 302].includes(denied.status()), true);
  await anonymous.close();

  // An ordinary successful server action can refresh RSC props while another
  // form is open. A changed brief must not remount that form or replace its
  // evidence/fingerprint behind the person's back.
  const stale = await meeting("Synthetic changed-brief review");
  db.prepare("UPDATE meetings SET brief_json=? WHERE id=?").run(JSON.stringify(old), stale.id);
  await page.goto(stale.url);
  await page.click('[data-testid="brief-follow-up-open"]');
  const originalFingerprint = await page.inputValue('[name="brief_fingerprint"]');
  const retainedText = "Keep this specific review draft while the brief changes.";
  await page.fill('[data-testid="brief-follow-up-text"]', retainedText);
  await page.selectOption('[data-testid="brief-follow-up-owner"]', { label: "Alex" });
  await page.fill('[data-testid="brief-follow-up-due"]', "2027-01-20");
  const changed = structuredClone(old);
  changed.proposed_next_step.action = "A different next step from a newer saved brief.";
  db.prepare("UPDATE meetings SET brief_json=? WHERE id=?").run(JSON.stringify(changed), stale.id);
  await page.fill('textarea[name="raw_notes"]', "Synthetic notes: saving this intentionally refreshes the meeting's server props.");
  await page.getByRole("button", { name: "Save only", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="brief-next-step"]')?.textContent.includes("A different next step from a newer saved brief."));
  c.is("RSC refresh preserves an open handoff's input", await page.inputValue('[data-testid="brief-follow-up-text"]'), retainedText);
  c.is("RSC refresh preserves its original brief identity", await page.inputValue('[name="brief_fingerprint"]'), originalFingerprint);
  await page.click('[data-testid="brief-follow-up-submit"]');
  await page.waitForSelector('[data-testid="brief-follow-up"] [role="alert"]');
  c.is("a changed brief is refused rather than silently adopted", /brief.*changed|changed.*brief/i.test(await page.locator('[data-testid="brief-follow-up"] [role="alert"]').innerText()), true);
  c.is("refusal keeps the review draft", await page.inputValue('[data-testid="brief-follow-up-text"]'), retainedText);
  // A citation used only by the proposed next step must still be clickable.
  const nextOnly = await meeting("Synthetic next-step-only evidence");
  const note = db.prepare("SELECT id,meta_json FROM documents WHERE account_id=? AND kind='research_note' AND status='accepted' ORDER BY created_at DESC LIMIT 1").get(accountId);
  const noteMeta = JSON.parse(note.meta_json);
  const findingIndex = noteMeta.accepted_finding_indexes?.[0] ?? 0;
  const sparse = structuredClone(old);
  for (const key of ["situation", "deals_in_play", "attendees", "changes_since_last", "questions", "risks"]) sparse[key] = [];
  sparse.proposed_next_step.evidence_ids = [`${note.id}#${findingIndex}`];
  db.prepare("UPDATE meetings SET brief_json=? WHERE id=?").run(JSON.stringify(sparse), nextOnly.id);
  await page.goto(nextOnly.url);
  const nextLink = page.locator('[data-testid="brief-next-step"] [data-testid="brief-ref"]');
  c.is("next-step-only evidence has a direct link", await nextLink.count(), 1);
  const href = await nextLink.getAttribute("href");
  c.is("the link addresses the exact finding", href.includes(`finding-${note.id}-${findingIndex}`), true);
  await page.locator('[data-testid="brief-details"] summary').click();
  c.is("source inventory does not falsely say no record", (await page.locator('[data-testid="brief-sources"]').innerText()).includes("This brief cites no record"), false);
  await nextLink.click();
  await page.waitForURL(/\/research\?/);
  c.is("next-step citation reaches its actual finding", await page.evaluate(() => !!document.getElementById(decodeURIComponent(location.hash.slice(1)))), true);
  c.is("fake-only browser flow never created extra actions", items().length, 2);
} finally {
  db.close();
  await browser.close();
}
process.exit(c.done() ? 0 : 1);
