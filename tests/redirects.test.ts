// Old addresses land where their work now is (DECISIONS #105).
import { expect, it } from "vitest";
import config from "../next.config";

it("sends each folded page to its new place", async () => {
  const rules = await config.redirects!();
  const to = (source: string) => rules.find((r) => r.source === source)?.destination;
  expect(to("/plans")).toBe("/inbox?kind=plan");
  expect(to("/promises")).toBe("/inbox?kind=promise");
  expect(to("/close")).toBe("/?view=close");
  expect(to("/accounts/:id/review")).toBe("/inbox?kind=changes&account=:id");
  expect(rules.every((r) => r.permanent === false)).toBe(true);
});
