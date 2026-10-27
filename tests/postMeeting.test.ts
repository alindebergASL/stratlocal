import { describe, it, expect } from "vitest";
import { followThrough, followUpGaps, type FollowThroughInput } from "../lib/meetings/followThrough";
const base: FollowThroughInput = { dirty: false, saving: false, busy: false, conflict: false, error: null, runError: null, failed: false, hasNotes: true, tooShort: false, pending: 0, gaps: 0 };
describe("post-meeting presentation", () => {
  it("never equates zero pending with extraction or completion", () => {
    expect(followThrough(base).text).toBe("Notes saved. Review or extract when ready.");
    expect(followThrough(base).detail).toBe("Saving notes does not extract changes.");
    expect(followThrough(base).label).toBe("Review extraction controls");
    expect(followThrough({ ...base, hasNotes: false }).text).toBe("No notes saved yet.");
  });
  it.each([
    [{ dirty: true }, "Unsaved notes"],
    [{ saving: true }, "Saving notes"],
    [{ busy: true }, "Extraction is running"],
    [{ failed: true }, "Extraction needs attention"],
    [{ runError: "network" }, "Extraction needs attention"],
    [{ error: "disk" }, "Notes not saved"],
    [{ conflict: true }, "Notes not saved"],
  ])("live state outranks saved and pending: %j", (state, text) => {
    expect(followThrough({ ...base, pending: 3, ...state }).text).toContain(text);
  });
  it("routes one suggestion to existing controls", () => {
    expect(followThrough({ ...base, pending: 2, gaps: 1 }).href).toBe("#review");
    expect(followThrough({ ...base, gaps: 1 }).href).toBe("#follow-ups");
    expect(followThrough({ ...base, disabledReason: "No provider" }).label).toBe("Check extraction availability");
    expect(followThrough({ ...base, readOnlyReason: "Archived", dirty: true }).label).toBe("View recorded follow-ups");
  });
  it("counts open nonarchived rows, external owners, and one item with two gaps", () => {
    const item = { status: "open", owner: null, due: null };
    expect(followUpGaps([item])).toEqual({ open: 1, items: 1, owners: 1, dates: 1 });
    expect(followUpGaps([item, { ...item, status: "done" }, { ...item, archived_at: "2026-01-01" }, { ...item, owner: "External customer", due: "2026-10-01" }, { ...item, owner_user_id: "alex", due: "2026-10-01" }])).toEqual({ open: 3, items: 1, owners: 1, dates: 1 });
  });
});
