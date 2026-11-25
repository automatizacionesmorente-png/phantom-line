import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { dayLayout, freeSlotCount, type LayoutInput } from "@/lib/salon/dayLayout";

const TZ = "Europe/Madrid";
const DATE = "2026-11-10"; // a Tuesday, UTC+1
const HOURS = { 2: [{ open: "09:00", close: "13:00" }, { open: "16:00", close: "20:00" }] };
const at = (hhmm: string, date = DATE) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 10, Number(date.slice(8)), h - 1, m)).toISOString();
};
const base = (over: Partial<LayoutInput> = {}): LayoutInput => ({
  date: DATE,
  tz: TZ,
  hours: HOURS,
  slotStepMin: 15,
  resources: [{ id: "r1" }, { id: "r2" }],
  items: [],
  blocks: [],
  now: at("08:00"),
  ...over,
});

const minute = fc.integer({ min: 8 * 60, max: 21 * 60 });
const interval = fc.tuple(minute, fc.integer({ min: 5, max: 180 })).map(([s, d]) => ({ s, e: s + d }));
const iso = (min: number) => at(`${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`);

describe("dayLayout", () => {
  it("entries in a column never overlap and stay within 0–100 %", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom("r1", "r2"), interval), { maxLength: 8 }),
        fc.array(fc.tuple(fc.constantFrom("r1", "r2", null), interval), { maxLength: 4 }),
        (bs, ks) => {
          const out = dayLayout(
            base({
              items: bs.map(([r, i], n) => ({ id: `b${n}`, resourceId: r, start: iso(i.s), end: iso(i.e) })),
              blocks: ks.map(([r, i], n) => ({ id: `k${n}`, resourceId: r, start: iso(i.s), end: iso(i.e) })),
            }),
          );
          expect(out.endMin).toBeGreaterThan(out.startMin);
          for (const col of out.columns) {
            let last = 0;
            for (const e of col.entries) {
              expect(e.topPct).toBeGreaterThanOrEqual(-1e-9);
              expect(e.heightPct).toBeGreaterThan(0);
              expect(e.topPct + e.heightPct).toBeLessThanOrEqual(100 + 1e-9);
              expect(e.topPct).toBeGreaterThanOrEqual(last - 1e-9);
              last = e.topPct + e.heightPct;
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("free entries are the gaps inside opening hours of at least one step", () => {
    const out = dayLayout(base({ items: [{ id: "b", resourceId: "r1", start: at("10:00"), end: at("10:30") }] }));
    const col = out.columns.find((c) => c.resourceId === "r1")!;
    const free = col.entries.filter((e) => e.kind === "free");
    const t = (v: string) => new Date(v).getTime();
    expect(free.map((f) => [t(f.start), t(f.end)])).toEqual([
      [at("09:00"), at("10:00")],
      [at("10:30"), at("13:00")],
      [at("16:00"), at("20:00")],
    ].map((r) => r.map(t)));
    const tiny = dayLayout(base({ items: [{ id: "b", resourceId: "r1", start: at("09:05"), end: at("13:00") }] }));
    expect(tiny.columns[0].entries.filter((e) => e.kind === "free").map((f) => t(f.start))).toEqual([t(at("16:00"))]);
  });

  it("a block of the whole shop shows in every column, a block of one worker in that column only", () => {
    const out = dayLayout(
      base({ blocks: [{ id: "k1", resourceId: null, start: at("12:00"), end: at("13:00") }, { id: "k2", resourceId: "r2", start: at("16:00"), end: at("17:00") }] }),
    );
    const kinds = (id: string) => out.columns.find((c) => c.resourceId === id)!.entries.filter((e) => e.kind === "block").length;
    expect(kinds("r1")).toBe(1);
    expect(kinds("r2")).toBe(2);
  });

  it("now line only on today", () => {
    expect(dayLayout(base({ now: at("11:00") })).nowPct).not.toBeNull();
    expect(dayLayout(base({ now: at("11:00", "2026-11-09") })).nowPct).toBeNull();
    expect(dayLayout(base({ now: at("11:00", "2026-11-11") })).nowPct).toBeNull();
    expect(dayLayout(base({ now: at("07:00") })).nowPct).toBeNull();
  });

  it("a closed day with no items still has a range and no free entries", () => {
    const out = dayLayout(base({ date: "2026-11-15", hours: HOURS }));
    expect(out.endMin).toBeGreaterThan(out.startMin);
    expect(out.columns.every((c) => c.entries.length === 0)).toBe(true);
  });

  it("free slot count: whole steps left in the gaps from now on, none in the past", () => {
    const l = dayLayout(base({ resources: [{ id: "r1" }], items: [{ id: "b", resourceId: "r1", start: at("10:00"), end: at("11:00") }] }));
    // 09-10 (4) + 11-13 (8) + 16-20 (16) at 08:00; from 12:00: 4 + 16.
    expect(freeSlotCount(l, at("08:00"), 15)).toBe(28);
    expect(freeSlotCount(l, at("12:00"), 15)).toBe(20);
    expect(freeSlotCount(l, at("21:00"), 15)).toBe(0);
  });
});
