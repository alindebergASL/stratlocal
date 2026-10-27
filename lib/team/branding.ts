// How the team's own app looks to it: its name, the team's name, an accent
// colour and a logo, used in the header, the browser tab and on decks. The
// app's own interface colours are not changed, so contrast and dark mode
// stay as designed. Nothing here names anyone by default.
import { z } from "zod";
import { db } from "../db";
import { DEFAULT_DECK_STYLE, type DeckStyle } from "../ask/deck";

export const MAX_LOGO_BYTES = 150 * 1024;

export const Branding = z
  .object({
    appName: z.string().trim().min(1).max(40).default("Strategy"),
    teamName: z.string().trim().max(80).nullable().default(null),
    accent: z
      .string()
      .trim()
      .regex(/^#?[0-9a-fA-F]{6}$/, "a colour as six hex digits, such as 0F5F6E")
      .transform((v) => v.replace(/^#/, "").toUpperCase())
      .default(DEFAULT_DECK_STYLE.accent),
    /** A small PNG, JPEG or SVG as a data URL. */
    logo: z
      .string()
      .regex(/^data:image\/(png|jpeg|svg\+xml);base64,[A-Za-z0-9+/=]+$/, "a PNG, JPEG or SVG image")
      .max(Math.ceil((MAX_LOGO_BYTES * 4) / 3) + 40)
      .nullable()
      .default(null),
  })
  .strict();
export type Branding = z.infer<typeof Branding>;

const KEY = "team_branding";

export function branding(): Branding {
  const row = db().prepare(`SELECT value FROM settings WHERE key = ?`).get(KEY) as { value: string } | undefined;
  const parsed = row ? Branding.safeParse(JSON.parse(row.value)) : null;
  return parsed?.success ? parsed.data : Branding.parse({});
}

export function saveBranding(input: unknown, userId: string): Branding {
  const b = Branding.parse(input);
  db()
    .prepare(`INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .run(KEY, JSON.stringify(b), userId, Date.now());
  return b;
}

export function deckStyle(): DeckStyle {
  const b = branding();
  return { ...DEFAULT_DECK_STYLE, accent: b.accent, footer: b.teamName };
}
