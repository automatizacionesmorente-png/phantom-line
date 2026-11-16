import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { toInstant } from "@/lib/booking";
import { getSectorPack } from "@/lib/sectors";
import {
  AGENDA_DAYS,
  agendaStatus,
  agendaWhat,
  agendaWindow,
  allowedActions,
  groupAgenda,
  type AgendaBooking,
} from "@/lib/owner/agenda";
import { lolaProfile } from "../fixtures/lola";

const TZ = "Europe/Madrid";
const at = (d: string, time: string) => toInstant(Temporal.PlainDate.from(d), Temporal.PlainTime.from(time), TZ);

function booking(o: Partial<AgendaBooking> & { start: Temporal.Instant }): AgendaBooking {
  return {
    id: "b1",
    revision: 1,
    resourceId: "chair-1",
    serviceId: "haircut",
    end: o.start.add({ minutes: 30 }),
    status: "confirmed",
    ownerConfirmedAt: null,
    cancelledBy: null,
    customerName: "Ana",
    channel: "voice",
    lastOwnerAction: null,
    ...o,
  };
}

describe("agendaStatus", () => {
  const start = at("2026-11-14", "10:00");
  it("an active Booking the Owner has not confirmed is booked", () => {
    expect(agendaStatus(booking({ start }))).toBe("booked");
  });
  it("an active Booking with owner_confirmed_at is confirmed", () => {
    expect(agendaStatus(booking({ start, ownerConfirmedAt: at("2026-11-13", "09:00") }))).toBe("confirmed");
  });
  it("a cancelled Booking is cancelled, even if the Owner had confirmed it", () => {
    expect(agendaStatus(booking({ start, status: "cancelled", cancelledBy: "caller" }))).toBe("cancelled");
    expect(
      agendaStatus(booking({ start, status: "cancelled", cancelledBy: "owner", ownerConfirmedAt: at("2026-11-13", "09:00") })),
    ).toBe("cancelled");
  });
});

describe("allowedActions", () => {
  const now = at("2026-11-13", "09:00");
  const start = at("2026-11-14", "10:00");
  it("confirm, move and cancel while unconfirmed", () => {
    expect(allowedActions(booking({ start }), now)).toEqual(["confirm", "move", "cancel"]);
  });
  it("move and cancel once confirmed", () => {
    expect(allowedActions(booking({ start, ownerConfirmedAt: now }), now)).toEqual(["move", "cancel"]);
  });
  it("none for a cancelled Booking or one that has started", () => {
    expect(allowedActions(booking({ start, status: "cancelled" }), now)).toEqual([]);
    expect(allowedActions(booking({ start }), start)).toEqual([]);
    expect(allowedActions(booking({ start }), start.add({ minutes: 1 }))).toEqual([]);
    expect(allowedActions(booking({ start }), start.subtract({ seconds: 1 }))).toEqual(["confirm", "move", "cancel"]);
  });
});

describe("agendaWindow and groupAgenda", () => {
  const now = at("2026-11-13", "09:00"); // Friday
  const w = agendaWindow(now, TZ);

  it("is today and the next 7 local days, from today's midnight", () => {
    expect(w.days.map(String)).toEqual([
      "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20",
    ]);
    expect(w.from.equals(at("2026-11-13", "00:00"))).toBe(true);
    expect(w.to.equals(at("2026-11-21", "00:00"))).toBe(true);
  });

  it("a booking at 23:30 local on the last day is in; one at 00:00 the day after is out", () => {
    const last = booking({ id: "last", start: at("2026-11-20", "23:30") });
    const after = booking({ id: "after", start: at("2026-11-21", "00:00") });
    const before = booking({ id: "before", start: at("2026-11-12", "23:59") });
    const days = groupAgenda([last, after, before], w, TZ);
    expect(days.find((d) => d.date === "2026-11-20")?.items.map((b) => b.id)).toEqual(["last"]);
    expect(days.flatMap((d) => d.items).map((b) => b.id)).toEqual(["last"]);
  });

  it("empty days are present, and each day lists active before cancelled, each by start", () => {
    const rows = [
      booking({ id: "c-10", start: at("2026-11-14", "10:00"), status: "cancelled", cancelledBy: "owner" }),
      booking({ id: "a-17", start: at("2026-11-14", "17:00") }),
      booking({ id: "a-11", start: at("2026-11-14", "11:00") }),
      booking({ id: "c-09", start: at("2026-11-14", "09:00"), status: "cancelled", cancelledBy: "caller" }),
    ];
    const days = groupAgenda(rows, w, TZ);
    expect(days).toHaveLength(AGENDA_DAYS);
    expect(days.map((d) => d.items.length)).toEqual([0, 4, 0, 0, 0, 0, 0, 0]);
    expect(days[1].items.map((b) => b.id)).toEqual(["a-11", "a-17", "c-09", "c-10"]);
  });

  it("the window across the 25 October change is 8 local days of 25 hours' worth (193 h)", () => {
    const win = agendaWindow(at("2026-10-20", "12:00"), TZ);
    expect(win.days.map(String)[5]).toBe("2026-10-25");
    expect(win.from.until(win.to).total("hours")).toBe(8 * 24 + 1);
    const late = booking({ id: "late", start: at("2026-10-25", "23:30") });
    expect(groupAgenda([late], win, TZ)[5].items.map((b) => b.id)).toEqual(["late"]);
  });

  it("the window across the 29 March change is 191 h, and its days start at local midnight", () => {
    const win = agendaWindow(at("2026-03-26", "00:00"), TZ);
    expect(win.from.until(win.to).total("hours")).toBe(8 * 24 - 1);
    expect(win.from.toZonedDateTimeISO(TZ).toPlainTime().toString()).toBe("00:00:00");
    expect(win.to.toZonedDateTimeISO(TZ).toPlainTime().toString()).toBe("00:00:00");
  });
});

describe("agendaWhat", () => {
  const pack = getSectorPack("hair-salon");
  const start = at("2026-11-14", "10:00");
  it("names the Service in the Owner's language", () => {
    expect(agendaWhat(booking({ start }), lolaProfile, pack, "es")).toBe("corte");
    expect(agendaWhat(booking({ start, serviceId: "colour" }), lolaProfile, pack, "en")).toBe("colour");
  });
  it("an unknown Service shows its id", () => {
    expect(agendaWhat(booking({ start, serviceId: "perm" }), lolaProfile, pack, "es")).toBe("perm");
  });
});
