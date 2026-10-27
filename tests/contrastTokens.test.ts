// The palette, checked as arithmetic rather than as an opinion.
//
// `--color-ink-faint` was #9aa0b4 on a #f0f0f7 ground: 2.30:1, for text that
// carries source dates, evidence labels and the "before" side of a diff. A
// colour token is the one kind of readability bug that cannot be seen in a
// unit test of behaviour, so it is measured here, at the token, where a single
// edit puts it back.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

function token(name: string): string {
  const m = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6});`));
  if (!m) throw new Error(`no --color-${name} in app/globals.css`);
  return m[1]!.toLowerCase();
}

function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const GROUNDS = ["paper", "surface", "surface-sunk"];

describe("theme tokens", () => {
  for (const ground of GROUNDS) {
    it(`interactive border is identifiable on ${ground}`, () => {
      expect(ratio(token("control-line"), token(ground))).toBeGreaterThanOrEqual(3);
      expect(token("control-line")).not.toBe(token("line"));
    });
  }
  // Normal-size text: 4.5:1. Every ink is used at body or label size
  // somewhere, `ink-faint` included, so none of them gets the large-text
  // allowance.
  for (const ink of ["ink-strong", "ink", "ink-muted", "ink-faint", "accent", "positive", "warning", "danger"]) {
    for (const ground of GROUNDS) {
      it(`${ink} reads on ${ground}`, () => {
        expect(ratio(token(ink), token(ground))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  // The soft grounds are what the callouts print their own colour on.
  for (const pair of [
    ["accent", "accent-soft"],
    ["positive", "positive-soft"],
    ["warning", "warning-soft"],
    ["danger", "danger-soft"],
  ]) {
    it(`${pair[0]} reads on its own soft ground`, () => {
      expect(ratio(token(pair[0]!), token(pair[1]!))).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("white on a filled positive or danger button reads", () => {
    expect(ratio("#ffffff", token("positive"))).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#ffffff", token("danger"))).toBeGreaterThanOrEqual(4.5);
  });

  it("inverted ink reads on the ink it is printed on", () => {
    expect(ratio(token("ink-invert"), token("ink"))).toBeGreaterThanOrEqual(4.5);
  });

  // The surfaces are warm neutral and the ink is graphite: no violet, which
  // means no token whose blue channel runs away from its red.
  it("no surface or ink is a violet", () => {
    for (const name of [...GROUNDS, "ink-strong", "ink", "ink-muted", "ink-faint", "line", "line-strong"]) {
      const hex = token(name);
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
      // A graphite is allowed to be a shade cool; the indigo this replaced
      // ran 16 points of blue past its red at the same lightness.
      expect(b - r, `${name} (${hex}) leans blue-violet`).toBeLessThanOrEqual(6);
      expect(Math.abs(g - (r + b) / 2), `${name} (${hex}) is not neutral`).toBeLessThanOrEqual(8);
    }
  });
});
