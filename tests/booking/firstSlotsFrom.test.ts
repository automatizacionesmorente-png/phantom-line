import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import {
  firstSlotsFrom,
  sessionsOn,
  toInstant,
  type ExistingBooking,
  type RuleContext,
} from "@/lib/booking";
import { lolaPack, lolaRules } from "../fixtures/lola";

// Peluquería Lola: Tue–Sat 10–14 and 17–20, 2 chairs, a 15-minute grid. 2026-11-11 is a Wednesday.
const TZ = "Europe/Madrid";
const at = (date: string, time: string) =>
  toInstant(Temporal.PlainDate.from(date), Temporal.PlainTime.from(time), TZ);
const ctx = (now: Temporal.Instant, existing: ExistingBooking[] = []): RuleContext => ({
  now,
  shop: lolaRules,
  pack: lolaPack,
  existing,
});
const local = (i: Temporal.Instant) => i.toZonedDateTimeISO(TZ).toPlainDateTime().toString().slice(0, 16);
const MORNING = { fromMin: 0, toMin: 840 };
const AFTERNOON = { fromMin: 840, toMin: 1440 };

describe("firstSlotsFrom: the slot grid forward from a time", () => {
  const now = at("2026-11-11", "09:00");

  it("from inside a session: the next grid starts, earliest first", () => {
    const slots = firstSlotsFrom({ serviceId: "haircut", from: at("2026-11-11", "11:07") }, ctx(now));
    expect(slots.map((s) => [local(s.start), s.resourceId])).toEqual([
      ["2026-11-11T11:15", "chair-1"],
      ["2026-11-11T11:30", "chair-1"],
      ["2026-11-11T11:45", "chair-1"],
    ]);
    expect(local(slots[0].end)).toBe("2026-11-11T11:45");
  });

  it("a start exactly on the grid is included", () => {
    const slots = firstSlotsFrom({ serviceId: "haircut", from: at("2026-11-11", "11:15") }, ctx(now), { limit: 1 });
    expect(slots.map((s) => local(s.start))).toEqual(["2026-11-11T11:15"]);
  });

  it("from between sessions: the afternoon session's opening", () => {
    const slots = firstSlotsFrom({ serviceId: "haircut", from: at("2026-11-11", "14:30") }, ctx(now));
    expect(slots.map((s) => local(s.start))).toEqual(["2026-11-11T17:00", "2026-11-11T17:15", "2026-11-11T17:30"]);
  });

  it("a service that no longer fits the morning goes to the afternoon", () => {
    // A colour takes 90 minutes, so its last morning start is 12:30.
    const slots = firstSlotsFrom({ serviceId: "colour", from: at("2026-11-11", "12:31") }, ctx(now), { limit: 1 });
    expect(slots.map((s) => local(s.start))).toEqual(["2026-11-11T17:00"]);
  });

  it("from a closed day: the first opening after it", () => {
    // Sunday 15 and Monday 16 November are closed.
    const slots = firstSlotsFrom({ serviceId: "haircut", from: at("2026-11-15", "09:00") }, ctx(now), { limit: 2 });
    expect(slots.map((s) => local(s.start))).toEqual(["2026-11-17T10:00", "2026-11-17T10:15"]);
  });

  it("a Combo_Id is one service of the summed duration", () => {
    // haircut + colour = 120 minutes: 12:00 ends exactly at the 14:00 close, 12:15 does not fit.
    const slots = firstSlotsFrom({ serviceId: "haircut+colour", from: at("2026-11-11", "12:00") }, ctx(now), { limit: 2 });
    expect(slots.map((s) => [local(s.start), local(s.end)])).toEqual([
      ["2026-11-11T12:00", "2026-11-11T14:00"],
      ["2026-11-11T17:00", "2026-11-11T19:00"],
    ]);
  });

  it("never returns a slot before now, even when `from` is earlier", () => {
    const slots = firstSlotsFrom({ serviceId: "haircut", from: at("2026-11-11", "09:00") }, ctx(at("2026-11-11", "11:05")), { limit: 1 });
    expect(slots.map((s) => local(s.start))).toEqual(["2026-11-11T11:15"]);
  });

  it("takes the other chair, and skips a time when both chairs are busy", () => {
    const existing: ExistingBooking[] = [
      { id: "a", resourceId: "chair-1", start: at("2026-11-11", "11:15"), end: at("2026-11-11", "11:45") },
      { id: "b", resourceId: "chair-2", start: at("2026-11-11", "11:15"), end: at("2026-11-11", "11:45") },
      { id: "c", resourceId: "chair-1", start: at("2026-11-11", "11:45"), end: at("2026-11-11", "12:15") },
    ];
    const slots = firstSlotsFrom({ serviceId: "haircut", from: at("2026-11-11", "11:15") }, ctx(now, existing));
    expect(slots.map((s) => [local(s.start), s.resourceId])).toEqual([
      ["2026-11-11T11:45", "chair-2"],
      ["2026-11-11T12:00", "chair-2"],
      ["2026-11-11T12:15", "chair-1"],
    ]);
  });

  it("ignoreBookingId frees the booking being moved", () => {
    const existing: ExistingBooking[] = [
      { id: "a", resourceId: "chair-1", start: at("2026-11-11", "11:15"), end: at("2026-11-11", "11:45") },
      { id: "b", resourceId: "chair-2", start: at("2026-11-11", "11:15"), end: at("2026-11-11", "11:45") },
    ];
    const slots = firstSlotsFrom(
      { serviceId: "haircut", from: at("2026-11-11", "11:15"), ignoreBookingId: "b" },
      ctx(now, existing),
      { limit: 1 },
    );
    expect(slots.map((s) => [local(s.start), s.resourceId])).toEqual([["2026-11-11T11:15", "chair-2"]]);
  });

  it("limit 0 and an unknown service give nothing", () => {
    expect(firstSlotsFrom({ serviceId: "haircut", from: now }, ctx(now), { limit: 0 })).toEqual([]);
    expect(firstSlotsFrom({ serviceId: "perm", from: now }, ctx(now))).toEqual([]);
  });

  it("windowDays bounds the walk in real hours from `from`", () => {
    // Saturday 14 November 19:45: a haircut no longer fits; the next opening is Tuesday 10:00.
    const from = at("2026-11-14", "19:45");
    expect(firstSlotsFrom({ serviceId: "haircut", from }, ctx(now), { windowDays: 2 })).toEqual([]);
    const slots = firstSlotsFrom({ serviceId: "haircut", from }, ctx(now), { windowDays: 3, limit: 1 });
    expect(slots.map((s) => local(s.start))).toEqual(["2026-11-17T10:00"]);
  });
});

describe("firstSlotsFrom across the 2026 Madrid DST changes", () => {
  it("spring forward (Sunday 29 March): Saturday 19:00 is 18:00Z (UTC+1)", () => {
    const slots = firstSlotsFrom({ serviceId: "haircut", from: at("2026-03-28", "19:00") }, ctx(at("2026-03-28", "09:00")), { limit: 1 });
    expect(slots[0].start.toString()).toBe("2026-03-28T18:00:00Z");
  });
  it("spring forward: from Saturday 19:45 the next slot is Tuesday 31 March 10:00, 08:00Z (UTC+2)", () => {
    const slots = firstSlotsFrom({ serviceId: "haircut", from: at("2026-03-28", "19:45") }, ctx(at("2026-03-28", "09:00")), { limit: 2 });
    expect(slots.map((s) => s.start.toString())).toEqual(["2026-03-31T08:00:00Z", "2026-03-31T08:15:00Z"]);
    expect(local(slots[0].start)).toBe("2026-03-31T10:00");
  });
  it("fall back (Sunday 25 October): from Saturday 24 at 19:45 the next slot is Tuesday 27 October 10:00, 09:00Z (UTC+1)", () => {
    const slots = firstSlotsFrom({ serviceId: "haircut", from: at("2026-10-24", "19:45") }, ctx(at("2026-10-24", "09:00")), { limit: 1 });
    expect(slots.map((s) => s.start.toString())).toEqual(["2026-10-27T09:00:00Z"]);
  });
  it("fall back: Saturday 24 October 19:30 is still 17:30Z (UTC+2)", () => {
    const slots = firstSlotsFrom({ serviceId: "haircut", from: at("2026-10-24", "19:30") }, ctx(at("2026-10-24", "09:00")), { limit: 1 });
    expect(slots[0].start.toString()).toBe("2026-10-24T17:30:00Z");
  });
});

describe("firstSlotsFrom with a part of the day (`within`)", () => {
  const now = at("2026-11-11", "09:00");

  it("afternoon from the morning: the afternoon's first slot", () => {
    const slots = firstSlotsFrom({ serviceId: "haircut", from: at("2026-11-11", "10:00") }, ctx(now), { within: AFTERNOON, limit: 2 });
    expect(slots.map((s) => local(s.start))).toEqual(["2026-11-11T17:00", "2026-11-11T17:15"]);
  });

  it("morning from the afternoon: the next day's morning", () => {
    const slots = firstSlotsFrom({ serviceId: "haircut", from: at("2026-11-11", "15:00") }, ctx(now), { within: MORNING, limit: 2 });
    expect(slots.map((s) => local(s.start))).toEqual(["2026-11-12T10:00", "2026-11-12T10:15"]);
  });

  it("morning ends before 14:00: a morning list never holds an afternoon start", () => {
    const slots = firstSlotsFrom({ serviceId: "haircut", from: at("2026-11-11", "13:20") }, ctx(now), { within: MORNING, limit: 3 });
    expect(slots.map((s) => local(s.start))).toEqual(["2026-11-11T13:30", "2026-11-12T10:00", "2026-11-12T10:15"]);
  });

  it("an empty range gives nothing", () => {
    expect(firstSlotsFrom({ serviceId: "haircut", from: now }, ctx(now), { within: { fromMin: 1200, toMin: 1440 } })).toEqual([]);
  });
});

describe("firstSlotsFrom when everything is busy for 14 days", () => {
  it("returns no slot (the caller hears 'no encuentro otro hueco')", () => {
    const now = at("2026-11-11", "09:00");
    const existing: ExistingBooking[] = [];
    for (let d = 0; d <= 16; d++) {
      const date = Temporal.PlainDate.from("2026-11-11").add({ days: d });
      for (const s of sessionsOn(date, lolaRules)) {
        for (const chair of ["chair-1", "chair-2"]) {
          existing.push({ id: `${date}-${chair}-${s.open}`, resourceId: chair, start: s.open, end: s.close });
        }
      }
    }
    expect(firstSlotsFrom({ serviceId: "haircut", from: now }, ctx(now, existing))).toEqual([]);
    expect(firstSlotsFrom({ serviceId: "beard", from: now }, ctx(now, existing), { within: AFTERNOON })).toEqual([]);
    // One free chair-hour after the window is still out of reach.
    const freeLater = existing.filter((b) => !(b.resourceId === "chair-2" && local(b.start) === "2026-11-26T10:00"));
    expect(firstSlotsFrom({ serviceId: "haircut", from: now }, ctx(now, freeLater))).toEqual([]);
    // The same free chair inside the window is found.
    const freeInside = existing.filter((b) => !(b.resourceId === "chair-2" && local(b.start) === "2026-11-24T10:00"));
    expect(firstSlotsFrom({ serviceId: "haircut", from: now }, ctx(now, freeInside), { limit: 1 }).map((s) => [local(s.start), s.resourceId])).toEqual([
      ["2026-11-24T10:00", "chair-2"],
    ]);
  });
});
