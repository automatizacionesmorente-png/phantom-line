import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import { lolaSeedProfile } from "@/lib/db/seed";
import {
  DEMO_DELETE_AFTER_DAYS,
  DEMO_ERASE_AFTER_HOURS,
  DEMO_MIN_TAPE,
  DEMO_RETENTION_EVERY_MIN,
  DEMO_SHOP_ID,
  demoCutoffs,
  demoNotice,
  demoSamples,
  isDemoShop,
  samplesToRestore,
  type DemoSample,
} from "@/lib/owner/demo";
import { phrases } from "@/lib/receptionist/phrases";
import { getSectorPack } from "@/lib/sectors";

const pack = getSectorPack("hair-salon");
const at = (iso: string) => Temporal.Instant.from(iso);
const madrid = (i: Temporal.Instant) => i.toZonedDateTimeISO("Europe/Madrid").toPlainDateTime().toString();
const englishLola: ShopProfile = { ...lolaSeedProfile, languages: ["en", "es"] };

function samples(now: Temporal.Instant, shop: ShopProfile = lolaSeedProfile): Record<string, DemoSample> {
  let n = 0;
  const list = demoSamples(["urgent", "booking", "question"], { now, shop, pack, newId: () => `call-${n++}` });
  return Object.fromEntries(list.map((s) => [s.key, s]));
}

describe("the Demo_Shop and its constants", () => {
  it("is Peluquería Lola, the seeded shop, and nothing else", () => {
    expect(DEMO_SHOP_ID).toBe("peluqueria-lola");
    expect(lolaSeedProfile.id).toBe(DEMO_SHOP_ID);
    expect(isDemoShop("peluqueria-lola")).toBe(true);
    expect(isDemoShop("Peluqueria-Lola")).toBe(false);
    expect(isDemoShop("peluqueria-lola ")).toBe(false);
    expect(isDemoShop("barberia-paco")).toBe(false);
  });

  it("uses the retention numbers of Requirement 16", () => {
    expect(DEMO_ERASE_AFTER_HOURS).toBe(24);
    expect(DEMO_DELETE_AFTER_DAYS).toBe(7);
    expect(DEMO_MIN_TAPE).toBe(3);
    expect(DEMO_RETENTION_EVERY_MIN).toBe(10);
  });
});

describe("demoCutoffs", () => {
  it("counts exact hours across the 25 October change, not wall-clock days", () => {
    // Sunday 25 October 2026, 12:00 in Madrid (CET, UTC+1), after the 03:00 → 02:00 change.
    const now = at("2026-10-25T11:00:00Z");
    const c = demoCutoffs(now);
    expect(c.now.toString()).toBe(now.toString());
    expect(c.eraseBefore.toString()).toBe("2026-10-24T11:00:00Z");
    expect(c.deleteBefore.toString()).toBe("2026-10-18T11:00:00Z");
    // 24 real hours before is 13:00 the day before in Madrid (CEST), not 12:00.
    expect(madrid(c.eraseBefore)).toBe("2026-10-24T13:00:00");
    expect(madrid(c.deleteBefore)).toBe("2026-10-18T13:00:00");
    expect(now.since(c.eraseBefore).total("hours")).toBe(24);
    expect(now.since(c.deleteBefore).total("hours")).toBe(168);
  });

  it("does the same across the 29 March change", () => {
    // Sunday 29 March 2026, 14:00 in Madrid (CEST, UTC+2), after the 02:00 → 03:00 change.
    const c = demoCutoffs(at("2026-03-29T12:00:00Z"));
    expect(madrid(c.eraseBefore)).toBe("2026-03-28T13:00:00");
    expect(madrid(c.deleteBefore)).toBe("2026-03-22T13:00:00");
  });
});

describe("samplesToRestore", () => {
  it("restores nothing while the Tape holds 3 or more New_Messages", () => {
    expect(samplesToRestore({ newCount: 3, activeSampleKeys: [] })).toEqual([]);
    expect(samplesToRestore({ newCount: 7, activeSampleKeys: ["urgent"] })).toEqual([]);
  });

  it("restores exactly the samples not on the Tape when it holds fewer than 3", () => {
    expect(samplesToRestore({ newCount: 0, activeSampleKeys: [] })).toEqual(["urgent", "booking", "question"]);
    expect(samplesToRestore({ newCount: 2, activeSampleKeys: ["booking"] })).toEqual(["urgent", "question"]);
    expect(samplesToRestore({ newCount: 2, activeSampleKeys: ["question", "urgent"] })).toEqual(["booking"]);
  });
});

describe("demoNotice", () => {
  it("is exactly the approved wording in both languages", () => {
    expect(demoNotice("es")).toBe("Demo: no dejes datos personales reales");
    expect(demoNotice("en")).toBe("Demo: do not leave real personal data");
  });
});

describe("demoSamples", () => {
  // Thursday 12 November 2026, 10:00 in Madrid.
  const thursday = at("2026-11-12T09:00:00Z");

  it("the urgent sample is urgent because of the pack's term «reacción»", () => {
    const s = samples(thursday).urgent;
    expect(s.message.urgency).toBe("urgent");
    expect(s.message.urgencyBasis).toEqual({ rule: "urgent_term", term: "reacción", lang: "es" });
    expect(s.message.outcome).toBe("message");
    expect(s.call.transcript.map((l) => l.caller)).toContain(
      "Me teñí ayer y hoy tengo una reacción, me pica mucho el cuero cabelludo.",
    );
  });

  it("the booking sample is normal, for the next open day, and creates no Booking", () => {
    const s = samples(thursday).booking;
    expect(s.message.urgency).toBe("normal");
    expect(s.message.urgencyBasis).toEqual({ rule: "none" });
    expect(s.message.urgencySuggested).toBe("normal");
    expect(s.message.outcome).toBe("booked");
    // Friday 13, the next open day, at the first session's 10:00 + 1 hour.
    expect(s.agreedSlot?.start.toString()).toBe("2026-11-13T10:00:00Z");
    expect(s.message.agreed).toBe("Cita de corte el viernes 13 a las 11:00 (Sillón 1)");
    const o = phrases("es", pack, lolaSeedProfile, undefined, thursday).owner;
    expect(s.message.agreed).toBe(o.agreedBooked("haircut", at("2026-11-13T10:00:00Z"), "chair-1"));
    // Nothing that could become a Booking row: no booking id, no customer fields.
    expect(Object.keys(s).sort()).toEqual(["agreedSlot", "call", "key", "message"]);
    expect(s.message).not.toHaveProperty("bookingId");
  });

  it("the booking sample skips Sunday and Monday, when Lola is closed", () => {
    // Saturday 14 November, 19:00 in Madrid: the next open day is Tuesday 17.
    const s = samples(at("2026-11-14T18:00:00Z")).booking;
    expect(s.agreedSlot?.start.toString()).toBe("2026-11-17T10:00:00Z");
    expect(s.message.agreed).toBe("Cita de corte el martes 17 a las 11:00 (Sillón 1)");
  });

  it("the question sample is low and answers from the shop's own hours", () => {
    const s = samples(thursday).question;
    expect(s.message.urgency).toBe("low");
    expect(s.message.urgencyBasis).toEqual({ rule: "none" });
    expect(s.message.outcome).toBe("answered");
    expect(s.call.transcript[1]).toEqual({
      caller: "¿Abrís el sábado por la tarde?",
      receptionist: "Sí, el sábado por la tarde abrimos de 17:00 a 20:00.",
    });
  });

  it("marks every name as an example and uses phones that cannot be dialled", () => {
    const es = samples(thursday);
    expect(es.urgent.message.callerName).toBe("Marta (ejemplo)");
    expect(es.booking.message.callerName).toBe("Ana (ejemplo)");
    expect(es.question.message.callerName).toBe("Luis (ejemplo)");
    // "+34 000 000 001" to "003", stored in E.164 like every phone.
    expect(es.urgent.message.callerPhone).toBe("+34000000001");
    expect(es.booking.message.callerPhone).toBe("+34000000002");
    expect(es.question.message.callerPhone).toBe("+34000000003");
    const en = samples(thursday, englishLola);
    for (const s of Object.values(en)) expect(s.message.callerName).toMatch(/ \(example\)$/);
  });

  it("is written in the Shop's first language", () => {
    for (const s of Object.values(samples(thursday))) {
      expect(s.call.language).toBe("es");
      expect(s.call.transcript[0].receptionist).toContain("Peluquería Lola");
    }
    const en = samples(thursday, englishLola);
    expect(en.urgent.call.language).toBe("en");
    expect(en.urgent.message.urgencyBasis).toEqual({ rule: "urgent_term", term: "reaction", lang: "en" });
    expect(en.booking.message.reason).toBe("Wants a haircut");
    expect(en.question.call.transcript[1].receptionist).toBe(
      "Yes, on Saturday afternoon we're open from 5 pm to 8 pm.",
    );
  });

  it("returns only the keys asked for, in a fixed order, each with its own Call created now", () => {
    let n = 0;
    const list = demoSamples(["question", "urgent"], {
      now: thursday,
      shop: lolaSeedProfile,
      pack,
      newId: () => `id-${n++}`,
    });
    expect(list.map((s) => s.key)).toEqual(["urgent", "question"]);
    expect(list.map((s) => s.call.id)).toEqual(["id-0", "id-1"]);
    for (const s of list) {
      expect(s.message.sampleKey).toBe(s.key);
      expect(s.call.channel).toBe("voice");
      expect(s.call.startedAt.toString()).toBe(thursday.toString());
      expect(s.message.modelFailed).toBe(false);
    }
    expect(demoSamples([], { now: thursday, shop: lolaSeedProfile, pack, newId: () => "x" })).toEqual([]);
  });
});
