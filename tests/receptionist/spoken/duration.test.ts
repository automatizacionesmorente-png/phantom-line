import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { speakDuration } from "@/lib/receptionist/spoken";

describe("speakDuration", () => {
  it("says Lola's services the way people do", () => {
    expect(speakDuration(30, "es")).toBe("media hora");
    expect(speakDuration(90, "es")).toBe("una hora y media");
    expect(speakDuration(20, "es")).toBe("veinte minutos");
    expect(speakDuration(30, "en")).toBe("half an hour");
    expect(speakDuration(90, "en")).toBe("an hour and a half");
    expect(speakDuration(20, "en")).toBe("twenty minutes");
  });

  it("covers hours, quarters and single minutes", () => {
    expect(speakDuration(60, "es")).toBe("una hora");
    expect(speakDuration(120, "es")).toBe("dos horas");
    expect(speakDuration(150, "es")).toBe("dos horas y media");
    expect(speakDuration(75, "es")).toBe("una hora y cuarto");
    expect(speakDuration(15, "es")).toBe("un cuarto de hora");
    expect(speakDuration(45, "es")).toBe("tres cuartos de hora");
    expect(speakDuration(1, "es")).toBe("un minuto");
    expect(speakDuration(65, "es")).toBe("una hora y cinco minutos");
    expect(speakDuration(60, "en")).toBe("an hour");
    expect(speakDuration(120, "en")).toBe("two hours");
    expect(speakDuration(150, "en")).toBe("two and a half hours");
    expect(speakDuration(75, "en")).toBe("an hour and fifteen minutes");
    expect(speakDuration(1, "en")).toBe("one minute");
  });

  it("refuses what is not a whole number of minutes", () => {
    for (const bad of [0, -5, 1.5, Number.NaN]) expect(() => speakDuration(bad, "es")).toThrow(RangeError);
  });

  it("never has a digit and is never empty, for every length a service may have", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 480 }), fc.constantFrom("es" as const, "en" as const), (minutes, lang) => {
        const words = speakDuration(minutes, lang);
        expect(words).not.toMatch(/\d/);
        expect(words.trim()).not.toBe("");
      }),
      { numRuns: 480 },
    );
  });
});
