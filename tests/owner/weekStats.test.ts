import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { computeWeekStats, windowBounds, type WeekBooking, type WeekCall } from "@/lib/owner/weekStats";
import { lolaProfile } from "../fixtures/lola";

const I = (s: string) => Temporal.Instant.from(s);
const shop = { timeZone: lolaProfile.timeZone, hours: lolaProfile.hours, services: lolaProfile.services };
/** Thursday 26 November 2026, 12:00 in Madrid (the week of Monday 23rd). */
const NOW = I("2026-11-26T11:00:00Z");

let n = 0;
const call = (startedAt: string, minutes: number | null, o: Partial<WeekCall> = {}): WeekCall => {
  const s = I(startedAt);
  const end = minutes === null ? null : s.add({ minutes });
  return { id: `c${String(++n).padStart(3, "0")}`, status: "completed", startedAt: s, updatedAt: end ?? s, endedAt: end, ...o };
};
const booking = (serviceId: string, callId: string | null, createdAt: string, o: Partial<WeekBooking> = {}): WeekBooking => ({
  id: `b${String(++n).padStart(3, "0")}`,
  serviceId,
  callId,
  rescheduledFrom: null,
  status: "confirmed",
  createdAt: I(createdAt),
  ...o,
});
const stats = (calls: WeekCall[], bookings: WeekBooking[] = [], now = NOW) => computeWeekStats({ now, shop, calls, bookings });

describe("windowBounds", () => {
  it("is the last 7 days ending now, at the same local time", () => {
    const b = windowBounds(NOW, "Europe/Madrid");
    expect(b.start.toString()).toBe("2026-11-19T11:00:00Z");
    expect(b.end.toString()).toBe("2026-11-26T11:00:00.001Z");
    expect(b.fromDate.toString()).toBe("2026-11-19");
    expect(b.toDate.toString()).toBe("2026-11-26");
  });

  it("uses the shop's zone: the same instant is another local day in Tokyo", () => {
    const at = I("2026-11-29T20:00:00Z");
    expect(windowBounds(at, "Asia/Tokyo").toDate.toString()).toBe("2026-11-30");
    expect(windowBounds(at, "Europe/Madrid").toDate.toString()).toBe("2026-11-29");
  });

  it("lasts 167 hours over the spring change and 169 over the autumn one, 168 otherwise", () => {
    const hours = (at: string) => {
      const b = windowBounds(I(at), "Europe/Madrid");
      return I(at).since(b.start).total("hours");
    };
    expect(hours("2026-03-30T10:00:00Z")).toBe(167);
    expect(hours("2026-10-26T10:00:00Z")).toBe(169);
    expect(hours("2026-11-26T10:00:00Z")).toBe(168);
  });
});

describe("computeWeekStats", () => {
  it("is all zeros, with nothing to say about time or money, for an empty week", () => {
    expect(stats([])).toMatchObject({
      callsAnswered: 0,
      bookings: 0,
      revenueCents: 0,
      lostCalls: 0,
      timeSavedSeconds: null,
      timedCalls: 0,
    });
  });

  it("counts the calls of the last 7 days only, and not the failed ones", () => {
    const s = stats([
      call("2026-11-24T09:00:00Z", 3),
      call("2026-11-25T09:00:00Z", 3, { status: "abandoned" }),
      call("2026-11-25T10:00:00Z", 3, { status: "failed" }),
      call("2026-11-19T10:59:00Z", 3), // 11:59 in Madrid on the 19th: a minute before the window
      call("2026-11-19T11:00:00Z", 3), // 12:00 on the 19th: the first instant inside it
      call("2026-11-26T11:00:00Z", 3), // now: inside
      call("2026-11-26T11:01:00Z", 3), // a minute from now: not yet
    ]);
    expect(s.callsAnswered).toBe(4);
    expect(s.from).toBe("2026-11-19");
    expect(s.to).toBe("2026-11-26");
  });

  it("adds the catalogue prices of the bookings, a combo as the sum of its parts", () => {
    const s = stats(
      [],
      [
        booking("haircut", "c1", "2026-11-24T09:00:00Z"),
        booking("colour", "c2", "2026-11-24T10:00:00Z"),
        booking("haircut+beard", "c3", "2026-11-25T10:00:00Z"),
      ],
    );
    expect(s.bookings).toBe(3);
    expect(s.revenueCents).toBe(1500 + 4500 + 1500 + 1000);
    expect(s.revenueFrom).toBe(false);
  });

  it("skips cancelled bookings, bookings of no call, reschedules and older ones", () => {
    const s = stats(
      [],
      [
        booking("haircut", "c1", "2026-11-24T09:00:00Z", { status: "cancelled" }),
        booking("haircut", null, "2026-11-24T09:00:00Z"),
        booking("haircut", "c3", "2026-11-24T09:00:00Z", { rescheduledFrom: "b1" }),
        booking("haircut", "c4", "2026-11-19T10:00:00Z"),
        booking("haircut", "c5", "2026-11-24T09:00:00Z"),
      ],
    );
    expect(s.bookings).toBe(1);
    expect(s.revenueCents).toBe(1500);
  });

  it("does not show revenue when a booked service left the catalogue", () => {
    const s = stats([], [booking("haircut", "c1", "2026-11-24T09:00:00Z"), booking("gone", "c2", "2026-11-24T09:00:00Z")]);
    expect(s.bookings).toBe(2);
    expect(s.revenueCents).toBeNull();
  });

  it("marks revenue as a minimum when a price is a starting price", () => {
    const from = { ...shop, services: shop.services.map((x) => (x.id === "colour" ? { ...x, priceFrom: true } : x)) };
    const s = computeWeekStats({ now: NOW, shop: from, calls: [], bookings: [booking("colour", "c1", "2026-11-24T09:00:00Z")] });
    expect(s.revenueFrom).toBe(true);
  });

  it("counts calls outside the opening hours, in the shop's local time", () => {
    const s = stats([
      call("2026-11-24T09:00:00Z", 2), // Tuesday 10:00 Madrid: open
      call("2026-11-24T13:30:00Z", 2), // 14:30: between sessions
      call("2026-11-24T19:30:00Z", 2), // 20:30: closed
      call("2026-11-23T10:00:00Z", 2), // Monday: closed
    ]);
    expect(s.callsAnswered).toBe(4);
    expect(s.lostCalls).toBe(3);
  });

  it("counts a call that started while another was in progress, once, and not the first one", () => {
    const first = call("2026-11-24T09:00:00Z", 5, { id: "a" });
    const second = call("2026-11-24T09:03:00Z", 2, { id: "b" });
    const third = call("2026-11-24T09:05:00Z", 2, { id: "c" }); // starts the minute the first one ends
    expect(stats([first, second, third]).lostCalls).toBe(1);
    const tie = [call("2026-11-24T09:00:00Z", 3, { id: "x" }), call("2026-11-24T09:00:00Z", 3, { id: "y" })];
    expect(stats(tie).lostCalls).toBe(1);
  });

  it("counts a call that is lost twice (late and busy) once", () => {
    const s = stats([call("2026-11-24T21:00:00Z", 5, { id: "a" }), call("2026-11-24T21:01:00Z", 1, { id: "b" })]);
    expect(s.lostCalls).toBe(2);
  });

  it("adds the duration of the finished calls, and shows no time without one", () => {
    const s = stats([call("2026-11-24T09:00:00Z", 3), call("2026-11-24T10:00:00Z", 5), call("2026-11-24T11:00:00Z", null, { status: "open" })]);
    expect(s.timeSavedSeconds).toBe(8 * 60);
    expect(s.timedCalls).toBe(2);
    expect(stats([call("2026-11-24T11:00:00Z", null, { status: "open" })]).timeSavedSeconds).toBeNull();
  });
});
