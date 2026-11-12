import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { formatSlot, formatSlotList, formatTime } from "@/lib/receptionist/format";

const at = (iso: string) => Temporal.Instant.from(iso);

describe("formatSlot", () => {
  it("Spanish and English, in the shop's time zone", () => {
    const i = at("2026-11-11T18:30:00Z"); // 19:30 in Madrid (UTC+1)
    expect(formatSlot(i, "Europe/Madrid", "es")).toBe("el miércoles 11 a las 19:30");
    expect(formatSlot(i, "Europe/Madrid", "en")).toBe("Wednesday the 11th at 7:30 pm");
    // The same instant in New York is the afternoon.
    expect(formatSlot(i, "America/New_York", "en")).toBe("Wednesday the 11th at 1:30 pm");
  });

  it("across the spring-forward change in Madrid (29 March 2026)", () => {
    // Saturday 28 March, UTC+1: 18:30Z is 19:30 local.
    expect(formatSlot(at("2026-03-28T18:30:00Z"), "Europe/Madrid", "es")).toBe("el sábado 28 a las 19:30");
    // Tuesday 31 March, UTC+2: the same wall time is 17:30Z.
    expect(formatSlot(at("2026-03-31T17:30:00Z"), "Europe/Madrid", "es")).toBe("el martes 31 a las 19:30");
    expect(formatSlot(at("2026-03-31T17:30:00Z"), "Europe/Madrid", "en")).toBe("Tuesday the 31st at 7:30 pm");
    // On the day itself: 01:30Z is 03:30 local (02:00 → 03:00 was skipped).
    expect(formatSlot(at("2026-03-29T01:30:00Z"), "Europe/Madrid", "es")).toBe("el domingo 29 a las 03:30");
  });

  it("across the fall-back change in Madrid (25 October 2026)", () => {
    // 02:30 local happens twice: first at 00:30Z (UTC+2), then at 01:30Z (UTC+1).
    expect(formatSlot(at("2026-10-25T00:30:00Z"), "Europe/Madrid", "es")).toBe("el domingo 25 a las 02:30");
    expect(formatSlot(at("2026-10-25T01:30:00Z"), "Europe/Madrid", "es")).toBe("el domingo 25 a las 02:30");
  });

  it("ordinals, 'a la una', noon and midnight", () => {
    expect(formatSlot(at("2026-11-01T12:00:00Z"), "UTC", "en")).toBe("Sunday the 1st at 12 pm");
    expect(formatSlot(at("2026-11-02T00:15:00Z"), "UTC", "en")).toBe("Monday the 2nd at 12:15 am");
    expect(formatSlot(at("2026-11-03T13:00:00Z"), "UTC", "en")).toBe("Tuesday the 3rd at 1 pm");
    expect(formatSlot(at("2026-11-11T10:00:00Z"), "UTC", "en")).toBe("Wednesday the 11th at 10 am");
    expect(formatSlot(at("2026-11-22T10:00:00Z"), "UTC", "en")).toBe("Sunday the 22nd at 10 am");
    expect(formatTime(at("2026-11-03T01:00:00Z"), "UTC", "es")).toBe("a la 01:00");
  });

  it("a list over two days names each day once", () => {
    const list = [at("2026-11-14T18:30:00Z"), at("2026-11-14T18:15:00Z"), at("2026-11-17T09:00:00Z")];
    expect(formatSlotList(list, "Europe/Madrid", "es")).toBe("el sábado 14 a las 19:30, a las 19:15 o el martes 17 a las 10:00");
    expect(formatSlotList(list, "Europe/Madrid", "en")).toBe(
      "Saturday the 14th at 7:30 pm, at 7:15 pm or Tuesday the 17th at 10 am",
    );
  });
});
