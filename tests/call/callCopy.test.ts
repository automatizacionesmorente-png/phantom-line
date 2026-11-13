import { describe, expect, it } from "vitest";
import { CALL_COPY } from "@/components/call/callCopy";
import { phrases } from "@/lib/receptionist/phrases";
import { getSectorPack } from "@/lib/sectors";
import { lolaProfile } from "../fixtures/lola";

describe("the transcript label names the assistant the way the greeting does", () => {
  const pack = getSectorPack("hair-salon");

  it("es: 'Asistente virtual', not 'Contestador' (owner's real call, 2026-11-13)", () => {
    expect(CALL_COPY.es.receptionist).toBe("Asistente virtual");
    expect(phrases("es", pack, lolaProfile).greeting().text.toLowerCase()).toContain(CALL_COPY.es.receptionist.toLowerCase());
  });

  it("en: 'Virtual assistant'", () => {
    expect(CALL_COPY.en.receptionist).toBe("Virtual assistant");
    expect(phrases("en", pack, lolaProfile).greeting().text.toLowerCase()).toContain(CALL_COPY.en.receptionist.toLowerCase());
  });
});
