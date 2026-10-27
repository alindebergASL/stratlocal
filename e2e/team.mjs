// A team of more than two: the app named for it, a third person added who
// can sign in and is not an admin, then turned off and signed out; and the
// neutral starter pack downloaded and loaded after its preview. Synthetic
// people and names only.
import { readFile } from "node:fs/promises";
import { BASE, checker, launch, signIn } from "./browser.mjs";

const c = checker("team");
const browser = await launch();
const page = await signIn(browser, process.env.E2E_USER1_EMAIL, process.env.E2E_USER1_PASSWORD);
const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

try {
  await page.goto(`${BASE}/settings/team`);
  await page.getByTestId("team-brand-open").click();
  await page.fill('[data-testid="team-brand"] [name="app_name"]', "Synthetic Desk");
  await page.fill('[data-testid="team-brand"] [name="team_name"]', "Synthetic West Team");
  await page.getByTestId("team-brand-submit").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="brand-name"]')?.textContent === "Synthetic Desk", null, { timeout: 15000 });
  c.is("the header carries the team's name for the app", (await page.getByTestId("brand-name").first().innerText()).trim(), "Synthetic Desk");
  c.is("and so does the browser tab", await page.title(), "Synthetic Desk");

  await page.getByTestId("team-add-open").click();
  await page.fill('[data-testid="team-add"] [name="email"]', "third@e2e.local");
  await page.fill('[data-testid="team-add"] [name="name"]', "Synthetic Third");
  await page.fill('[data-testid="team-add"] [name="password"]', "synthetic-third-pass-1");
  await page.getByTestId("team-add-submit").click();
  await page.locator('[data-testid="team-member"]', { hasText: "Synthetic Third" }).waitFor({ timeout: 15000 });
  c.is("three people on the team", await page.locator('[data-testid="team-member"][data-active="true"]').count(), 3);

  const third = await signIn(browser, "third@e2e.local", "synthetic-third-pass-1");
  await third.goto(`${BASE}/settings/team`);
  c.is("the new person can sign in, and is not an admin", await third.getByTestId("team-add-open").count(), 0);

  // With three of us, Cover while away asks who covers.
  await page.goto(`${BASE}/handoff?from=2026-11-02&to=2026-11-04`);
  c.is("with three people, Cover while away offers a choice of who covers", await page.getByTestId("cover-by").getByRole("link").count(), 2);
  await page.getByTestId("cover-by").getByRole("link", { name: "Synthetic Third" }).click();
  await page.waitForURL(/by=/, { timeout: 15000 });
  c.is("and the choice sticks", await page.getByTestId("cover-by").getByRole("link", { name: "Synthetic Third" }).getAttribute("aria-current"), "page");
  await page.goto(`${BASE}/settings/team`);

  await page.getByTestId("team-active-third@e2e.local").click();
  await page.locator('[data-testid="team-member"][data-active="false"]', { hasText: "Synthetic Third" }).waitFor({ timeout: 15000 });
  await third.goto(`${BASE}/`);
  c.is("turned off, they are signed out", /\/login/.test(third.url()), true);

  // The neutral starter pack: downloaded, previewed, loaded.
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.getByTestId("pack-starter").click()]);
  const file = await dl.path();
  c.is("the starter pack is a team pack", JSON.parse(await readFile(file, "utf8")).kind, "team_pack");
  await page.getByTestId("pack-file").setInputFiles(file);
  await page.getByTestId("pack-preview").waitFor({ timeout: 15000 });
  c.is("its preview says what it would change", (await page.getByTestId("pack-preview").innerText()).includes('Playbook "AI outcome starter"'), true);
  await page.getByTestId("pack-apply").click();
  await page.getByRole("status").filter({ hasText: "Loaded: playbook" }).waitFor({ timeout: 15000 });
  await page.goto(`${BASE}/settings/playbook`);
  c.is("loaded, it is the playbook", (await page.locator('[data-testid="playbook-view"] h2').innerText()).trim(), "AI outcome starter");

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}/settings/team`);
    c.is(`the Team page fits ${width}px`, await fits(), true);
  }
} finally {
  await browser.close();
}
process.exit(c.done() ? 0 : 1);
