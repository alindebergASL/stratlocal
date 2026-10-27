// Synthetic accounts, findings and roles only.
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { seedAccount, USER } from "./helpers";
import { acceptNote, storeDraftNote } from "@/lib/research/notes";
import { saveDirection } from "@/lib/teamDirection";
import type { ResearchFinding } from "@/lib/research/schema";

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, name: "Synthetic User", email: "synthetic@example.test" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const finding = (i: number, topic: ResearchFinding["topic"]): ResearchFinding => ({ text: `Synthetic statement ${i}.`, quote: `Synthetic quote number ${i}.`, url: `https://example.test/page/${i}`, date: "2026-09-01", confidence: "medium", topic });

it("leads the one page with why now and where we fit, under the confirmed entity, and asks who decides first", async () => {
  saveDirection({ focusAreas: ["Synthetic agents"], userId: USER, basisId: null });
  const { accountId } = seedAccount({ name: "Synthetic One Page Co" });
  const doc = storeDraftNote({
    accountId, userId: USER, aiRunId: "synthetic", focus: null, depth: "standard", searches: 0, fetches: 0, dropped: [], prose: "P",
    note: {
      title: "T", summary: "S", open_questions: [],
      findings: [finding(0, "strategy"), finding(1, "technology"), finding(2, "leadership"), finding(3, "risk")],
      reads: { "0": { signal: "compelling_event", owner: "the CIO", fits: [], so_what: null }, "1": { signal: null, owner: null, fits: ["Synthetic agents"], so_what: "It is where agents land." } },
      entity: { name: "Synthetic One Page Co", domain: "onepage.example", ticker: null, parent: null, hq: null, url: null },
      buying_group: [{ role: "Synthetic CIO", likely: "signer", basis: "Likely owns it.", question: "Who signs the platform decision?" }],
    },
  });
  acceptNote(doc.id, [0, 1, 2, 3], USER);
  const { default: Summary } = await import("@/app/accounts/[id]/summary/page");
  const html = renderToStaticMarkup(await Summary({ params: Promise.resolve({ id: accountId }) }));
  const { document } = parseHTML(html);
  const facts = document.querySelector('[data-testid="one-page-facts"]')!;
  expect(facts.querySelector("h2")?.textContent).toBe("Why now, and where we fit");
  expect([...facts.querySelectorAll("li")].map((li) => li.getAttribute("data-lead"))).toEqual(["why", "fit", "topic"]);
  expect(facts.textContent).toContain("1. Compelling event: Synthetic statement 0.");
  expect(facts.textContent).toContain("So what: It is where agents land.");
  expect(document.querySelector('[data-testid="one-page-entity"]')?.textContent).toBe("Researched as Synthetic One Page Co · onepage.example");
  expect(document.querySelector("ol.list-decimal li")?.textContent).toBe("Who signs the platform decision?");
  expect(html).toContain("3 of 4 retained findings shown; 1 in the research appendix.");
  // The written version starts from here, not from a second entry on Ask.
  expect(document.querySelector('[data-testid="one-page-write"] a')?.getAttribute("href")).toBe(`/accounts/${accountId}/ask?template=account_one_pager`);
});
