import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import { lolaSeedProfile } from "@/lib/db/seed";
import { phrases } from "@/lib/receptionist/phrases";
import { spokenTemplate } from "@/lib/receptionist/speech";
import { getSectorPack, type Lang } from "@/lib/sectors";
import { arbAliasVariant } from "./brain/arbitraries";
import { arbShop } from "./brain/arbShops";
import { SAT_1930 } from "./brainCall";
import { CoreCaller, coreHarness, FAILING_KINDS, switchModel } from "./coreCall";

/**
 * B2. Every FAQ topic gets the profile's answer (front-desk-brain 9.1, 9.5, 9.6, 1.1). For every
 * FAQ_Entry of the Rich_Profile and of random shops with generated FAQ, both languages, its
 * aliases said in `arbAliasVariant` forms inside question frames, in a fresh Call and in the
 * middle of a booking (services known, name missing), with a model that fails every Turn:
 *  - the reply contains the entry's answer exactly;
 *  - in the middle of a booking the answer is followed by the flow's next question;
 *  - the reply holds no unknownKeepAlive, no ownerNoted and no Fallback_Message line;
 *  - no Owner_Note is recorded, the Booking fields are kept, and the Call is open.
 */
const pack = getSectorPack("hair-salon");
const FRAMES: Record<Lang, readonly ((x: string) => string)[]> = {
  es: [(x) => `¿${x}?`, (x) => `oye, ¿${x}?`, (x) => `una pregunta, ¿${x}?`],
  en: [(x) => `${x}?`, (x) => `hey, ${x}?`, (x) => `quick question, ${x}?`],
};
const BOOKING: Record<Lang, (s: ShopProfile["services"][number]) => string> = {
  es: (s) => `quería ${s.name.es}`,
  en: (s) => `I'd like ${s.name.en}`,
};
const YES: Record<Lang, string> = { es: "sí", en: "yes" };

const arbShopWithFaq = fc.oneof(
  { weight: 1, arbitrary: fc.constant(lolaSeedProfile) },
  { weight: 1, arbitrary: arbShop.filter((s) => (s.faq?.length ?? 0) > 0) },
);

const arbCase = arbShopWithFaq.chain((shop) =>
  fc
    .record({
      entry: fc.constantFrom(...shop.faq!),
      lang: fc.constantFrom<Lang>("es", "en"),
      mid: fc.boolean(),
      frame: fc.nat(),
      failure: fc.constantFrom(...FAILING_KINDS),
      service: fc.constantFrom(...shop.services),
    })
    .chain((g) =>
      fc.tuple(fc.constantFrom(...g.entry.aliases[g.lang]), fc.constant(g)).chain(([alias]) =>
        arbAliasVariant(alias, shop).map((variant) => ({ ...g, shop, alias, variant })),
      ),
    ),
);

/** Every variant of a line the Receptionist may say on a Turn of this Call, both forms. */
function linesOf(shop: ShopProfile, lang: Lang, callId: string, pick: (p: ReturnType<typeof phrases>) => string[]): string[] {
  const out = new Set<string>();
  for (let turn = 0; turn <= 6; turn++) for (const text of pick(phrases(lang, pack, shop, { callId, turn }, SAT_1930))) out.add(spokenTemplate(text, lang));
  return [...out];
}

describe("B2: every FAQ topic gets the profile's answer", () => {
  it("fresh or mid-booking, with a failing model: the answer, the next question, no note", { timeout: 300_000 }, async () => {
    const reached = { fresh: 0, mid: 0, rich: 0, random: 0, es: 0, en: 0, typo: 0 };
    await fc.assert(
      fc.asyncProperty(arbCase, async ({ shop, entry, lang, mid, frame, failure, service, variant }) => {
        const model = switchModel({ kind: failure });
        const h = coreHarness({ shops: [shop], now: SAT_1930, model });
        const c = new CoreCaller(h.deps, shop, lang);
        await c.start();

        let inBooking = false;
        if (mid) {
          await c.say(BOOKING[lang](service));
          const s = h.repo.calls()[0].state;
          if (s.offerKind === "first") await c.say(YES[lang]);
          const after = h.repo.calls()[0].state;
          inBooking = after.fields.serviceId !== undefined && after.fields.name === undefined;
        }
        const before = h.repo.calls()[0].state;
        const question = FRAMES[lang][frame % FRAMES[lang].length](variant.text);
        const out = await c.say(question);
        const answer = entry.answer[lang];

        expect(out.reply, question).toContain(answer);
        expect(out.complete).toBe(false);
        const after = h.repo.calls()[0];
        expect(after.status).toBe("open");
        expect(after.state.notes ?? [], question).toEqual(before.notes ?? []);
        expect(after.state.notes ?? []).toEqual([]);
        const forbidden = [
          ...linesOf(shop, lang, c.callId, (p) => [p.unknownKeepAlive().text, p.unknownKeepAlive(true).text, p.ownerNoted().text, p.ownerNoted(true).text]),
          ...(["es", "en"] as const).map((l) => spokenTemplate(phrases(l, pack, shop, undefined, SAT_1930).fallbackEnd().text, l)),
        ];
        for (const line of forbidden) expect(out.reply, question).not.toContain(line);

        if (inBooking) {
          reached.mid++;
          // The booking is kept, and its next question follows the answer (9.6).
          expect(after.state.fields).toEqual(before.fields);
          const rest = out.reply.slice(out.reply.indexOf(answer) + answer.length).trim();
          expect(rest, question).not.toBe("");
          expect(rest.endsWith("?"), `${question} → ${out.reply}`).toBe(true);
        } else if (!mid) reached.fresh++;
        reached[shop === lolaSeedProfile ? "rich" : "random"]++;
        reached[lang]++;
        if (variant.typo) reached.typo++;
      }),
      { numRuns: 200 },
    );
    for (const [k, v] of Object.entries(reached)) expect(v, k).toBeGreaterThan(0);
  });
});
