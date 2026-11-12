import { describe, expect, it } from "vitest";
import { splitSentences, toSpokenReply } from "@/lib/receptionist/speech";

describe("toSpokenReply", () => {
  it("leaves a plain short reply as it is", () => {
    expect(toSpokenReply("Entonces, cita de corte el miércoles 11 a las 19:30. ¿Te lo confirmo?")).toBe(
      "Entonces, cita de corte el miércoles 11 a las 19:30. ¿Te lo confirmo?",
    );
  });

  it("strips markdown", () => {
    expect(toSpokenReply("**Claro**, abrimos a las _10:00_. Mira [aquí](https://x.y) o `ya`.")).toBe(
      "Claro, abrimos a las 10:00. Mira aquí o ya.",
    );
    expect(toSpokenReply("# Horario\nAbrimos de martes a sábado.")).toBe("Horario, Abrimos de martes a sábado.");
  });

  it("strips emoji, including joined ones, skin tones and flags", () => {
    expect(toSpokenReply("¡Hola! 😊 Te espero 👩🏽‍🦰 🇪🇸")).toBe("¡Hola! Te espero");
    expect(toSpokenReply("Perfect ✂️ see you!")).toBe("Perfect see you!");
  });

  it("turns a list into one spoken sentence", () => {
    expect(toSpokenReply("Hacemos:\n- corte\n- tinte\n- barba")).toBe("Hacemos: corte, tinte, barba");
    expect(toSpokenReply("Options:\n1. haircut\n2) colour")).toBe("Options: haircut, colour");
  });

  it("removes a list marker that only shows up after other cleanup (S4 counterexample)", () => {
    // S4 found "1⃣. 0": the keycap emoji is stripped after the list check, leaving "1. 0".
    expect(toSpokenReply("1⃣. 0")).toBe("0");
    expect(toSpokenReply("*1. x")).toBe("x");
    expect(toSpokenReply("`1. x")).toBe("x");
    expect(toSpokenReply("? 1. x")).toBe("x");
    expect(toSpokenReply("!. - x")).toBe("x");
    expect(toSpokenReply("1. x")).toBe("x");
    expect(toSpokenReply(toSpokenReply("1⃣. 0"))).toBe("0");
  });

  it("keeps at most two sentences", () => {
    expect(toSpokenReply("Uno. Dos? Tres! Cuatro.")).toBe("Uno. Dos?");
    expect(toSpokenReply("Uno.Dos.Tres.")).toBe("Uno. Dos.");
  });

  it("cuts a sentence over 25 words and keeps its end mark", () => {
    const long = `${Array.from({ length: 30 }, (_, k) => `w${k + 1}`).join(" ")}?`;
    const out = toSpokenReply(long);
    expect(out.split(" ")).toHaveLength(25);
    expect(out.endsWith("w25?")).toBe(true);
  });

  it("does not split a decimal number", () => {
    expect(splitSentences("It costs €15.50 now. Bye.")).toEqual(["It costs €15.50 now.", "Bye."]);
  });

  it("returns an empty string when nothing speakable is left", () => {
    expect(toSpokenReply("🎃👻")).toBe("");
    expect(toSpokenReply("***")).toBe("");
  });
});
