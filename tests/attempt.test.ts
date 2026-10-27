// What a form says when the connection drops.
//
// `attempt` wraps every ordinary save. A rejected fetch used to come back as
// "Nothing here has been lost; try again" — which is true of the input and
// false of the save: the request can commit and the reply be the part that
// was lost. On a create form that sentence makes a second copy; on an edit
// it conflicts the person with their own save and calls them "the other
// person". The review and brief-follow-up forms got a real unknown state in
// the month; this pins that the plain forms at least stopped claiming to
// know.
import { describe, expect, it } from "vitest";
import { attempt } from "@/components/attempt";

describe("a dropped connection is not a no-write", () => {
  it("keeps the input and says the outcome is unknown, never that nothing was saved", async () => {
    for (const reason of ["Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed"]) {
      const r = await attempt(async () => { throw new TypeError(reason); });
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.error).toMatch(/still here/);
      expect(r.error).toMatch(/not known/);
      expect(r.error).not.toMatch(/nothing (here )?has been lost|nothing was saved|try again\.$/i);
    }
  });

  it("passes an application error through as itself, and a void reply as success", async () => {
    const refused = await attempt(async () => { throw new Error("The follow-up needs something to do."); });
    expect(refused).toEqual({ ok: false, error: "The follow-up needs something to do." });
    expect(await attempt(async () => undefined)).toEqual({ ok: true });
  });
});
