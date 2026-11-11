import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { phrases, type PhraseSet } from "@/lib/receptionist/phrases";
import { formatSlot, formatSlotList } from "@/lib/receptionist/format";
import { getSectorPack } from "@/lib/sectors";
import { lolaProfile } from "../fixtures/lola";

const pack = getSectorPack("hair-salon");
const at = (iso: string) => Temporal.Instant.from(iso);
const t1 = at("2026-11-11T18:30:00Z"); // Wed 11 Nov 19:30 Madrid
const t2 = at("2026-11-11T18:15:00Z");

/** Calls every phrase with sample arguments. */
function render(p: PhraseSet): Record<string, string> {
  return {
    greeting: p.greeting(),
    serviceNotOffered: p.serviceNotOffered("manicura"),
    serviceNotOfferedNull: p.serviceNotOffered(null),
    rejected: p.rejected("outside_hours", at("2026-11-11T20:00:00Z"), [t1, t2]),
    rejectedNone: p.rejected("all_resources_busy", t1, []),
    slotJustTaken: p.slotJustTaken([t2]),
    slotJustTakenNone: p.slotJustTaken([]),
    readBack: p.readBack("haircut", t1),
    booked: p.booked("haircut", t1),
    existingForReschedule: p.existingForReschedule("haircut", t1),
    rescheduleReadBack: p.rescheduleReadBack("haircut", t2),
    rescheduled: p.rescheduled("haircut", t2),
    cancelReadBack: p.cancelReadBack("haircut", t1),
    cancelled: p.cancelled(),
    bookingNotFound: p.bookingNotFound(),
    dontKnow: p.dontKnow(),
    goodbye: p.goodbye(),
    maxTurns: p.maxTurns(),
    fallbackEnd: p.fallbackEnd(),
    fallbackRetry: p.fallbackRetry(),
    rateLimitedStart: p.rateLimitedStart(),
    lineCut: p.lineCut(),
    typeInstead: p.typeInstead(),
    defaultReason: p.owner.defaultReason(),
    agreedBooked: p.owner.agreedBooked("haircut", t1, "chair-1"),
    agreedRescheduled: p.owner.agreedRescheduled("haircut", t1, "chair-2"),
    agreedCancelled: p.owner.agreedCancelled("haircut", t1),
    agreedNothing: p.owner.agreedNothing("quiere saber si hacéis mechas"),
    detailFallback: p.owner.detailFallback(),
    detailAbandoned: p.owner.detailAbandoned(),
    replyBooked: p.owner.replyBooked("Ana", "haircut", t1),
    replyRescheduled: p.owner.replyRescheduled(null, "haircut", t1),
    replyCancelled: p.owner.replyCancelled("Ana"),
    replyCallBack: p.owner.replyCallBack(null),
  };
}

describe("phrases", () => {
  const es = render(phrases("es", pack, lolaProfile));
  const en = render(phrases("en", pack, lolaProfile));

  it("every phrase exists in both languages, non-empty and different", () => {
    expect(Object.keys(es)).toEqual(Object.keys(en));
    for (const key of Object.keys(es)) {
      expect(es[key].trim(), key).not.toBe("");
      expect(en[key].trim(), key).not.toBe("");
      if (key !== "agreedNothing") expect(es[key], key).not.toBe(en[key]);
    }
  });

  it("uses the exact texts of the design", () => {
    expect(es.greeting).toBe(
      "Hola, has llamado a Peluquería Lola. Ahora mismo no pueden atenderte, soy su contestador. ¿En qué te ayudo?",
    );
    expect(es.fallbackEnd).toBe("Perdona, ahora mismo no puedo atenderte bien. Le dejo tu mensaje a Lola y te llamará.");
    expect(en.fallbackEnd).toBe("Sorry, I can't help properly right now. I'll leave your message for Lola and she'll call you back.");
    expect(es.fallbackRetry).toBe("Perdona, no te he entendido. ¿Me lo repites? Si prefieres, se lo dejo apuntado a Lola.");
    expect(en.fallbackRetry).toBe("Sorry, I didn't catch that. Could you say it again? Or I can leave a note for Lola.");
    expect(es.serviceNotOffered).toBe("No hacemos manicura. Hacemos corte, tinte y barba.");
    expect(es.dontKnow).toBe("Eso no lo sé, pero se lo dejo apuntado a Lola para que te llame.");
  });

  it("the read-back says day, time and service; the rejection lists the alternatives", () => {
    expect(es.readBack).toBe("Entonces, cita de corte el miércoles 11 a las 19:30. ¿Te lo confirmo?");
    expect(en.readBack).toBe("So, a haircut appointment on Wednesday the 11th at 7:30 pm. Shall I confirm it?");
    expect(es.rejected).toBe(
      "El miércoles 11 a las 21:00 no es posible, a esa hora está cerrado. Tengo libre el miércoles 11 a las 19:30 o a las 19:15.",
    );
    expect(es.booked).toContain("Lola verá tu mensaje y te confirma");
    expect(es.agreedBooked).toBe("Cita de corte el miércoles 11 a las 19:30 (Sillón 1)");
    expect(es.replyBooked).toBe("Hola Ana, te confirmo tu cita de corte el miércoles 11 a las 19:30. ¡Hasta pronto! Lola");
  });

  it("the hair salon never says mesa or table", () => {
    for (const v of Object.values(es)) expect(v.toLowerCase()).not.toMatch(/\bmesas?\b/);
    for (const v of Object.values(en)) expect(v.toLowerCase()).not.toMatch(/\btables?\b/);
  });

  it("no phrase reveals whether a booking exists: one not-found line, with no date or service", () => {
    expect(es.bookingNotFound).not.toMatch(/\d|corte|tinte|barba/);
    expect(en.bookingNotFound).not.toMatch(/\d|haircut|colour|beard/);
  });
});

describe("formatSlot", () => {
  it("formats in the shop's zone, in both languages", () => {
    expect(formatSlot(t1, "Europe/Madrid", "es")).toBe("el miércoles 11 a las 19:30");
    expect(formatSlot(t1, "Europe/Madrid", "en")).toBe("Wednesday the 11th at 7:30 pm");
    expect(formatSlot(at("2026-11-12T09:00:00Z"), "Europe/Madrid", "en")).toBe("Thursday the 12th at 10 am");
  });
  it("a list on one day says the day once", () => {
    expect(formatSlotList([t1, t2, at("2026-11-11T18:00:00Z")], "Europe/Madrid", "es")).toBe(
      "el miércoles 11 a las 19:30, a las 19:15 o a las 19:00",
    );
  });
});
