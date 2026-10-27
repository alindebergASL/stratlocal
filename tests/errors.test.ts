import { describe, expect, it } from "vitest";
import { z } from "zod";
import { describeError } from "@/lib/errors";
import { ApplyError } from "@/lib/proposals/apply";
import { BudgetError } from "@/lib/ai/guard";

// The rule this file enforces: nothing reaches a person as "Something went
// wrong". Every branch either names the field, names the constraint, or passes
// the real message through.
function zodError(schema: z.ZodType, value: unknown): z.ZodError {
  const r = schema.safeParse(value);
  if (r.success) throw new Error("expected a parse failure");
  return r.error;
}

describe("describeError", () => {
  it("keeps the sentence an ApplyError already wrote", () => {
    expect(describeError(new ApplyError("deal D-1 belongs to another account", "validation"))).toBe(
      "deal D-1 belongs to another account",
    );
  });

  it("keeps a BudgetError's message, which is the best copy in the app", () => {
    expect(describeError(new BudgetError("Daily AI cap reached ($15.00)."))).toContain("$15.00");
  });

  it("names the field a zod error is about", () => {
    const schema = z.object({ role: z.enum(["ae", "se"]) });
    const text = describeError(zodError(schema, { role: "CIO" }));
    expect(text).toContain("role");
    expect(text).not.toBe("Something went wrong");
  });

  it("names a nested field by its path", () => {
    const schema = z.object({ attendees: z.array(z.object({ name: z.string() })) });
    expect(describeError(zodError(schema, { attendees: [{ name: "a" }, { name: 7 }] }))).toContain("attendees[1].name");
  });

  it("lists several problems and says how many it left out", () => {
    const schema = z.object({ a: z.string(), b: z.string(), c: z.string(), d: z.string(), e: z.string(), f: z.string() });
    const text = describeError(zodError(schema, {}));
    expect(text).toContain(";");
    expect(text).toContain("and 2 more");
  });

  it("explains the SQLite errors two people sharing a database can actually hit", () => {
    const busy = Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
    expect(describeError(busy)).toContain("saving at the same moment");

    const dupe = Object.assign(new Error("UNIQUE constraint failed: deals.deal_id"), {
      code: "SQLITE_CONSTRAINT_UNIQUE",
    });
    expect(describeError(dupe)).toContain("deals.deal_id");

    const full = Object.assign(new Error("database or disk is full"), { code: "SQLITE_FULL" });
    expect(describeError(full)).toContain("disk space");
  });

  it("passes an unknown error's real message through rather than hiding it", () => {
    expect(describeError(new Error("ECONNRESET reading from bedrock"))).toBe("ECONNRESET reading from bedrock");
    expect(describeError("plain string")).toBe("plain string");
  });

  it("still says something when there is nothing to say", () => {
    expect(describeError(undefined)).toMatch(/did not say what/);
    expect(describeError(new Error(""))).toBe("Error");
  });
});
