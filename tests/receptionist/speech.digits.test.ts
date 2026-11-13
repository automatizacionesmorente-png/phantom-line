import { describe, expect, it } from "vitest";
import { digitsToWords, splitSentences, toSpokenReply } from "@/lib/receptionist/speech";

/** natural-voice 7.2: the safety net in toSpokenReply(text, lang). Exact strings. */
describe("toSpokenReply with a language: times", () => {
  it("converts 24-hour times, with the period always said", () => {
    expect(toSpokenReply("Te espero a las 17:15.", "es")).toBe("Te espero a las cinco y cuarto de la tarde.");
    expect(toSpokenReply("Te espero a las 17:15h.", "es")).toBe("Te espero a las cinco y cuarto de la tarde.");
    expect(toSpokenReply("Te espero a las 17:15 h.", "es")).toBe("Te espero a las cinco y cuarto de la tarde.");
    expect(toSpokenReply("Te espero a las 17:15 horas.", "es")).toBe("Te espero a las cinco y cuarto de la tarde.");
    expect(toSpokenReply("Te espero a las 17.15h.", "es")).toBe("Te espero a las cinco y cuarto de la tarde.");
    expect(toSpokenReply("See you at 19:30.", "en")).toBe("See you at half past seven in the evening.");
    expect(toSpokenReply("A las 21:00 ya hemos cerrado.", "es")).toBe("A las nueve de la noche ya hemos cerrado.");
    expect(toSpokenReply("Abrimos a las 12:00.", "es")).toBe("Abrimos a las doce del mediodía.");
    expect(toSpokenReply("We open at 00:00.", "en")).toBe("We open at midnight.");
  });

  it("keeps the article when the text has no preposition", () => {
    expect(toSpokenReply("Abrimos de 10:00 a 14:00.", "es")).toBe(
      "Abrimos de las diez de la mañana a las dos de la tarde.",
    );
    expect(toSpokenReply("17:00 está bien.", "es")).toBe("Las cinco de la tarde está bien.");
    expect(toSpokenReply("We are open from 10:00 to 14:00.", "en")).toBe(
      "We are open from ten in the morning to two in the afternoon.",
    );
  });

  it("reads a stated period of the day and does not repeat it (owner's call, 2026-11-13)", () => {
    expect(toSpokenReply("Quieres ir a las 4:00 de la tarde.", "es")).toBe("Quieres ir a las cuatro de la tarde.");
    expect(toSpokenReply("Quieres ir a las 4 de la tarde.", "es")).toBe("Quieres ir a las cuatro de la tarde.");
    expect(toSpokenReply("At 5:30 pm, then.", "en")).toBe("At half past five in the afternoon, then.");
    expect(toSpokenReply("At 9 a.m. sharp.", "en")).toBe("At nine in the morning sharp.");
    expect(toSpokenReply("At 12 am.", "en")).toBe("At midnight.");
    expect(toSpokenReply("At 9 a.m.", "en")).toBe("At nine in the morning.");
    expect(toSpokenReply("At 9 a.m. Then we close.", "en")).toBe("At nine in the morning. Then we close.");
  });

  it("says a bare hour after 'a las' (owner's call: 'no a las 17')", () => {
    expect(toSpokenReply("Vale, a las 17.", "es")).toBe("Vale, a las cinco de la tarde.");
    expect(toSpokenReply("Vale, a las 17h.", "es")).toBe("Vale, a las cinco de la tarde.");
    expect(toSpokenReply("Vale, a la 1.", "es")).toBe("Vale, a la una.");
  });

  it("does not invent a period for an hour that could be morning or afternoon", () => {
    expect(toSpokenReply("Vale, a las 4.", "es")).toBe("Vale, a las cuatro.");
    expect(toSpokenReply("Vale, a las 4:30.", "es")).toBe("Vale, a las cuatro y media.");
    expect(toSpokenReply("Okay, at 5.", "en")).toBe("Okay, at five.");
    // Written with two digits or a leading zero, it is a 24-hour time.
    expect(toSpokenReply("Vale, a las 10:00.", "es")).toBe("Vale, a las diez de la mañana.");
    expect(toSpokenReply("Vale, a las 04:00.", "es")).toBe("Vale, a las cuatro de la noche.");
  });

  it("does not take a number or a duration for a time", () => {
    expect(toSpokenReply("Son 2 horas.", "es")).toBe("Son dos horas.");
    expect(toSpokenReply("Tengo las 3 opciones.", "es")).toBe("Tengo las tres opciones.");
    expect(toSpokenReply("Va a 3 sitios.", "es")).toBe("Va a tres sitios.");
  });
});

describe("toSpokenReply with a language: prices, phones, ordinals, numbers", () => {
  it("converts prices", () => {
    expect(toSpokenReply("El tinte cuesta 45 €.", "es")).toBe("El tinte cuesta cuarenta y cinco euros.");
    expect(toSpokenReply("El tinte cuesta 45€.", "es")).toBe("El tinte cuesta cuarenta y cinco euros.");
    expect(toSpokenReply("Cuesta 15,50 €.", "es")).toBe("Cuesta quince euros con cincuenta.");
    expect(toSpokenReply("Cuesta 15 euros.", "es")).toBe("Cuesta quince euros.");
    expect(toSpokenReply("Cuesta 1 euro.", "es")).toBe("Cuesta un euro.");
    expect(toSpokenReply("Cuesta 21 €.", "es")).toBe("Cuesta veintiún euros.");
    expect(toSpokenReply("Cuesta 1.500 €.", "es")).toBe("Cuesta mil quinientos euros.");
    expect(toSpokenReply("A colour is €45.", "en")).toBe("A colour is forty-five euros.");
    expect(toSpokenReply("A haircut is €15.50.", "en")).toBe("A haircut is fifteen euros fifty.");
    expect(toSpokenReply("A haircut is € 15.", "en")).toBe("A haircut is fifteen euros.");
  });

  it("reads long digit runs one by one, in groups", () => {
    expect(toSpokenReply("Tu teléfono es el 612 345 678.", "es")).toBe(
      "Tu teléfono es el seis, uno, dos; tres, cuatro, cinco; seis, siete, ocho.",
    );
    expect(toSpokenReply("Tu teléfono es el 612345678.", "es")).toBe(
      "Tu teléfono es el seis, uno, dos; tres, cuatro, cinco; seis, siete, ocho.",
    );
    expect(toSpokenReply("Your number is +34 612 345 678.", "en")).toBe(
      "Your number is six, one, two; three, four, five; six, seven, eight.",
    );
  });

  it("converts ordinals", () => {
    expect(toSpokenReply("Saturday the 14th.", "en")).toBe("Saturday the fourteenth.");
    expect(toSpokenReply("On the 1st and the 22nd.", "en")).toBe("On the first and the twenty-second.");
    expect(toSpokenReply("Es tu 1ª visita.", "es")).toBe("Es tu primera visita.");
    expect(toSpokenReply("Es tu 2.º corte.", "es")).toBe("Es tu segundo corte.");
  });

  it("converts any other number", () => {
    expect(toSpokenReply("El sábado 14 tenemos 2 sillones.", "es")).toBe("El sábado catorce tenemos dos sillones.");
    expect(toSpokenReply("It takes 90 minutes.", "en")).toBe("It takes ninety minutes.");
    expect(toSpokenReply("Es el 2,5.", "es")).toBe("Es el dos coma cinco.");
    expect(toSpokenReply("It is 2.5.", "en")).toBe("It is two point five.");
    expect(toSpokenReply("Código 007.", "es")).toBe("Código cero, cero, siete.");
    expect(toSpokenReply("abc123def", "es")).toBe("abc ciento veintitrés def");
  });

  it("converts the owner's real reply of 2026-11-13 with no digit left", () => {
    const reply = toSpokenReply(
      "El sábado 14 a las 16:00 no es posible, a esa hora está cerrado. Tengo libre el sábado 14 a las 17:00, a las 17:15 o a las 17:30.",
      "es",
    );
    // Times in a row that share a period say it once, after the last; with it after
    // each one the sentence has 28 words and the 25-word limit would cut the last period.
    expect(reply).toBe(
      "El sábado catorce a las cuatro de la tarde no es posible, a esa hora está cerrado. Tengo libre el sábado catorce a las cinco, a las cinco y cuarto o a las cinco y media de la tarde.",
    );
    expect(reply).not.toMatch(/\d/);
    for (const sentence of splitSentences(reply)) expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(25);
    expect(toSpokenReply("Perfecto, te anoto a las 17:00. ¿Cuál es tu nombre?", "es")).toBe(
      "Perfecto, te anoto a las cinco de la tarde. ¿Cuál es tu nombre?",
    );
  });

  it("says a shared period once, and never shares noon, midnight or different periods", () => {
    expect(toSpokenReply("Abrimos de 17:00 a 20:00.", "es")).toBe("Abrimos de las cinco a las ocho de la tarde.");
    expect(toSpokenReply("Tengo a las 19:00 o a las 21:00.", "es")).toBe(
      "Tengo a las siete de la tarde o a las nueve de la noche.",
    );
    expect(toSpokenReply("Tengo a las 12:00 o a las 13:00.", "es")).toBe(
      "Tengo a las doce del mediodía o a la una del mediodía.",
    );
    expect(toSpokenReply("I have 17:00, 17:15 or 17:30.", "en")).toBe(
      "I have five, quarter past five or half past five in the afternoon.",
    );
    // Two times in different sentences each keep their own period.
    expect(toSpokenReply("A las 17:00. Y a las 17:30.", "es")).toBe(
      "A las cinco de la tarde. Y a las cinco y media de la tarde.",
    );
  });

  it("leaves text with no digits unchanged, and without a language changes nothing", () => {
    const plain = "Genial, mañana a las cinco tengo hueco. ¿Me dices tu nombre?";
    expect(toSpokenReply(plain, "es")).toBe(plain);
    expect(digitsToWords(plain, "es")).toBe(plain);
    expect(toSpokenReply("Abrimos a las 10:00.")).toBe("Abrimos a las 10:00.");
  });

  it("keeps the template limit of 3 sentences when asked", () => {
    expect(toSpokenReply("Uno. Dos. Tres. Cuatro.", "es", { maxSentences: 3 })).toBe("Uno. Dos. Tres.");
    expect(toSpokenReply("Uno. Dos. Tres. Cuatro.", "es")).toBe("Uno. Dos.");
  });
});
