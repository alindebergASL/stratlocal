// SYNTHETIC ONLY: real in-memory SQLite, real auth/session and server actions.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { saveNotes } from "@/app/actions";
import FollowUpsPage from "@/app/follow-ups/page";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { applyEntityChange } from "@/lib/proposals/apply";
import { getMeeting } from "@/lib/queries/meetings";
import * as meetings from "@/lib/queries/meetings";
import { seedAccount, USER, type Seed } from "./helpers";

const auth = vi.hoisted(() => ({ token: "" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => auth.token ? { value: auth.token } : undefined }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect ${url}`); }, usePathname: () => "/follow-ups", useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let seed: Seed;
let clock: number;
beforeEach(() => {
  clock = 1_789_500_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  for (const [id, name] of [[USER, "Alex"], ["user-2", "Jamie"]]) {
    db().prepare("INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, `${id}@example.test`, "unused", name, clock, clock);
  }
  auth.token = createSession(USER).id;
  seed = seedAccount();
});
afterEach(() => vi.restoreAllMocks());
function edit(text: string | null) {
  clock += 1000;
  return applyEntityChange({ accountId: seed.accountId, entityType: "meeting", entityId: seed.meetingId, op: "update", payload: { raw_notes: text }, actorUserId: "user-2" });
}
function fd(text: string, version: number, keep?: string) {
  const f = new FormData(); f.set("raw_notes", text); f.set("base_version", String(version)); if (keep) f.set("keep", keep); return f;
}
function logCount() { return db().prepare("SELECT COUNT(*) n FROM change_log").get() as { n: number }; }

it("returns full notes and the matching version without writing, not the history size marker", async () => {
  const before = getMeeting(seed.meetingId)!.updated_at;
  const text = "Partner notes\n\n" + "Full readable line. ".repeat(120) + "\nFinal detail.";
  edit(text); const count = logCount();
  const result = await saveNotes(seed.accountId, seed.meetingId, fd("My draft", before));
  expect(result.ok).toBe(false);
  if (result.ok) throw Error("Expected conflict");
  expect(result.conflict?.notes).toEqual({ text, version: getMeeting(seed.meetingId)!.updated_at });
  expect(result.conflict?.notes?.version).toBe(result.conflict?.currentVersion);
  expect(logCount()).toEqual(count);
  expect(getMeeting(seed.meetingId)!.raw_notes).toBe(text);
  const history = db().prepare("SELECT new_value FROM change_log WHERE entity_id = ? AND field = 'raw_notes'").all(seed.meetingId);
  expect(JSON.stringify(history)).not.toContain("Full readable line");
});
it("represents cleared notes as an explicit empty snapshot", async () => {
  edit("Previous partner notes"); const before = getMeeting(seed.meetingId)!.updated_at;
  edit(null);
  const result = await saveNotes(seed.accountId, seed.meetingId, fd("My draft", before));
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.conflict?.notes?.text).toBe("");
});
it("still refuses a later partner edit after the snapshot was adopted", async () => {
  const before = getMeeting(seed.meetingId)!.updated_at; edit("First partner notes");
  const first = await saveNotes(seed.accountId, seed.meetingId, fd("My draft", before));
  if (first.ok || !first.conflict?.notes) throw Error("Expected snapshot");
  const adopted = first.conflict.notes.version;
  edit("Newer partner notes"); const count = logCount();
  const next = await saveNotes(seed.accountId, seed.meetingId, fd("New local draft", adopted));
  expect(next.ok).toBe(false);
  if (!next.ok) expect(next.conflict?.notes?.text).toBe("Newer partner notes");
  expect(logCount()).toEqual(count);
});
it("withholds adoption when another write lands before the snapshot read", async () => {
  const base = getMeeting(seed.meetingId)!.updated_at;
  edit("First saved partner version");
  const original = meetings.getMeeting;
  let reads = 0;
  vi.spyOn(meetings, "getMeeting").mockImplementation((id) => {
    if (++reads === 2) edit("Newer partner write during snapshot read");
    return original(id);
  });
  const result = await saveNotes(seed.accountId, seed.meetingId, fd("My conflicting draft", base));
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected conflict");
  expect(result.conflict).toBeDefined();
  expect(result.conflict?.notes).toBeUndefined();
  expect(original(seed.meetingId)!.raw_notes).toBe("Newer partner write during snapshot read");
});
it("rejects an unauthenticated notes request before disclosing or writing", async () => {
  edit("Partner notes"); const count = logCount(); auth.token = "";
  await expect(saveNotes(seed.accountId, seed.meetingId, fd("My draft", 0))).rejects.toThrow("redirect /login");
  expect(logCount()).toEqual(count);
});
it("refuses missing and mismatched meetings, including Keep both no-ops", async () => {
  for (const [accountId, meetingId] of [[seed.accountId, "missing"], ["wrong-account", seed.meetingId]] as const) {
    for (const keep of [undefined, "both"]) {
      const count = logCount(); const result = await saveNotes(accountId, meetingId, fd("", 0, keep));
      expect(result.ok).toBe(false); expect(result).not.toHaveProperty("conflict.notes"); expect(logCount()).toEqual(count);
    }
  }
});
it("scopes empty summaries and normalizes a self-id link to Mine", async () => {
  for (const who of [undefined, USER, "user-2", "unowned"]) {
    const html = renderToStaticMarkup(await FollowUpsPage({ searchParams: Promise.resolve({ who }) }));
    expect(html).toContain(who === "user-2" ? "Nothing assigned to Jamie." : who === "unowned" ? "No unassigned follow-ups." : "Nothing assigned to you.");
    expect(html).not.toContain("Nothing open. Write the first one down.");
    if (who === USER) expect([...parseHTML(html).document.querySelectorAll('a[href="/follow-ups"][aria-current="page"]')].some((a) => a.textContent === "Mine")).toBe(true);
  }
});
