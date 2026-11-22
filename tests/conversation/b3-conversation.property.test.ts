import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { comboId, evaluateBooking } from "@/lib/booking";
import { phraseKey } from "@/lib/conversation/brain/normalize";
import { toShopRules, type ShopService } from "@/lib/conversation/shopProfile";
import { lolaSeedProfile } from "@/lib/db/seed";
import { phrases } from "@/lib/receptionist/phrases";
import { spokenTemplate } from "@/lib/receptionist/speech";
import { speakDuration, speakPrice } from "@/lib/receptionist/spoken";
import { getSectorPack, type Lang } from "@/lib/sectors";
import { arbAliasVariant } from "./brain/arbitraries";
import { SAT_1930 } from "./brainCall";
import { CoreCaller, coreHarness, FAILING_KINDS, switchModel } from "./coreCall";

/**
 * B3 (conversation part, front-desk-brain 9.1, 8.1). For every service s of the Rich_Profile, each
 * of its names and aliases in `arbAliasVariant` forms, in price, duration and booking frames of
 * the frame's language, through `handleTurn` with a model that fails:
 *  - a price frame's reply says s's price (an Add_On with its base: the sum), or every
 *    candidate's price when the alias is shared;
 *  - a duration frame's reply says s's duration (or the sum, or every candidate's);
 *  - a booking frame's reply is a First_Offer whose slot `evaluateBooking` accepts for s (or the
 *    combination with its base), or the Service_Choice of the services that share the alias;
 *  - no reply is an owner-message line (ownerNoted, sensitiveNoted, unknownKeepAlive).
 * The oracles read the profile directly, as the matcher part of B3 does.
 */
const shop = lolaSeedProfile;
const pack = getSectorPack(shop.sectorPackId);
const rules = toShopRules(shop);
const byId = new Map(shop.services.map((s) => [s.id, s]));

const saidFormsOf = (s: ShopService) => [s.name.es, s.name.en, ...(s.aliases ?? [])];
function sharing(alias: string): string[] {
  const k = phraseKey(alias);
  return shop.services.filter((s) => saidFormsOf(s).some((a) => phraseKey(a) === k)).map((s) => s.id);
}
/** An Add_On alone brings its first base before it (4.10). */
function withBase(id: string): string[] {
  const bases = byId.get(id)?.addOnTo ?? [];
  return bases.length > 0 ? [bases[0], id] : [id];
}

type Kind = "price" | "duration" | "booking";
const FRAMES: { kind: Kind; lang: Lang; text: (x: string) => string }[] = [
  { kind: "price", lang: "es", text: (x) => `¿cuánto cuesta ${x}?` },
  { kind: "price", lang: "en", text: (x) => `how much is ${x}?` },
  { kind: "duration", lang: "es", text: (x) => `¿cuánto tarda ${x}?` },
  { kind: "duration", lang: "en", text: (x) => `how long does ${x} take?` },
  { kind: "booking", lang: "es", text: (x) => `quería ${x}` },
  { kind: "booking", lang: "en", text: (x) => `I'd like ${x}, please` },
];

const PAIRS = shop.services.flatMap((s) => saidFormsOf(s).map((alias) => ({ id: s.id, alias })));

const arbCase = fc.constantFrom(...PAIRS).chain((p) =>
  fc.record({ pair: fc.constant(p), variant: arbAliasVariant(p.alias, shop), frame: fc.constantFrom(...FRAMES), failure: fc.constantFrom(...FAILING_KINDS) }),
);

const OWNER_LINES = (lang: Lang, callId: string) => {
  const out = new Set<string>();
  for (let turn = 0; turn <= 3; turn++) {
    const p = phrases(lang, pack, shop, { callId, turn }, SAT_1930);
    for (const l of [p.ownerNoted(), p.ownerNoted(true), p.sensitiveNoted(), p.sensitiveNoted(true), p.unknownKeepAlive(), p.unknownKeepAlive(true)]) {
      out.add(spokenTemplate(l.text, lang));
    }
  }
  return [...out];
};

describe("B3: every service alias is found and answered (conversation part)", () => {
  it("price, duration and booking frames get the profile's numbers and a slot the rules accept", { timeout: 300_000 }, async () => {
    const reached = { price: 0, duration: 0, booking: 0, shared: 0, addOn: 0, typo: 0, es: 0, en: 0 };
    await fc.assert(
      fc.asyncProperty(arbCase, async ({ pair, variant, frame, failure }) => {
        const h = coreHarness({ shops: [shop], now: SAT_1930, model: switchModel({ kind: failure }) });
        const c = new CoreCaller(h.deps, shop, frame.lang);
        await c.start();
        const text = frame.text(variant.text);
        const out = await c.say(text);
        const state = h.repo.calls()[0].state;
        const share = sharing(pair.alias);
        const parts = withBase(pair.id);
        const lang = frame.lang;

        expect(out.complete, text).toBe(false);
        for (const line of OWNER_LINES(lang, c.callId)) expect(out.reply, text).not.toContain(line);

        if (frame.kind === "price") {
          const said = share.length > 1 ? share.map((id) => byId.get(id)!.priceCents) : [parts.reduce((n, id) => n + byId.get(id)!.priceCents, 0)];
          for (const cents of said) expect(out.reply, text).toContain(speakPrice(cents, lang));
        } else if (frame.kind === "duration") {
          const said = share.length > 1 ? share.map((id) => byId.get(id)!.durationMin) : [parts.reduce((n, id) => n + byId.get(id)!.durationMin, 0)];
          for (const min of said) expect(out.reply, text).toContain(speakDuration(min, lang));
        } else if (share.length > 1) {
          expect(state.fields.serviceChoice?.candidates, text).toEqual(share);
        } else {
          const id = parts.length === 1 ? pair.id : comboId(parts, rules.services);
          expect(id, text).not.toBeNull();
          expect(state.fields.serviceId, text).toBe(id);
          expect(state.offerKind, `${text} → ${out.reply}`).toBe("first");
          const start = Temporal.Instant.from(state.lastOffer![0]);
          const ctx = { now: SAT_1930, shop: rules, pack: { slotStepMin: pack.slotStepMin, rules: pack.rules }, existing: [] };
          expect(evaluateBooking({ serviceId: id!, start }, ctx).ok, text).toBe(true);
        }
        reached[frame.kind]++;
        reached[lang]++;
        if (share.length > 1) reached.shared++;
        if (parts.length > 1) reached.addOn++;
        if (variant.typo) reached.typo++;
      }),
      { numRuns: 200 },
    );
    for (const [k, v] of Object.entries(reached)) expect(v, k).toBeGreaterThan(0);
  });
});
