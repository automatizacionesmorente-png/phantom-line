import { eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { ShopProfileSchema, type ShopProfile, type ShopProfileInput } from "@/lib/conversation/shopProfile";
import { DEMO_SHOP_ID } from "@/lib/owner/demo";
import { hashPin, PIN_PATTERN, verifyPin } from "@/lib/owner/pin";
import { getSectorPack } from "@/lib/sectors";
import { SHARED_CUT_ALIASES, hairSalonCatalogue } from "@/lib/sectors/starters/hairSalon";
import { setOwnerPin } from "./ownerRepository";
import type { Db } from "./repository";
import { shops } from "./schema";

/**
 * The demo shop: Peluquería Lola, Tue–Sat 10:00–14:00 and 17:00–20:00 in Europe/Madrid,
 * two chairs, hair-salon pack (core-call-loop 7), with the Rich_Profile's catalog and
 * everyday answers (front-desk-brain 11.4–11.7, design.md "The Rich_Profile"). Prices and
 * durations are an estimate of a Madrid neighbourhood salon in 2026, not a price survey;
 * the owner reads them before the seed runs on Neon. The three-service profile the older
 * tests pin is the V1_Profile in `tests/fixtures/lola.ts`.
 * No `server-only` import here: `npm run db:seed` runs this outside Next.js.
 */
const day = [
  { open: "10:00", close: "14:00" },
  { open: "17:00", close: "20:00" },
];

/** The cuts that carry the bare cut words in the demo shop. */
const CUT_IDS: ReadonlySet<string> = new Set(["corte-mujer", "corte-hombre", "corte-infantil"]);

export const lolaSeedProfile: ShopProfile = {
  id: DEMO_SHOP_ID,
  name: "Peluquería Lola",
  ownerName: "Lola",
  address: "Calle Mayor 12, Madrid",
  timeZone: "Europe/Madrid",
  sectorPackId: "hair-salon",
  languages: ["es", "en"],
  hours: { 2: day, 3: day, 4: day, 5: day, 6: day },
  // The catalogue is the hair-salon pack's starter catalogue. The demo shop also puts the bare
  // cut words on the three cuts (so "un corte" is a Service_Choice, which the tests pin) and keeps
  // the "cortes" Category's own two words.
  categories: hairSalonCatalogue.categories.map((c) =>
    c.id === "cortes" ? { ...c, aliases: ["cortes", "corte de pelo en general"] } : c,
  ),
  services: hairSalonCatalogue.services.map((s) =>
    CUT_IDS.has(s.id) ? { ...s, aliases: [...SHARED_CUT_ALIASES, ...(s.aliases ?? [])] } : s,
  ),
  // Answers in Spoken_Form (no digits), checked by FaqEntrySchema. Task 1.5 confirmed the
  // Plaza Mayor car park (council open data) but could not check the walking time or the
  // metro stations, so `parking` says "muy cerca" and `como-llegar` names no station.
  faq: [
    {
      id: "pago",
      aliases: {
        es: ["pagar con tarjeta", "bizum", "efectivo", "formas de pago", "cómo se paga", "aceptáis tarjeta"],
        en: ["pay by card", "payment", "cash", "bizum", "do you take cards"],
      },
      answer: {
        es: "Puedes pagar con tarjeta, con Bizum o en efectivo.",
        en: "You can pay by card, with Bizum or in cash.",
      },
    },
    {
      id: "parking",
      aliases: {
        es: ["aparcar", "parking", "aparcamiento", "dónde dejo el coche"],
        en: ["parking", "park the car", "car park"],
      },
      answer: {
        es: "No tenemos aparcamiento propio, pero hay un parking público en la plaza Mayor, muy cerca.",
        en: "We have no parking of our own, but there is a public car park in Plaza Mayor, very close.",
      },
    },
    {
      id: "accesibilidad",
      aliases: {
        es: ["silla de ruedas", "escalones", "accesible", "carrito"],
        en: ["wheelchair", "step-free", "accessible", "stroller"],
      },
      answer: {
        es: "Sí, el local está a pie de calle, sin escalones, y entra bien una silla de ruedas.",
        en: "Yes, the salon is at street level with no steps, and a wheelchair fits in easily.",
      },
    },
    {
      id: "sin-cita",
      aliases: {
        es: ["sin cita", "sin reserva", "pasarme sin cita", "ir directamente"],
        en: ["walk in", "without an appointment", "drop in"],
      },
      answer: {
        es: "Si hay un sillón libre te atendemos sin cita, pero con cita te aseguras el hueco.",
        en: "If a chair is free we can see you without an appointment, but booking makes sure you get a slot.",
      },
    },
    {
      id: "cancelacion",
      aliases: {
        es: ["anular con antelación", "política de cancelación", "si no puedo ir", "penalización"],
        en: ["cancellation policy", "cancel fee", "if I can't make it"],
      },
      answer: {
        es: "Puedes cambiar o anular tu cita sin coste hasta veinticuatro horas antes, llamando a este mismo número.",
        en: "You can change or cancel your appointment free of charge up to twenty-four hours before, by calling this same number.",
      },
    },
    {
      id: "llegar-antes",
      aliases: {
        es: ["cuánto antes llego", "llegar antes", "con cuánta antelación"],
        en: ["how early", "arrive early"],
      },
      answer: {
        es: "Con llegar cinco minutos antes es suficiente.",
        en: "Arriving five minutes early is enough.",
      },
    },
    {
      id: "ninos",
      aliases: {
        es: ["niños", "críos", "hacéis a niños", "peques"],
        en: ["kids", "children", "do you cut children"],
      },
      answer: {
        es: "Sí, cortamos a niños y niñas de cualquier edad; el corte infantil es hasta los doce años.",
        en: "Yes, we cut boys and girls of any age; the kids' cut is for children up to twelve.",
      },
    },
    {
      id: "productos",
      aliases: {
        es: ["vendéis productos", "champú", "comprar productos", "mascarillas para casa"],
        en: ["sell products", "shampoo", "buy products"],
      },
      answer: {
        es: "Sí, vendemos champús, mascarillas y productos de peinado de las marcas que usamos en el salón.",
        en: "Yes, we sell shampoos, masks and styling products from the brands we use in the salon.",
      },
    },
    {
      id: "bono-regalo",
      aliases: {
        es: ["tarjeta regalo", "bono regalo", "regalar", "vale regalo"],
        en: ["gift voucher", "gift card", "gift certificate"],
      },
      answer: {
        es: "Sí, tenemos tarjetas regalo del importe que quieras; se compran en la peluquería.",
        en: "Yes, we have gift cards for any amount you like; you can buy them at the salon.",
      },
    },
    {
      id: "prueba-alergia",
      aliases: {
        es: ["prueba de alergia", "test de alergia", "prueba de sensibilidad", "prueba del tinte"],
        en: ["allergy test", "patch test", "skin test"],
      },
      answer: {
        es: "Para cualquier tinte necesitamos una prueba de alergia cuarenta y ocho horas antes. Es gratis y solo lleva cinco minutos.",
        en: "For any colour we need an allergy test forty-eight hours before. It is free and only takes five minutes.",
      },
    },
    {
      id: "hombres",
      aliases: {
        es: ["hacéis a hombres", "cortáis a hombres", "para chicos", "sois unisex"],
        en: ["do you do men", "men's hair", "unisex"],
      },
      answer: {
        es: "Sí, claro, hacemos cortes de hombre, degradados y barba.",
        en: "Yes, of course, we do men's cuts, fades and beards.",
      },
    },
    {
      id: "ingles",
      aliases: {
        es: ["habláis inglés", "atendéis en inglés"],
        en: ["do you speak English", "English-speaking"],
      },
      answer: {
        es: "Sí, te podemos atender en inglés, y si quieres seguimos esta llamada en inglés.",
        en: "Yes, we can help you in English, and if you like we can carry on this call in English.",
      },
    },
    {
      id: "wifi",
      aliases: {
        es: ["wifi", "internet", "red"],
        en: ["wifi", "wi-fi", "internet"],
      },
      answer: {
        es: "Sí, hay wifi gratis para clientes; la clave te la damos en el salón.",
        en: "Yes, there is free wifi for customers; we give you the password at the salon.",
      },
    },
    {
      id: "como-llegar",
      aliases: {
        es: ["cómo llego", "metro", "autobús", "cómo se llega", "transporte"],
        en: ["how do I get there", "metro", "subway", "bus", "public transport"],
      },
      answer: {
        es: "Estamos en la calle Mayor, en pleno centro, y se llega bien en metro y en autobús.",
        en: "We are on Calle Mayor, right in the centre, easy to reach by metro or bus.",
      },
    },
  ],
  resources: [
    { id: "chair-1", name: { es: "Sillón 1", en: "Chair 1" } },
    { id: "chair-2", name: { es: "Sillón 2", en: "Chair 2" } },
  ],
  // The voice is the hair-salon pack's (es-es-commercial-3 / Kore), so no `voice` override.
  // Pace option 2 (design.md "Pace", decided in task 3.8): play the neural voice 10 % faster
  // with the pitch kept. Option 1 (pace words in the style) was measured and rejected.
  speechRate: 1.1,
};

export interface SeedResult {
  shopId: string;
  /** true when the shop row was inserted, false when an existing row was updated. */
  created: boolean;
}

/**
 * Inserts the shop, or updates the existing row with the same name (7.6).
 * The profile and its sector pack are validated first, so a broken seed
 * never reaches the database. The id of an existing row is kept, so calls,
 * bookings and messages that point at it stay valid.
 */
export async function seedShop(db: Db, input: ShopProfileInput = lolaSeedProfile): Promise<SeedResult> {
  const profile = ShopProfileSchema.parse(input);
  getSectorPack(profile.sectorPackId); // throws on an unknown pack

  const existing = await db.select({ id: shops.id }).from(shops).where(eq(shops.name, profile.name)).limit(1);
  const shopId = existing[0]?.id ?? profile.id;
  const stored: ShopProfile = { ...profile, id: shopId };

  const rows = await db
    .insert(shops)
    .values({
      id: shopId,
      name: stored.name,
      sectorPackId: stored.sectorPackId,
      timeZone: stored.timeZone,
      profile: stored,
    })
    .onConflictDoUpdate({
      target: shops.name,
      set: { sectorPackId: stored.sectorPackId, timeZone: stored.timeZone, profile: stored },
    })
    .returning({ id: shops.id });

  return { shopId: rows[0].id, created: existing.length === 0 };
}

export type SeedPinResult = "set" | "kept" | "missing" | "malformed" | "no_shop";

/**
 * The Demo_Shop's Owner_PIN from `DEMO_OWNER_PIN` (owner-machine 2.6). Hashed only when it is
 * exactly 6 digits and the stored hash no longer verifies, so re-running the seed with the same
 * PIN keeps the hash and `owner_pin_set_at`, and every open session stays valid (1.8). A missing
 * or malformed value sets no PIN and changes no stored one, and `print` says so. Nothing printed
 * ever contains the PIN or the hash.
 */
export async function seedOwnerPin(
  db: Db,
  shopId: string,
  pin: string | undefined,
  print: (line: string) => void,
  now: Temporal.Instant = Temporal.Now.instant(),
): Promise<SeedPinResult> {
  if (pin === undefined || pin === "") {
    print("DEMO_OWNER_PIN is not set: the shop's machine PIN was not set");
    return "missing";
  }
  if (!PIN_PATTERN.test(pin)) {
    print("DEMO_OWNER_PIN is not exactly 6 digits: the shop's machine PIN was not set");
    return "malformed";
  }
  const rows = await db.select({ hash: shops.ownerPinHash }).from(shops).where(eq(shops.id, shopId)).limit(1);
  if (rows.length === 0) {
    print(`shop "${shopId}" not found: the machine PIN was not set`);
    return "no_shop";
  }
  const stored = rows[0].hash;
  if (stored !== null && (await verifyPin(pin, stored))) {
    print("machine PIN unchanged");
    return "kept";
  }
  await setOwnerPin(db, shopId, await hashPin(pin), now);
  print("machine PIN set from DEMO_OWNER_PIN");
  return "set";
}
