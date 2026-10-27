import { expect, it } from "vitest";
import { placeName, previous, step } from "@/lib/nav/trail";

it("keeps a stack of where you have been, popping on a return", () => {
  let t: string[] = [];
  t = step(t, "/pipeline?quarter=FY27+Q2");
  t = step(t, "/accounts/a/deals/d1");
  expect(previous(t, "/accounts/a/deals/d1")).toBe("/pipeline?quarter=FY27+Q2");
  t = step(t, "/pipeline?quarter=FY27+Q2");
  expect(t).toEqual(["/pipeline?quarter=FY27+Q2"]);
  expect(step(t, "/pipeline?quarter=FY27+Q2")).toBe(t);
  expect(step(Array.from({ length: 40 }, (_, i) => `/p${i}`), "/x")).toHaveLength(30);
});

it("names where Back goes", () => {
  expect(placeName("/")).toBe("Today");
  expect(placeName("/pipeline?quarter=FY27+Q2")).toBe("Pipeline");
  expect(placeName("/accounts/a/deals")).toBe("Deals");
  expect(placeName("/accounts/a/deals/d1")).toBe("the deal");
  expect(placeName("/accounts/a/plays")).toBe("Plan");
  expect(placeName("/accounts/a")).toBe("the account");
  expect(placeName("/follow-ups?who=all")).toBe("Follow-ups");
  expect(placeName("/accounts/a/playbook/workshop")).toBe("the workshop");
});
