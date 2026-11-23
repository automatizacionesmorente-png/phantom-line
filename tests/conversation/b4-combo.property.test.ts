import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { comboId } from "@/lib/booking";
import { matchServices, serviceIndex } from "@/lib/conversation/brain/services";
import { phraseKey } from "@/lib/conversation/brain/normalize";
import { lolaSeedProfile } from "@/lib/db/seed";
import { speakDuration, speakPrice } from "@/lib/receptionist/spoken";
import { brainCall, SAT_1930 } from "./brainCall";

/**
 * B4. Two or three services in one sentence make one Service_Combo (front-desk-brain 7.1, 7.3, 7.5,
 * 4.7). For lists of 2–3 different Rich_Profile services, each named by an alias only it has, or by
 * a shared alias that Goes_With decides; joiners; orders: `matchServices` returns exactly that set;
 * `comboId` of any order is the same string; with no model (the brain path), the reply is a
 * First_Offer stating the summed duration and price ("desde" iff a part is priced "from"); and
 * accepting it, a name, a phone and a yes write one booking with that Combo_Id lasting the sum.
 *
 * The oracle sums the profile's own numbers here; it never calls `serviceView` or `resolveService`.
 */
const shop = lolaSeedProfile;
const byId = new Map(shop.services.map((s) => [s.id, s]));
/** The morning session (10:00–14:00) is the longest: a combination must fit it to have any slot. */
const SESSION_MIN = 240;

/** Aliases that only one service has, and that hold no other service's whole alias (so the said set is exact). */
const owners = (() => {
  const index = serviceIndex(shop);
  const map = new Map<string, Set<string>>();
  for (const e of index.entries) if (e.value.kind === "services") for (const id of e.value.ids) map.set(e.words.join(" "), new Set([...(map.get(e.words.join(" ")) ?? []), id]));
  return map;
})();
const ownAliases = (() => {
  const all = [...owners.keys()];
  const out = new Map<string, string[]>();
  for (const s of shop.services) {
    const mine = (s.aliases ?? [])
      .filter((a) => owners.get(phraseKey(a))?.size === 1)
      // No other entry may sit inside it, or the longest-match rule and the lexicon could read more.
      .filter((a) => {
        const key = ` ${phraseKey(a)} `;
        return !all.some((o) => o !== phraseKey(a) && key.includes(` ${o} `) && !(owners.get(o)?.has(s.id) ?? false));
      });
    if (mine.length > 0) out.set(s.id, mine);
  }
  return out;
})();

/** Lists of 2–3 different services that fit one session; an Add_On always comes with its base (4.10). */
const arbIds = fc
  .uniqueArray(fc.constantFrom(...[...ownAliases.keys()]), { minLength: 2, maxLength: 3 })
  .filter((ids) => ids.every((id) => (byId.get(id)!.addOnTo ?? []).length === 0 || ids.some((b) => byId.get(id)!.addOnTo!.includes(b))))
  .filter((ids) => ids.reduce((sum, id) => sum + byId.get(id)!.durationMin, 0) <= SESSION_MIN);

/** The shared generic cut aliases, said for the men's cut next to a service it goes with (5(b)). */
const SHARED_CUT = ["cortarme el pelo", "un corte", "corte de pelo"];
const JOINERS = { es: [" y ", ", ", " con ", " y también "], en: [" and ", " with ", " plus ", ", "] } as const;
const FRAMES = { es: ["quería {x}", "Hola, quiero {x}", "me gustaría {x}"], en: ["I'd like {x}", "Hi, can I book {x}", "I want {x}"] } as const;

const arbRaw = fc.record({
  ids: arbIds,
  lang: fc.constantFrom("es" as const, "en" as const),
  order: fc.array(fc.nat(), { minLength: 3, maxLength: 3 }),
  pick: fc.array(fc.nat(), { minLength: 3, maxLength: 3 }),
  joiner: fc.nat(),
  frame: fc.nat(),
  shared: fc.nat(),
  useShared: fc.boolean(),
});

function toCase(g: typeof arbRaw extends fc.Arbitrary<infer T> ? T : never) {
    // Any order: the Combo_Id must not depend on it (7.3).
    const said = [...g.ids].sort((a, b) => (g.order[g.ids.indexOf(a)] % 7) - (g.order[g.ids.indexOf(b)] % 7) || a.localeCompare(b));
    const partner = said.some((id) => (byId.get("corte-hombre")!.goesWith ?? []).includes(id));
    const sharedWord = SHARED_CUT[g.shared % SHARED_CUT.length];
    // Generator fix (front-desk-brain task 9, seed -27447435): the shared cut word is said for the
    // men's cut only when no other service that shares it is in the list. "quería barba, cortarme
    // el pelo y corte de mujer" names one cut, read by tie rule 5(c) as the women's cut the caller
    // also named, so the set {barba, corte-hombre, corte-mujer} was never said. The assertions and
    // numRuns did not change.
    // Second generator fix (23 Nov 2026): the index drops a leading article ("un corte" is the entry
    // "corte"), so the lookup also tries the word without it; before, "quería barba, un corte y corte
    // de mujer" was generated and read, rightly, as one cut.
    const sharers = owners.get(phraseKey(sharedWord)) ?? owners.get(phraseKey(sharedWord).replace(/^(un|una|el|la|a) /, ""));
    const sharedFree = !said.some((id) => id !== "corte-hombre" && (sharers?.has(id) ?? false));
    const phrases = said.map((id, k) => {
      if (id === "corte-hombre" && g.useShared && partner && sharedFree) return sharedWord;
      const own = ownAliases.get(id)!;
      return own[g.pick[k] % own.length];
    });
    const joiner = JOINERS[g.lang][g.joiner % JOINERS[g.lang].length];
    const list = phrases.length === 2 ? phrases.join(joiner) : `${phrases[0]}, ${phrases[1]}${joiner}${phrases[2]}`;
    const frame = FRAMES[g.lang][g.frame % FRAMES[g.lang].length];
    return { ...g, said, phrases, utterance: frame.replace("{x}", list), sharedUsed: phrases.some((p) => SHARED_CUT.includes(p)) };
}
const arbCase = arbRaw.map(toCase);

/**
 * A fixed case for the rare "shared cut word" branch. After the task-9 generator fix it needs the
 * men's cut, a Goes_With partner, `useShared` and no other service sharing the word, so 100 random
 * runs missed it in about half of the suite runs (task 17's full run, then 2 of 4 runs of this file
 * alone), and the "reached" check failed with nothing wrong. fast-check 4.10.2 counts `examples`
 * inside `numRuns`, so the property runs 101: the design's 100 random runs plus this one.
 */
const SHARED_EXAMPLE = toCase({ ids: ["corte-hombre", "barba"], lang: "es", order: [0, 1, 2], pick: [0, 0, 0], joiner: 0, frame: 0, shared: 0, useShared: true });

describe("B4: two or three services in one sentence make one Service_Combo", () => {
  it("one set, one Combo_Id, one First_Offer with the totals, one booking of the summed length", { timeout: 180_000 }, () => {
    const reached = { two: 0, three: 0, shared: 0, from: 0, plain: 0, es: 0, en: 0 };
    fc.assert(
      fc.property(arbCase, (c) => {
        // The matcher returns exactly that set, in said order.
        const m = matchServices(c.utterance, shop);
        expect(m.request.kind === "set" && [...m.request.ids].sort()).toEqual([...c.said].sort());

        // The Combo_Id is the same in any order, and lists the parts in catalog order (7.3).
        const id = comboId(c.said, shop.services);
        expect(comboId([...c.said].reverse(), shop.services)).toBe(id);
        const catalogOrder = shop.services.map((s) => s.id).filter((s) => c.said.includes(s)).join("+");
        expect(id).toBe(catalogOrder);

        // The totals, from the profile's own numbers.
        const parts = c.said.map((x) => byId.get(x)!);
        const minutes = parts.reduce((sum, p) => sum + p.durationMin, 0);
        const cents = parts.reduce((sum, p) => sum + p.priceCents, 0);
        const from = parts.some((p) => p.priceFrom === true);

        const turns = brainCall([c.utterance, c.lang === "es" ? "sí" : "yes", c.lang === "es" ? "Me llamo Ana" : "My name is Ann", "612 345 678", c.lang === "es" ? "sí" : "yes"], {
          shop,
          now: SAT_1930,
          lang: c.lang,
        });
        const first = turns[0].decision;
        expect(first.state.fields.serviceId).toBe(id);
        expect(first.state.offerKind).toBe("first");
        expect(first.reply).toContain(speakDuration(minutes, c.lang));
        const price = speakPrice(cents, c.lang);
        expect(first.reply).toContain(price);
        const fromWord = c.lang === "es" ? "desde" : "from";
        expect(first.reply.includes(`${fromWord} ${price}`)).toBe(from);

        // Accept, name, phone, yes: one booking with the Combo_Id, lasting the sum (7.1, 7.4).
        const last = turns.at(-1)!.decision;
        const created = turns.flatMap((t) => t.decision.effects.filter((e) => e.type === "createBooking"));
        expect(created).toHaveLength(1);
        const e = created[0];
        expect(e.type === "createBooking" && e.serviceId).toBe(id);
        expect(e.type === "createBooking" && e.verdict.start.until(e.verdict.end).total("minutes")).toBe(minutes);
        expect(e.type === "createBooking" && e.verdict.start.toString()).toBe(first.state.lastOffer![0]);
        expect([last.complete, last.outcome]).toEqual([true, "booked"]);

        reached[c.said.length === 2 ? "two" : "three"]++;
        if (c.sharedUsed) reached.shared++;
        reached[from ? "from" : "plain"]++;
        reached[c.lang]++;
      }),
      { numRuns: 101, examples: [[SHARED_EXAMPLE]] },
    );
    expect(SHARED_EXAMPLE.sharedUsed).toBe(true);
    for (const [k, n] of Object.entries(reached)) expect(n, k).toBeGreaterThan(0);
  });
});
