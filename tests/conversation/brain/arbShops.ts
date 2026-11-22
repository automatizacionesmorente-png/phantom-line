import fc from "fast-check";
import { ShopProfileSchema, type ShopProfile } from "@/lib/conversation/shopProfile";
import { lolaSeedProfile } from "@/lib/db/seed";

/**
 * Random shops and everyday utterances for the conversation-level properties (B1, B2, B6, B11).
 * Moved here unchanged from `b6-never-invents.property.test.ts` in task 9, so every property
 * draws from the same shops.
 *
 * Shops: catalogs drawn from the Rich_Profile's services with random durations, prices and "from"
 * flags; random hours; random FAQ_Entries whose answers carry marker words found nowhere else.
 */
const POOL = lolaSeedProfile.services;

export const MARKERS = ["zorbla", "quimbo", "frandel", "mirtosa", "plenque", "vastrilo", "gondrel", "tufina"];
const FAQ_TOPICS = [
  { es: "terraza", en: "terrace" },
  { es: "ascensor", en: "lift" },
  { es: "toallas", en: "towels" },
  { es: "musica", en: "music" },
  { es: "mascotas", en: "pets" },
];

export const arbHours = fc
  .array(
    fc.oneof(
      fc.constant(null),
      fc.record({ a: fc.integer({ min: 32, max: 48 }), b: fc.integer({ min: 4, max: 20 }), c: fc.integer({ min: 0, max: 12 }), d: fc.integer({ min: 4, max: 16 }) }),
    ),
    { minLength: 7, maxLength: 7 },
  )
  .map((days) => {
    const hhmm = (q: number) => `${String(Math.floor(q / 4)).padStart(2, "0")}:${String((q % 4) * 15).padStart(2, "0")}`;
    const hours: Record<number, { open: string; close: string }[]> = {};
    days.forEach((g, k) => {
      if (!g) return;
      const open1 = g.a;
      const close1 = Math.min(open1 + g.b, 88);
      const sessions = [{ open: hhmm(open1), close: hhmm(close1) }];
      const open2 = close1 + 1 + g.c;
      if (g.c > 6 && open2 + g.d <= 92) sessions.push({ open: hhmm(open2), close: hhmm(open2 + g.d) });
      hours[k + 1] = sessions;
    });
    if (Object.keys(hours).length === 0) hours[2] = [{ open: "10:00", close: "14:00" }];
    return hours as ShopProfile["hours"];
  });

export const arbShop: fc.Arbitrary<ShopProfile> = fc
  .record({
    picks: fc.uniqueArray(fc.nat({ max: POOL.length - 1 }), { minLength: 1, maxLength: 7 }),
    durations: fc.array(fc.integer({ min: 2, max: 36 }).map((n) => n * 5), { minLength: 7, maxLength: 7 }),
    prices: fc.array(fc.integer({ min: 2, max: 240 }).map((n) => n * 50), { minLength: 7, maxLength: 7 }),
    from: fc.array(fc.boolean(), { minLength: 7, maxLength: 7 }),
    faq: fc.uniqueArray(fc.nat({ max: FAQ_TOPICS.length - 1 }), { maxLength: 3 }),
    hours: arbHours,
    timeZone: fc.constantFrom("Europe/Madrid", "Atlantic/Canary"),
  })
  .map((g) => {
    const chosen = g.picks.map((p) => POOL[p]);
    const ids = new Set(chosen.map((s) => s.id));
    const services = chosen.map((s, k) => {
      const { goesWith, addOnTo, category, ...rest } = s;
      const keepGoes = (goesWith ?? []).filter((x) => ids.has(x));
      const keepAddOn = (addOnTo ?? []).filter((x) => ids.has(x));
      void category;
      return {
        ...rest,
        durationMin: g.durations[k],
        priceCents: g.prices[k],
        priceFrom: g.from[k],
        ...(keepGoes.length > 0 ? { goesWith: keepGoes } : {}),
        ...(keepAddOn.length > 0 ? { addOnTo: keepAddOn } : {}),
      };
    });
    const faq = g.faq.map((t, k) => {
      const topic = FAQ_TOPICS[t];
      const marker = MARKERS[(t * 3 + k) % MARKERS.length];
      return {
        id: `faq-${topic.es}`,
        aliases: { es: [`tenéis ${topic.es}`], en: [`do you have ${topic.en}`] },
        answer: {
          es: `Sí, tenemos ${topic.es} ${marker} para los clientes.`,
          en: `Yes, we have ${topic.en} ${marker} for our clients.`,
        },
      };
    });
    const profile = {
      ...lolaSeedProfile,
      id: "random-brain-shop",
      timeZone: g.timeZone,
      hours: g.hours,
      services,
      categories: undefined,
      faq,
    };
    delete (profile as { categories?: unknown }).categories;
    return ShopProfileSchema.parse(profile);
  });

/** Everyday utterances for a shop: its own service words, its FAQ, names, phones, days, yes and no, owner requests, gibberish. */
export function arbUtterance(shop: ShopProfile): fc.Arbitrary<string> {
  const names = shop.services.flatMap((s) => [s.name.es, ...(s.aliases ?? []).slice(0, 3)]);
  const faq = (shop.faq ?? []).flatMap((f) => [`¿${f.aliases.es[0]}?`]);
  return fc.oneof(
    { weight: 4, arbitrary: fc.constantFrom(...names).map((n) => `quería ${n}`) },
    { weight: 1, arbitrary: fc.tuple(fc.constantFrom(...names), fc.constantFrom(...names)).map(([a, b]) => `quiero ${a} y ${b}`) },
    { weight: 2, arbitrary: fc.constantFrom(...names).map((n) => `¿cuánto cuesta ${n}?`) },
    { weight: 1, arbitrary: fc.constantFrom(...names).map((n) => `¿cuánto tarda ${n}?`) },
    { weight: 1, arbitrary: faq.length > 0 ? fc.constantFrom(...faq) : fc.constant("¿hay parking?") },
    { weight: 1, arbitrary: fc.constantFrom("¿qué horario tenéis?", "¿abrís el sábado?", "¿estáis abiertos ahora?", "¿dónde estáis?", "¿qué servicios tenéis?") },
    { weight: 4, arbitrary: fc.constantFrom("sí", "vale", "perfecto", "no", "no, mejor otro día") },
    { weight: 2, arbitrary: fc.constantFrom("Me llamo Ana", "Luis Pérez", "a nombre de Marta") },
    { weight: 2, arbitrary: fc.constantFrom("612 345 678", "seis uno dos, treinta y cuatro, cincuenta y seis, setenta y ocho", "512 34 56 78") },
    { weight: 2, arbitrary: fc.constantFrom("mañana a las diez", "el jueves por la tarde", "el martes a las cinco", "a las doce", "por la mañana", "el sábado a las nueve de la noche") },
    { weight: 1, arbitrary: fc.constantFrom("quiero hablar con la dueña", "¿y qué tal corta?", "patata frita", "hola", "gracias") },
  );
}
