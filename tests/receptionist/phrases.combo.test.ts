import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { toInstant } from "@/lib/booking";
import { publicStateOf } from "@/lib/conversation/decide";
import { ShopProfileSchema } from "@/lib/conversation/shopProfile";
import { initialCallState } from "@/lib/conversation/types";
import { phrases } from "@/lib/receptionist/phrases";
import { getSectorPack } from "@/lib/sectors";
import { lolaProfile } from "../fixtures/lola";

/**
 * front-desk-brain 4.3: the phrase book and `publicStateOf` name a Service_Combo through
 * `serviceView`. The V1_Profile's own lines are pinned by the existing phrase tests, which run
 * unchanged; these cover what is new.
 */

const pack = getSectorPack("hair-salon");
const shop = ShopProfileSchema.parse({
  ...lolaProfile,
  services: [
    ...lolaProfile.services,
    { id: "fade", name: { es: "degradado", en: "fade" }, durationMin: 20, priceCents: 400, spokenName: { es: "un degradado", en: "a fade" }, addOnTo: ["haircut"] },
    { id: "balayage", name: { es: "balayage", en: "balayage" }, durationMin: 180, priceCents: 8500, spokenName: { es: "un balayage", en: "a balayage" }, priceFrom: true },
  ],
});
const start = toInstant(Temporal.PlainDate.from("2026-11-17"), Temporal.PlainTime.from("10:00"), "Europe/Madrid");

describe("serviceInfo", () => {
  it("a Service_Combo names every part and says the totals with 'son' / 'take … cost'", () => {
    expect(phrases("es", pack, shop).serviceInfo("haircut+fade").text).toBe(
      "Claro, un corte y un degradado son cincuenta minutos y diecinueve euros.",
    );
    expect(phrases("en", pack, shop).serviceInfo("haircut+fade").text).toBe(
      "Sure, a haircut and a fade take fifty minutes and cost nineteen euros.",
    );
  });

  it("a starting price is said 'desde' / 'from', on its own and inside a Service_Combo", () => {
    expect(phrases("es", pack, shop).serviceInfo("balayage").text).toMatch(/ y cuesta desde ochenta y cinco euros\.$/);
    expect(phrases("en", pack, shop).serviceInfo("balayage").text).toMatch(/ and costs from eighty-?five euros\.$/);
    expect(phrases("es", pack, shop).serviceInfo("haircut+balayage").text).toContain(" y desde cien euros.");
  });

  it("a single service without a starting price reads exactly as before", () => {
    expect(phrases("es", pack, lolaProfile).serviceInfo("haircut").text).toBe(
      "Claro, un corte dura media hora y cuesta quince euros.",
    );
  });

  it("an unknown id or a broken Combo_Id says only 'Claro.' / 'Sure.'", () => {
    expect(phrases("es", pack, shop).serviceInfo("fade+haircut").text).toBe("Claro.");
    expect(phrases("en", pack, shop).serviceInfo("perm").text).toBe("Sure.");
  });
});

describe("the other templates name a Service_Combo by its parts", () => {
  it("read-back, reschedule and cancel lines (spoken), and the Owner's texts (written)", () => {
    const es = phrases("es", pack, shop);
    expect(es.readBack("haircut+fade", start, "Ana", "+34612345678").text).toContain("Te apunto un corte y un degradado ");
    expect(es.cancelReadBack("haircut+fade", start).text).toContain("Tienes un corte y un degradado ");
    expect(es.owner.agreedBooked("haircut+fade", start, "chair-1")).toBe("Cita de corte + degradado el martes 17 a las 10:00 (Sillón 1)");
    const en = phrases("en", pack, shop);
    expect(en.existingForReschedule("haircut+colour", start).text).toContain("you have a haircut and a colour ");
    expect(en.owner.replyBooked("Ann", "haircut+fade", start)).toContain("your haircut + fade appointment on");
  });

  it("no line ever contains a raw Combo_Id", () => {
    const es = phrases("es", pack, shop);
    const lines = [
      es.serviceInfo("haircut+fade").text,
      es.readBack("haircut+fade", start, "Ana", "+34612345678").text,
      es.booked("haircut+fade", start).text,
      es.owner.agreedCancelled("haircut+fade", start),
    ];
    for (const line of lines) expect(line).not.toMatch(/[a-z]\+[a-z]/);
  });
});

describe("publicStateOf", () => {
  const state = (serviceId: string | undefined) => ({
    ...initialCallState("es"),
    fields: serviceId === undefined ? {} : { serviceId },
  });

  it("shows a Service_Combo by its parts in the Call's language", () => {
    expect(publicStateOf(state("haircut+fade"), shop, false).fields.service).toBe("corte + degradado");
    expect(publicStateOf({ ...state("haircut+fade"), language: "en" }, shop, false).fields.service).toBe("haircut + fade");
  });

  it("a catalog service as before, and nothing for an id outside the catalog", () => {
    expect(publicStateOf(state("colour"), shop, false).fields.service).toBe("tinte");
    expect(publicStateOf(state("perm"), shop, false).fields.service).toBeNull();
    expect(publicStateOf(state(undefined), shop, false).fields.service).toBeNull();
  });
});
