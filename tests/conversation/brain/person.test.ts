import { describe, expect, it } from "vitest";
import { readName, readPhone, type NameOptions } from "@/lib/conversation/brain/person";

/** Name and phone reading (front-desk-brain 6.1–6.5). */
const base: NameOptions = { expectName: false, ownerName: "Lola", shopName: "Peluquería Lola" };
const name = (text: string, opts: Partial<NameOptions> = {}) => readName(text, { ...base, ...opts })?.name ?? null;
const TZ = "Europe/Madrid";

describe("readName", () => {
  it.each([
    ["me llamo Ana", "Ana"],
    ["Me llamo María del Carmen Pérez", "María del Carmen Pérez"],
    ["soy Luis García", "Luis García"],
    ["mi nombre es Ana López", "Ana López"],
    ["a nombre de Pedro", "Pedro"],
    ["soy Ana y mi teléfono es 612 34 56 78", "Ana"],
    ["me llamo Ana, y quería una cita", "Ana"],
    ["soy Ana quería un corte", "Ana"],
    ["my name is John Smith", "John Smith"],
    ["I'm Sarah", "Sarah"],
    ["it's Tom", "Tom"],
    ["this is Emma Brown", "Emma Brown"],
    ["under Smith", "Smith"],
    ["Me llamo José Antonio Ruiz de la Fuente García", "José Antonio Ruiz"], // 5 words, then the trailing "de la" is dropped
  ])("reads %j as %j after a cue (6.1)", (said, expected) => {
    expect(name(said)).toBe(expected);
  });

  it.each(["soy de Madrid", "I'm calling to book", "it's for tomorrow", "soy yo", "me llamo cariño"])(
    "reads no name in %j",
    (said) => {
      expect(name(said)).toBeNull();
    },
  );

  it("takes a short utterance with no cue as the name only while the name is next (6.2)", () => {
    expect(name("Ana García")).toBeNull();
    expect(name("Ana García", { expectName: true })).toBe("Ana García");
    expect(name("pues Ana", { expectName: true })).toBe("Ana");
    expect(name("Ana, gracias", { expectName: true })).toBe("Ana");
    for (const not of ["sí", "vale", "no", "mañana", "cinco", "corte de hombre", "quiero una cita", "un tinte"])
      expect(name(not, { expectName: true, isShopWord: (w) => ["corte", "hombre", "tinte"].includes(w) }), not).toBeNull();
  });

  it("never takes the owner's or the shop's name when it is only addressed (6.3)", () => {
    expect(name("Hola Lola, quería un corte")).toBeNull();
    expect(name("Hola Lola, quería un corte", { expectName: true })).toBeNull();
    expect(name("Lola", { expectName: true })).toBeNull();
    expect(name("¿es Peluquería Lola?", { expectName: true })).toBeNull();
  });
});

describe("readPhone (6.4, 6.5)", () => {
  it.each([
    ["612 34 56 78", "+34612345678"],
    ["612-345-678", "+34612345678"],
    ["612.345.678", "+34612345678"],
    ["+34 612 345 678", "+34612345678"],
    ["0034 612 345 678", "+34612345678"],
    ["mi teléfono es el 612345678", "+34612345678"],
    ["seis uno dos, treinta y cuatro, cincuenta y seis, setenta y ocho", "+34612345678"],
    ["seiscientos doce, trescientos cuarenta y cinco, seiscientos setenta y ocho", "+34612345678"],
    ["seis uno dos tres cuatro cinco seis siete ocho", "+34612345678"],
    ["más treinta y cuatro seis uno dos tres cuatro cinco seis siete ocho", "+34612345678"],
    ["nine one two, three four five, six seven eight", "+34912345678"],
    ["six one two thirty four fifty six seventy eight", "+34612345678"],
    ["seis cero cinco, cero cero, doce, treinta y cuatro", "+34605001234"],
  ])("reads %j as %s", (said, phone) => {
    expect(readPhone(said, TZ)).toMatchObject({ phone, rejected: false });
  });

  it("flags digits that normalizePhone refuses, and reads nothing from short numbers", () => {
    expect(readPhone("512 34 56 78", TZ)).toMatchObject({ phone: null, rejected: true });
    expect(readPhone("cinco uno dos tres cuatro cinco seis siete", TZ)).toMatchObject({ phone: null, rejected: true });
    expect(readPhone("a las 5", TZ)).toMatchObject({ phone: null, rejected: false });
    expect(readPhone("son 25 euros", TZ)).toMatchObject({ phone: null, rejected: false });
    expect(readPhone("el 20 de noviembre a las 17:30", TZ)).toMatchObject({ phone: null, rejected: false });
  });
});
