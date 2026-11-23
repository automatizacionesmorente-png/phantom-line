import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { bookingState, type StateInput } from "@/lib/salon/state";

const at = (s: string) => Temporal.Instant.from(s);
const base: StateInput = {
  status: "confirmed",
  ownerConfirmedAt: null,
  channel: "voice",
  noShowAt: null,
  paid: false,
  start: at("2026-11-12T09:00:00Z"),
  end: at("2026-11-12T09:30:00Z"),
  now: at("2026-11-10T08:00:00Z"),
};
const past = { now: at("2026-11-12T10:00:00Z") };

describe("bookingState (spec 9.1)", () => {
  it("pending: made by the receptionist, not confirmed, still ahead", () => {
    expect(bookingState(base)).toBe("pending");
  });
  it("confirmed: owner-confirmed", () => {
    expect(bookingState({ ...base, ownerConfirmedAt: at("2026-11-10T07:00:00Z") })).toBe("confirmed");
  });
  it("confirmed: made by hand, with no confirmation time", () => {
    expect(bookingState({ ...base, channel: "manual" })).toBe("confirmed");
  });
  it("done: has a payment, even before it ends", () => {
    expect(bookingState({ ...base, paid: true })).toBe("done");
    expect(bookingState({ ...base, ...past, paid: true })).toBe("done");
  });
  it("no_show: noShowAt set", () => {
    expect(bookingState({ ...base, ...past, noShowAt: at("2026-11-12T10:00:00Z") })).toBe("no_show");
  });
  it("to_collect: ended with no payment and no no-show, confirmed or not", () => {
    expect(bookingState({ ...base, ...past })).toBe("to_collect");
    expect(bookingState({ ...base, ...past, ownerConfirmedAt: at("2026-11-10T07:00:00Z") })).toBe("to_collect");
  });
  it("is not to collect while it is still running", () => {
    expect(bookingState({ ...base, now: at("2026-11-12T09:10:00Z"), channel: "manual" })).toBe("confirmed");
  });
  it("cancelled is never to collect", () => {
    expect(bookingState({ ...base, ...past, status: "cancelled" })).toBe("cancelled");
  });
});
