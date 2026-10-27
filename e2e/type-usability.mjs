// Focused, synthetic-only typography/modal regression. No saves or generation.
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import { BASE, checker, launch, signIn, openTab } from "./browser.mjs";
if (!process.env.E2E_DB_PATH?.includes("strategy-e2e-")) throw Error("Disposable e2e DB required");
const browser = await launch();
const c = checker("type, mobile header and modal usability");
const db = new Database(process.env.E2E_DB_PATH);
try {
  const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);
  page.setDefaultTimeout(15000);
  const f = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "e2e/layout-seed.mts"], { encoding: "utf8", env: { ...process.env, DB_PATH: process.env.E2E_DB_PATH } }));
  const counts = () => JSON.stringify({ runs: db.prepare("SELECT COUNT(*) n FROM ai_runs").get().n, pending: db.prepare("SELECT COUNT(*) n FROM proposals WHERE status='pending'").get().n });
  const before = counts();
  let mutations = 0;
  // The "you looked" markers on Today and an account are preferences, not records (DECISIONS #99, #100).
  page.on("request", r => { if (!["GET", "HEAD"].includes(r.method()) && !/\/api\/(me\/seen-today|accounts\/[^/]+\/seen)$/.test(new URL(r.url()).pathname)) mutations++; });
  const trigger = page.getByRole("button", { name: "Search accounts, deals and people", exact: true });
  // The dialog is hidden the moment it closes; focus goes back to the invoker
  // from React's close handler, which runs a tick later. Sampling the active
  // element the instant the dialog is hidden failed once on a slow runner at
  // 320px with nothing in the diff near it, so the question is "does focus
  // land there", bounded, not "is it there right now".
  const focusLands = (locator) => locator.evaluate(el => el === document.activeElement).then(async (now) => {
    if (now) return true;
    try { await page.waitForFunction(el => el === document.activeElement, await locator.elementHandle(), { timeout: 2000 }); return true; } catch { return false; }
  });
  const dialog = page.getByRole("dialog", { name: "Jump to", exact: true });
  const input = dialog.getByRole("combobox", { name: "Jump to", exact: true });
  const focusedInside = () => dialog.evaluate(el => el.contains(document.activeElement));

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${BASE}/accounts/${f.emptyId}`);
    const header = page.locator("header").first();
    const height = (await header.boundingBox()).height;
    c.is(`header smaller than before at ${width} (${height}px)`, height < (width === 390 ? 123 : 155), true);
    c.is(`header does not stick at ${width}`, await header.evaluate(el => getComputedStyle(el).position !== "sticky"), true);
    const nav = page.getByRole("navigation", { name: "Main", exact: true });
    c.is(`all five main links at ${width}`, await nav.getByRole("link").count(), 5);
    for (const link of await nav.getByRole("link").all()) {
      c.is(`nav link reachable at ${width}: ${(await link.innerText()).trim()}`, await link.evaluate(el => {
        const r = el.getBoundingClientRect(); return r.width >= 44 && r.height >= 44 && r.left >= 0 && r.right <= innerWidth && parseFloat(getComputedStyle(el).fontSize) >= 11;
      }), true);
    }
    // A tab bar along the bottom of a phone, out of the way of the page.
    const bar = await nav.boundingBox();
    c.is(`navigation is a bottom tab bar at ${width}`, Math.abs(bar.y + bar.height - 844) <= 1 && await nav.evaluate(el => getComputedStyle(el).position === "fixed"), true);
    await openTab(page, "meetings");
    await page.getByTestId("meeting-new-open").click();
    const fields = page.getByTestId("meeting-new").locator('input:not([type="hidden"]),select,textarea');
    c.is(`visible editable controls are 16px at ${width}`, await fields.evaluateAll(els => els.filter(el => el.getClientRects().length).every(el => parseFloat(getComputedStyle(el).fontSize) >= 16)), true);
    await page.getByTestId("meeting-new").getByRole("button", { name: "Cancel", exact: true }).click();
    c.is(`no page overflow at ${width}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);

    await trigger.click();
    await input.waitFor({ state: "visible" });
    c.is(`native viewport modal at ${width}`, await dialog.evaluate(el => el.matches(":modal") && getComputedStyle(el, "::backdrop").position === "fixed"), true);
    c.is(`input is focused visibly at ${width}`, await input.evaluate(el => document.activeElement === el && parseFloat(getComputedStyle(el).outlineWidth) >= 2), true);
    // Native modal inertness: even programmatic focus cannot reach background.
    await nav.getByRole("link").first().evaluate(el => el.focus());
    c.is(`background inert at ${width}`, await focusedInside(), true);
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press(i < 4 ? "Tab" : "Shift+Tab");
      c.is(`focus contained ${width}/${i}`, await focusedInside(), true);
    }
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    c.is(`Escape restores trigger at ${width}`, await focusLands(trigger), true);
    const keyboardInvoker = nav.getByRole("link", { name: "Today", exact: true });
    await keyboardInvoker.focus();
    // The shortcut remembers what had focus when it was pressed: make sure
    // that is the link, not wherever the last restore was still settling.
    await focusLands(keyboardInvoker);
    await page.keyboard.press("Control+k");
    await input.waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    c.is(`shortcut restores original focus at ${width}`, await focusLands(keyboardInvoker), true);
    await trigger.click();
    await input.waitFor({ state: "visible" });
    // This coordinate is outside the panel but well below the old 122px header-bound overlay.
    await page.mouse.click(width - 2, 800);
    await dialog.waitFor({ state: "hidden" });
    c.is(`viewport backdrop closes and restores at ${width}`, await trigger.evaluate(el => el === document.activeElement), true);

    // Native close is queued after close() already restored focus. Hold that
    // event until the next interaction to exercise both event orders without
    // timing sleeps or weakening the original focus assertions.
    for (const reopen of [false, true]) {
      await trigger.click();
      await input.waitFor({ state: "visible" });
      await dialog.evaluate(el => {
        window.__paletteCloseHeld = false;
        el.addEventListener("close", event => {
          event.stopImmediatePropagation();
          window.__paletteCloseHeld = true;
        }, { capture: true, once: true });
      });
      await dialog.getByRole("button", { name: "Close jump to", exact: true }).click();
      await page.waitForFunction(() => window.__paletteCloseHeld === true);
      await keyboardInvoker.focus();
      if (reopen) {
        await page.keyboard.press("Control+k");
        await input.waitFor({ state: "visible" });
      }
      await page.getByRole("dialog", { name: "Jump to", exact: true, includeHidden: true }).evaluate(el => el.dispatchEvent(new Event("close")));
      if (reopen) {
        c.is(`late close preserves reopened focus at ${width}`, await input.evaluate(el => el === document.activeElement), true);
        c.is(`late close preserves reopened state at ${width}`, await trigger.getAttribute("aria-expanded"), "true");
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        c.is(`reopened palette restores new invoker at ${width}`, await focusLands(keyboardInvoker), true);
      } else {
        c.is(`late close cannot steal next invoker at ${width}`, await keyboardInvoker.evaluate(el => el === document.activeElement), true);
      }
    }
  }

  await page.setViewportSize({ width: 390, height: 240 });
  await trigger.click();
  await input.waitFor({ state: "visible" });
  await input.focus();
  const options = dialog.getByRole("option");
  const count = await options.count();
  for (let i = 1; i < count; i++) await page.keyboard.press("ArrowDown");
  await page.waitForFunction(() => {
    const list = document.getElementById("palette-results");
    return list.scrollTop > 0;
  });
  c.is("arrow selection stays visible in a short viewport", await options.last().evaluate(el => {
    const r = el.getBoundingClientRect(), p = el.parentElement.getBoundingClientRect();
    return r.top >= p.top - 1 && r.bottom <= p.bottom + 1 && el.getAttribute("aria-selected") === "true";
  }), true);
  // The last option is the last page in the registry (lib/nav/destinations.ts),
  // whichever that is: Enter goes to it.
  const from = new URL(page.url()).pathname;
  await page.keyboard.press("Enter");
  await page.waitForURL((u) => u.pathname !== from);
  c.is("page route retained", /^\/[a-z/-]+$/.test(new URL(page.url()).pathname), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await input.fill("Synthetic Layout Lab");
  await input.press("Enter");
  await page.waitForURL(`${BASE}/accounts/${f.accountId}`);
  c.is("account route retained", new URL(page.url()).pathname, `/accounts/${f.accountId}`);
  await trigger.click();
  await input.fill("Synthetic unmatched & exact");
  await input.press("Enter");
  await page.waitForURL(url => url.pathname === "/search" && url.searchParams.get("q") === "Synthetic unmatched & exact");
  c.is("search fallback retains encoded query", new URL(page.url()).searchParams.get("q"), "Synthetic unmatched & exact");

  await page.goto(`${BASE}/accounts/${f.accountId}/meetings/${f.meetingId}`);
  const editor = page.locator('textarea[name="raw_notes"]');
  const original = await editor.inputValue();
  await editor.fill(`${original}\nUnsaved synthetic usability draft.`);
  await editor.evaluate(el => { window.__typeNotes = el; });
  c.is("long-form notes are comfortable", await editor.evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 16 && parseFloat(getComputedStyle(el).lineHeight) >= 24), true);
  await page.locator('[data-testid="meeting-nav"] a[href="#brief"]').click();
  await page.locator('[data-testid="meeting-nav"] a[href="#notes"]').click();
  c.is("hash navigation retains mounted dirty notes", await editor.evaluate(el => el === window.__typeNotes && el.value.endsWith("Unsaved synthetic usability draft.")), true);
  await page.waitForFunction(() => document.querySelector('#notes').getBoundingClientRect().top >= 0 && document.querySelector('#notes').getBoundingClientRect().top < 100);
  c.is("phone hash target is not hidden under header", await page.locator('#notes').evaluate(el => el.getBoundingClientRect().top >= 0), true);
  await page.setViewportSize({ width: 1440, height: 950 });
  c.is("desktop header remains sticky", await page.locator("header").first().evaluate(el => getComputedStyle(el).position), "sticky");
  c.is("navigation generated or accepted nothing", counts(), before);
  c.is("no browser mutations", mutations, 0);
} finally {
  db.close();
  await browser.close();
}
process.exit(c.done() ? 0 : 1);
