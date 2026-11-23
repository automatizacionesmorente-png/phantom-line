import { describe, expect, it } from "vitest";
import { brainCall, SAT_1930 } from "./brainCall";
import { lolaSeedProfile as shop } from "@/lib/db/seed";

// Found on the deployed demo on 23 Nov 2026: "a men's haircut" was read as a bare "haircut",
// so the receptionist asked "women's, men's or kids'?" again and again. (Written by Claude.)
const firstReply = (lines: string[], lang: "es" | "en") => {
  const turns = brainCall(lines, { shop, now: SAT_1930, lang });
  return { last: turns[turns.length - 1], turns };
};

describe("English cut requests name the cut on the first turn", () => {
  it.each([
    ["Hi, I'd like a men's haircut on Friday afternoon", "corte-hombre"],
    ["I'd like a women's haircut", "corte-mujer"],
    ["a ladies' haircut please", "corte-mujer"],
    ["a haircut for my son please", "corte-infantil"],
    ["a haircut for a man", "corte-hombre"],
  ])("%s", (line, id) => {
    const { last } = firstReply([line], "en");
    expect(last.reading.services).toMatchObject({ kind: "set", ids: [id] });
    expect(last.decision.state.fields.serviceChoice).toBeUndefined();
  });
});

describe("a short answer settles the cut choice", () => {
  it.each([
    [["I'd like a haircut", "men's"], "en", "corte-hombre"],
    [["I'd like a haircut", "for a man"], "en", "corte-hombre"],
    [["I'd like a haircut", "for me, I'm a woman"], "en", "corte-mujer"],
    [["quería cortarme el pelo", "de hombre"], "es", "corte-hombre"],
  ] as const)("%j", (lines, lang, id) => {
    const { turns } = firstReply([...lines], lang);
    expect(turns[0].reading.services.kind).toBe("choice");
    expect(turns[1].decision.state.fields.serviceId).toBe(id);
  });
});
