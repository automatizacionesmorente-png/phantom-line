import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { comboId } from "@/lib/booking";
import { phraseKey } from "@/lib/conversation/brain/normalize";
import { matchServices, MAX_SERVICES } from "@/lib/conversation/brain/services";
import { matchTopic } from "@/lib/conversation/brain/topics";
import { toShopRules, type ShopService } from "@/lib/conversation/shopProfile";
import { lolaSeedProfile } from "@/lib/db/seed";
import { getSectorPack } from "@/lib/sectors";
import { arbAliasVariant } from "./arbitraries";

/**
 * B3 (matcher part) and B13 of front-desk-brain design.md, on the Rich_Profile.
 * The oracles read the profile directly, never through the matcher's index.
 */
const shop = lolaSeedProfile;
const pack = getSectorPack(shop.sectorPackId);
const rules = toShopRules(shop).services;
const NUM_RUNS = 200;
const byId = new Map(shop.services.map((s) => [s.id, s]));

/** Every word a Caller may use for a service: both names and the aliases (the oracle's own list). */
const saidFormsOf = (s: ShopService) => [s.name.es, s.name.en, ...(s.aliases ?? [])];
/** The services that list the same alias, after normalization. */
function sharing(alias: string): string[] {
  const k = phraseKey(alias);
  return shop.services.filter((s) => saidFormsOf(s).some((a) => phraseKey(a) === k)).map((s) => s.id);
}
/** The Add_On rule written its own way: an Add_On alone brings its first base before it. */
function withBase(ids: readonly string[], also: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const bases = byId.get(id)?.addOnTo ?? [];
    if (bases.length > 0 && !bases.some((b) => ids.includes(b) || also.includes(b) || out.includes(b))) out.push(bases[0]);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

const PAIRS = shop.services.flatMap((s) => saidFormsOf(s).map((alias) => ({ id: s.id, alias })));

type FrameKind = "question" | "booking" | "price" | "duration" | "addition";
const FRAMES: { kind: FrameKind; text: (x: string) => string }[] = [
  { kind: "question", text: (x) => `oye, ¿${x}?` },
  { kind: "booking", text: (x) => `quería ${x}` },
  { kind: "booking", text: (x) => `I'd like ${x}, please` },
  { kind: "price", text: (x) => `¿cuánto cuesta ${x}?` },
  { kind: "price", text: (x) => `how much is ${x}?` },
  { kind: "duration", text: (x) => `how long does ${x} take?` },
  { kind: "duration", text: (x) => `¿cuánto tarda ${x}?` },
  { kind: "addition", text: (x) => `y también ${x}` },
];

describe("B3. Every service alias is found (matcher part)", () => {
  it("returns the service, or exactly the Service_Choice of the services that share the alias (4.1–4.4, 4.10)", () => {
    const seen = { typo: 0, shared: 0, addOn: 0, single: 0, price: 0, duration: 0, es: 0, en: 0 };
    fc.assert(
      fc.property(
        fc.constantFrom(...PAIRS).chain((p) => fc.tuple(fc.constant(p), arbAliasVariant(p.alias, shop), fc.constantFrom(...FRAMES))),
        ([{ id, alias }, variant, frame]) => {
          const text = frame.text(variant.text);
          const share = sharing(alias);
          const m = matchServices(text, shop);
          if (variant.typo) seen.typo++;
          if (frame.text("x").includes("¿") || frame.text("x").startsWith("quer") || frame.text("x").startsWith("y ")) seen.es++;
          else seen.en++;
          if (share.length > 1) {
            seen.shared++;
            expect(m.request, text).toEqual({ kind: "choice", candidates: share, with: [] });
          } else {
            expect(share, alias).toEqual([id]);
            const expected = withBase([id]);
            if (expected.length > 1) seen.addOn++;
            else seen.single++;
            expect(m.request.kind, text).toBe("set");
            expect(m.next, text).toEqual(expected);
          }
          if (frame.kind === "price" || frame.kind === "duration") {
            seen[frame.kind]++;
            const t = matchTopic(text, shop, { lang: frame.text("x").includes("¿") ? "es" : "en", pack }).topic;
            const target =
              share.length > 1
                ? { kind: "choice", candidates: share }
                : { kind: "service", id: withBase([id]).length === 1 ? id : comboId(withBase([id]), rules) };
            expect(t, text).toEqual({ kind: frame.kind, target });
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
    // Every rare branch was reached, so B3 never passes without testing it.
    for (const [k, v] of Object.entries(seen)) expect(v, k).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

/** Aliases only one service has: a request that names exactly that service. */
const UNIQUE = new Map(
  shop.services.map((s) => [s.id, saidFormsOf(s).filter((a) => sharing(a).length === 1 && phraseKey(a).split(" ").length <= 3)]),
);

/** Valid Call service sets: 0–3 different services, every Add_On with its base. */
const arbCurrent = fc
  .uniqueArray(fc.constantFrom(...shop.services.map((s) => s.id)), { minLength: 0, maxLength: MAX_SERVICES })
  .map((ids) => withBase(ids).slice(0, MAX_SERVICES))
  .filter((ids) => ids.every((id) => (byId.get(id)?.addOnTo ?? []).every((b) => ids.includes(b)) || !byId.get(id)?.addOnTo));

const NEGATIONS = ["sin {b}", "no quiero {b}", "mejor sin {b}", "without {b}", "nada de {b}"];
const ADDITIONS = ["y también {b}", "además {b}", "also {b}", "plus {b}"];
const PLAIN = ["quería {b}", "{b}", "I'd like {b}"];

describe("B13. Negation, addition and replacement", () => {
  it("never requests a negated service, adds after an addition word, and replaces otherwise (4.6, 4.7, 7.8)", () => {
    const seen = { negIn: 0, negOut: 0, baseRemoved: 0, added: 0, addBase: 0, tooMany: 0, replaced: 0 };
    // Removing a base whose Add_On is in the Call needs A ∋ degradado and b = corte-hombre: about
    // 1 draw in 300 at random; adding the fade to a Call without a men's cut is about 1 in 70.
    // Fixed examples make sure both branches run on every seed. The design's 200 random runs
    // stay; fast-check counts examples inside numRuns, hence 200 + the examples.
    const menCut = UNIQUE.get("corte-hombre")![0];
    const fade = UNIQUE.get("degradado")![0];
    const examples: [string[], [string, string], "neg" | "add" | "plain", number][] = [
      [["corte-hombre", "degradado"], ["corte-hombre", menCut], "neg", 0],
      [["corte-hombre", "degradado", "barba"], ["corte-hombre", menCut], "neg", 2],
      [["tinte-raiz"], ["degradado", fade], "add", 0],
    ];
    const arbA: fc.Arbitrary<string[]> = fc.oneof(
      { weight: 3, arbitrary: arbCurrent },
      { weight: 1, arbitrary: fc.constantFrom<string[]>(["corte-hombre", "degradado"], ["corte-hombre", "degradado", "barba"]) },
    );
    fc.assert(
      fc.property(
        arbA,
        fc.constantFrom(...shop.services.map((s) => s.id)).chain((b) => fc.tuple(fc.constant(b), fc.constantFrom(...UNIQUE.get(b)!))),
        fc.constantFrom<"neg" | "add" | "plain">("neg", "add", "plain"),
        fc.nat(),
        (A, [b, alias], kind, pick) => {
          const list = kind === "neg" ? NEGATIONS : kind === "add" ? ADDITIONS : PLAIN;
          const text = list[pick % list.length].replace("{b}", alias);
          const m = matchServices(text, shop, { current: A });
          if (kind === "neg") {
            // "sin {b}" never requests b. When b is in the Call it is removed, with any Add_On left without a base.
            expect(m.request.kind, text).toBe("none");
            if (A.includes(b)) {
              seen.negIn++;
              const left = A.filter((id) => id !== b);
              const orphans = left.filter((id) => {
                const bases = byId.get(id)?.addOnTo ?? [];
                return bases.length > 0 && !bases.some((x) => left.includes(x));
              });
              if (orphans.length > 0) seen.baseRemoved++;
              expect(m.next, text).toEqual(left.filter((id) => !orphans.includes(id)));
              expect(m.removedAddOns, text).toEqual(orphans);
            } else {
              seen.negOut++;
              expect(m.next, text).toBeNull();
            }
            return;
          }
          if (kind === "add") {
            const union = [...A];
            for (const id of withBase([b], A)) if (!union.includes(id)) union.push(id);
            if (withBase([b], A).length > 1) seen.addBase++;
            if (union.length > MAX_SERVICES) {
              seen.tooMany++;
              expect(m.tooMany, text).toBe(true);
              const kept = union.slice(0, MAX_SERVICES);
              // A fourth service is dropped, and an Add_On left without its base goes with it.
              expect(m.next, text).toEqual(
                kept.filter((id) => {
                  const bases = byId.get(id)?.addOnTo ?? [];
                  return bases.length === 0 || bases.some((x) => kept.includes(x));
                }),
              );
            } else {
              seen.added++;
              expect(m.tooMany, text).toBe(false);
              expect(m.next, text).toEqual(union);
            }
            expect(m.request).toMatchObject({ kind: "set", mode: "add" });
            return;
          }
          seen.replaced++;
          expect(m.request).toMatchObject({ kind: "set", mode: "replace" });
          expect(m.next, text).toEqual(withBase([b]));
        },
      ),
      { numRuns: NUM_RUNS + examples.length, examples },
    );
    for (const [k, v] of Object.entries(seen)) expect(v, k).toBeGreaterThan(0);
  });
});
