import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * owner-machine 11.5 (Requirement 13.1, 13.3, 13.5): the machine's colours, focus ring and
 * light animation, read from app/globals.css itself, so a token edit that breaks contrast or
 * a keyframe edit that flashes too often fails here before anyone opens a screen.
 */
const CSS = readFileSync(path.resolve(import.meta.dirname, "../../app/globals.css"), "utf8");

function rootTokens(css: string): Record<string, string> {
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css);
  if (!root) throw new Error(":root block not found in globals.css");
  const out: Record<string, string> = {};
  for (const m of root[1].matchAll(/--([a-z-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const TOKENS = rootTokens(CSS);

function hex(token: string): string {
  const v = TOKENS[token];
  if (v === undefined || !/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`--${token} is not a 6-digit hex colour: ${v}`);
  return v;
}

function luminance(color: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2 contrast ratio. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

type Size = "normal" | "large";
const MIN: Record<Size, number> = { normal: 4.5, large: 3 };

/** Every text/background pair the PIN_Gate, the machine, the landing page and the Demo_Notice use. */
const PAIRS: { text: string; bg: string; size: Size; where: string }[] = [
  ...["bg", "section", "card"].flatMap((bg) => [
    { text: "ink", bg, size: "normal" as const, where: "headings, labels, row text" },
    { text: "text", bg, size: "normal" as const, where: "body text, reply in Caveat, Demo_Notice" },
    { text: "muted", bg, size: "normal" as const, where: "secondary text, low badge, offline note" },
    { text: "gold-text", bg, size: "normal" as const, where: "unheard label, Caveat note, copied text" },
  ]),
  { text: "card", bg: "light-text", size: "normal", where: "urgent badge (7.8), cancel button" },
  { text: "card", bg: "espresso", size: "normal", where: "Sample badge, selected tab, confirmed status, selected slot" },
  { text: "light-text", bg: "section", size: "normal", where: "PIN_Gate error" },
  { text: "light-text", bg: "card", size: "normal", where: "dialog and Agenda row errors" },
  { text: "gold", bg: "bg", size: "large", where: "the gold phrase of a page heading" },
  { text: "gold", bg: "section", size: "large", where: "the Counter's gold phrase" },
];

describe("contrast of the machine's colour pairs (13.3)", () => {
  it.each(PAIRS)("--$text on --$bg ($size: $where)", ({ text, bg, size }) => {
    expect(contrast(hex(text), hex(bg))).toBeGreaterThanOrEqual(MIN[size]);
  });

  it("ink on every stop of the gold gradient passes for the primary button's large label", () => {
    const stops = TOKENS["gold-gradient"]?.match(/#[0-9a-f]{6}/gi) ?? [];
    expect(stops.length).toBe(3);
    for (const stop of stops) expect(contrast(hex("ink"), stop)).toBeGreaterThanOrEqual(MIN.large);
  });

  it("records why the primary button's label is large: ink on the darkest stop is under 4.5:1", () => {
    // design.md asks for ink text on the gradient; on #9E731F that is 4.4:1, so the label is
    // 19 px bold (large text) in components/machine/controlButton.ts. If the gradient gets
    // lighter, this changes and the button may go back to normal size.
    expect(contrast(hex("ink"), "#9e731f")).toBeLessThan(MIN.normal);
  });
});

describe("the focus ring (13.1)", () => {
  it("the focus-ring class has a :focus-visible outline in --gold", () => {
    const rule = /\.focus-ring:focus-visible\s*\{([^}]*)\}/.exec(CSS);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/outline\s*:\s*2px\s+solid\s+var\(--gold\)/);
  });
});

// ---------------------------------------------------------------------------
// The Message_Light never flashes more than 3 times in any one second (13.5).

interface Track {
  periodMs: number;
  /** Times in the cycle (ms) where opacity changes: one per keyframe segment whose two ends differ. */
  changes: number[];
}

function track(name: string): Track {
  const kf = new RegExp(`@keyframes\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(CSS);
  if (!kf) throw new Error(`@keyframes ${name} not found`);
  const stops = [...kf[1].matchAll(/([\d.]+)%\s*\{\s*opacity\s*:\s*([\d.]+)\s*;?\s*\}/g)].map((m) => ({
    at: Number(m[1]) / 100,
    opacity: Number(m[2]),
  }));
  expect(stops.length).toBeGreaterThanOrEqual(2);
  const cls = new RegExp(`\\.${name}\\s*\\{[^}]*animation\\s*:\\s*${name}\\s+([\\d.]+)(ms|s)`).exec(CSS);
  if (!cls) throw new Error(`.${name} has no animation duration`);
  const periodMs = Number(cls[1]) * (cls[2] === "s" ? 1000 : 1);
  const changes: number[] = [];
  for (let k = 1; k < stops.length; k++) {
    if (stops[k].opacity !== stops[k - 1].opacity) changes.push(stops[k - 1].at * periodMs);
  }
  // Wrapping from 100% back to 0% is a change too if the two ends differ.
  if (stops[stops.length - 1].opacity !== stops[0].opacity) changes.push(periodMs);
  return { periodMs, changes };
}

/** The most changes of either track that start inside any window of `windowMs`, over `spanMs`. */
function maxChangesPerWindow(tracks: Track[], spanMs: number, windowMs: number): number {
  const times: number[] = [];
  for (const t of tracks) {
    for (let cycle = 0; cycle * t.periodMs < spanMs; cycle++) {
      for (const c of t.changes) times.push(cycle * t.periodMs + c);
    }
  }
  times.sort((a, b) => a - b);
  let best = 0;
  for (let i = 0, j = 0; i < times.length; i++) {
    while (times[i] - times[j] >= windowMs) j++;
    best = Math.max(best, i - j + 1);
  }
  return best;
}

describe("the Message_Light's blink and flicker (13.5)", () => {
  const blink = track("light-blink");
  const flicker = track("light-flicker");

  it("the blink is slow: a cycle of at least 2 s", () => {
    expect(blink.periodMs).toBeGreaterThanOrEqual(2000);
    expect(blink.changes.length).toBeGreaterThan(0);
  });

  it("the flicker drifts against the blink (periods are not multiples)", () => {
    expect(flicker.changes.length).toBeGreaterThan(0);
    expect((flicker.periodMs / blink.periodMs) % 1).not.toBe(0);
  });

  it("together they change opacity at most 3 times in any one second, over 10 minutes", () => {
    expect(maxChangesPerWindow([blink, flicker], 10 * 60 * 1000, 1000)).toBeLessThanOrEqual(3);
  });

  it("the counter itself works: a 3 Hz flash is caught", () => {
    const fast: Track = { periodMs: 333, changes: [100, 200] };
    expect(maxChangesPerWindow([fast], 10_000, 1000)).toBeGreaterThan(3);
  });
});
