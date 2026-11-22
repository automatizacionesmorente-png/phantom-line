import type { Temporal } from "temporal-polyfill";
import type { RejectionReason, Weekday } from "@/lib/booking";
import { MAX_COMBO_PARTS } from "@/lib/booking/services";
import type { TopicHit } from "@/lib/conversation/brain/topics";
import { catalogItems, catalogLine, serviceView } from "@/lib/conversation/catalog";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import type { AnsweredTopic, OwnerNote } from "@/lib/conversation/types";
import type { Lang, SectorPack } from "@/lib/sectors";
import { formatSlot, joinAnd, joinOr } from "./format";
import { daySessionsInWords, hoursGroups } from "./prompt";
import {
  clockWords,
  minuteSessions,
  speakDay,
  speakDuration,
  speakNumber,
  speakOrdinal,
  speakPhone,
  speakPrice,
  speakTime,
  todayIn,
  type ClockTime,
  type TimeContext,
} from "./spoken";
import { MAX_WORDS } from "./speech";
import { pickVariant, type VariantSeed } from "./variants";

/**
 * One line the receptionist says, with the code's decision on whether its
 * audio may be stored and replayed for other callers (natural-voice 6.5, design
 * "What may be cached"): false for any line with a name or a phone, or with the
 * caller's own words; true for every line made only of shop data, days, times,
 * services and alternatives.
 */
export interface Said {
  readonly text: string;
  readonly cacheable: boolean;
}

/**
 * Every templated line the receptionist says, and the owner-facing texts of a
 * Message, in one language. Lines that state facts about bookings, times or
 * availability always come from here, never from the model. The spoken lines
 * are in Spoken_Form (no digit) and may be up to 3 sentences (Requirement 9.7).
 */
export interface PhraseSet {
  greeting(): Said;
  /** `asked` is the caller's own word for it; it is spoken back only when short and plain. */
  serviceNotOffered(asked: string | null): Said;
  rejected(reason: RejectionReason, requested: Temporal.Instant, alternatives: readonly Temporal.Instant[]): Said;
  /**
   * The service is known but the day or the time is not: the code asks for it itself, so
   * the caller never hears the model's own words about opening hours (Requirement 5.8).
   */
  askDayAndTime(day: Temporal.PlainDate | null): Said;
  /** The time passed the Booking_Rules; the name is the next thing missing. */
  timeAcceptedAskName(start: Temporal.Instant): Said;
  askName(): Said;
  /** One friendly second ask, for a name that is clearly not a name. */
  askNameAgain(): Said;
  askPhone(): Said;
  /** One sentence: what a service takes and costs. Said when the caller switches service mid-booking. */
  serviceInfo(serviceId: string): Said;
  /** Holds the caller's name and phone, so it is never cacheable. */
  readBack(serviceId: string, start: Temporal.Instant, name: string, phone: string): Said;
  /** `requested` is the time that was just taken, so the first alternative names its day only if it differs. */
  slotJustTaken(requested: Temporal.Instant | null, alternatives: readonly Temporal.Instant[]): Said;
  booked(serviceId: string, start: Temporal.Instant): Said;
  existingForReschedule(serviceId: string, start: Temporal.Instant): Said;
  rescheduleReadBack(serviceId: string, newStart: Temporal.Instant): Said;
  rescheduled(serviceId: string, newStart: Temporal.Instant): Said;
  cancelReadBack(serviceId: string, start: Temporal.Instant): Said;
  cancelled(): Said;
  /** The same words whether no booking exists for the phone or the name does not match (12.7). */
  bookingNotFound(): Said;
  dontKnow(): Said;
  goodbye(): Said;
  maxTurns(): Said;
  fallbackEnd(): Said;
  fallbackRetry(): Said;
  rateLimitedStart(): Said;
  lineCut(): Said;
  typeInstead(): Said;

  // front-desk-brain (design.md, "New templates"). Every line is Spoken_Form and cacheable:
  // none holds a name, a phone or the Caller's own words (natural-voice 6.5).
  /** The nearest free slot, with what the services take and cost (8.1, 7.5). */
  firstOffer(serviceId: string, slot: Temporal.Instant): Said;
  /** The offer's question alone, after another answer in the same reply (9.6). */
  offerAgain(slot: Temporal.Instant): Said;
  /** No slot within the search's 14 days (8.3); the Call goes on. */
  noSlotNearby(): Said;
  /** The catalog by Category, then the question; `brief` is the question alone. */
  askService(brief?: boolean): Said;
  askServiceChoice(candidates: readonly string[]): Said;
  /** A Profile_Topic's answer from the Shop_Profile (9.1). */
  topicAnswer(topic: TopicHit): Said;
  /** Keep_Alive_Lines (10.1, 10.2, 10.4). `continuing`: only the note, a flow question follows. */
  ownerNoted(continuing?: boolean): Said;
  sensitiveNoted(continuing?: boolean): Said;
  unknownKeepAlive(continuing?: boolean): Said;
  notUnderstood(): Said;
  /** The third miss in a row (10.3). */
  notUnderstoodAgain(): Said;
  /** In the new language. */
  languageSwitched(): Said;
  phoneAgain(): Said;
  tooManyServices(): Said;
  /** "sin el corte": the base and the Add_Ons that went with it (4.10, 7.8). */
  addOnRemoved(addOns: readonly string[], bases: readonly string[], continuing?: boolean): Said;
  /** A read-back interrupted by a question: ask for the yes again. */
  confirmAgain(): Said;
  /** A thanks, a greeting or a bare "no" with nothing open. */
  smallTalk(kind: "thanks" | "greeting" | "no"): Said;
  /** For the Owner, who reads them: digits are fine here (12.3). Never spoken. */
  owner: {
    defaultReason(): string;
    agreedBooked(serviceId: string, start: Temporal.Instant, resourceId: string): string;
    agreedRescheduled(serviceId: string, start: Temporal.Instant, resourceId: string): string;
    agreedCancelled(serviceId: string, start: Temporal.Instant): string;
    agreedNothing(detail: string): string;
    detailFallback(): string;
    detailAbandoned(): string;
    replyBooked(name: string | null, serviceId: string, start: Temporal.Instant): string;
    replyRescheduled(name: string | null, serviceId: string, start: Temporal.Instant): string;
    replyCancelled(name: string | null): string;
    replyCallBack(name: string | null): string;
    /** The code-built reason's parts (front-desk-brain 10.7). */
    reasonWants(names: readonly string[]): string;
    reasonAsked(topics: readonly AnsweredTopic[]): string;
    note(note: OwnerNote): string;
  };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const said = (text: string, cacheable = true): Said => ({ text, cacheable });
const wordsIn = (sentence: string) => sentence.split(/\s+/).filter(Boolean).length;

/** How many alternatives a spoken offer names: the first, then up to two more. */
const MAX_OFFERED = 3;
/** A service the caller names is repeated only if it is this short and plain. */
const MAX_ASKED_WORDS = 4;

/**
 * `phrases(lang, pack, shop, seed?, now?)`. With a `seed` ({ callId, turn }) each template picks
 * its Phrase_Variant from it; with none, variant 0, so deterministic tests keep their shape.
 * With `now`, days are said relative to today in the shop's zone ("mañana", "el sábado");
 * without it they are said by weekday and day of the month ("el sábado veinte").
 */
export function phrases(
  lang: Lang,
  pack: SectorPack,
  shop: ShopProfile,
  seed?: VariantSeed,
  now?: Temporal.Instant,
): PhraseSet {
  const k = kit(lang, pack, shop, seed, now);
  return lang === "es" ? spanish(k) : english(k);
}

// ---------------------------------------------------------------------------
// The tools both languages share

type Weekdays = Record<number, readonly { open: string; close: string }[] | undefined>;

function kit(lang: Lang, pack: SectorPack, shop: ShopProfile, seed: VariantSeed | undefined, now: Temporal.Instant | undefined) {
  const tz = shop.timeZone;
  const today = now ? todayIn(now, tz) : null;
  const hours = shop.hours as Weekdays;
  const booking = pack.vocabulary[lang].booking;

  const dateOf = (i: Temporal.Instant) => i.toZonedDateTimeISO(tz).toPlainDate();
  /** The open sessions of a local date; a closed day has none. */
  const sessionsOf = (date: Temporal.PlainDate): TimeContext => {
    const day = hours[date.dayOfWeek];
    return { sessions: day ? minuteSessions(day) : [] };
  };
  const clockOf = (i: Temporal.Instant): { clock: ClockTime; ctx: TimeContext; minute: number } => {
    const z = i.toZonedDateTimeISO(tz);
    return { clock: { hour: z.hour, minute: z.minute }, ctx: sessionsOf(z.toPlainDate()), minute: z.hour * 60 + z.minute };
  };

  /** "mañana", "el sábado", "el sábado veinte"; without a clock, by weekday and day of the month. */
  const day = (date: Temporal.PlainDate, withWeekday = false): string => {
    if (today) return speakDay(date, today, lang, { withWeekday });
    return lang === "es"
      ? `el ${WEEKDAY[lang][date.dayOfWeek - 1]} ${speakNumber(date.day, "es")}`
      : `${WEEKDAY[lang][date.dayOfWeek - 1]} the ${speakOrdinal(date.day)}`;
  };
  const isToday = (i: Temporal.Instant) => today !== null && dateOf(i).equals(today);
  /** The time with the day's open sessions, so the period of the day is said only when it is needed. */
  const time = (i: Temporal.Instant) => {
    const c = clockOf(i);
    return speakTime(c.clock, lang, c.ctx);
  };
  /**
   * The time the caller just asked for, said the way they said it: the period of the day is
   * left out (a caller who asked for "las cuatro" hears "a las cuatro"), except at noon and
   * midnight. Only used to echo a rejected request, never to state a free time.
   */
  const echo = (i: Temporal.Instant) => {
    const c = clockOf(i);
    return speakTime(c.clock, lang, { sessions: [{ open: c.minute, close: c.minute + 1 }] });
  };
  /** "mañana a las cinco" / "tomorrow, Friday, at five". */
  const joinDayTime = (d: string, t: string) => (lang === "en" && d.includes(",") ? `${d}, ${t}` : `${d} ${t}`);
  const when = (i: Temporal.Instant, withWeekday = false) => joinDayTime(day(dateOf(i), withWeekday), time(i));
  /** Like `when`, for after a verb: English adds "on" before a weekday date ("on Saturday the twentieth at ten"). */
  const whenOn = (i: Temporal.Instant, withWeekday = false) =>
    lang === "en" ? joinDayTime(enOn(day(dateOf(i), withWeekday)), time(i)) : when(i, withWeekday);

  const spokenService = (id: string): string => serviceView(id, shop, pack).spoken[lang];

  /** What follows "¿Te viene bien …?": the time, with its day only when it differs from the one before. */
  const alternative = (i: Temporal.Instant, before: Temporal.PlainDate | null): string => {
    const d = dateOf(i);
    const c = clockOf(i);
    if (before && d.equals(before)) return lang === "es" ? speakTime(c.clock, lang, c.ctx) : clockWords(c.clock, lang, c.ctx);
    return lang === "es" ? joinDayTime(day(d), time(i)) : `${day(d)} at ${clockWords(c.clock, lang, c.ctx)}`;
  };
  /**
   * The offer, nearest first: the first alternative, then "también" the rest. If naming them all
   * would make a sentence longer than 25 words (alternatives on different days), the farthest are
   * left out, so a caller never hears a sentence cut in the middle.
   */
  const offer = (
    alts: readonly Temporal.Instant[],
    requested: Temporal.PlainDate | null,
    build: (first: string, more: string | null) => string,
  ): string => {
    const shown = alts.slice(0, MAX_OFFERED);
    const parts = shown.map((a, n) => alternative(a, n === 0 ? requested : dateOf(shown[n - 1])));
    let text = "";
    for (let count = parts.length; count >= 1; count--) {
      text = build(parts[0], count > 1 ? joinOr(parts.slice(1, count), lang) : null);
      if (text.split(/(?<=[.!?])\s+/).every((sentence) => wordsIn(sentence) <= MAX_WORDS)) break;
    }
    return text;
  };

  /** A name as it may be spoken: no digits, no sentence punctuation, no markup. */
  const speakableName = (name: string) => name.replace(/[\d.!?…¿¡;:*_#`~[\]|<>{}\\^=]/g, " ").replace(/\s+/g, " ").trim();
  /** The caller's own word for a service, if it is short and plain enough to say back. */
  const plainAsked = (asked: string | null): string | null => {
    if (!asked) return null;
    const cleaned = speakableName(asked);
    const words = cleaned.split(" ").filter(Boolean);
    return words.length > 0 && words.length <= MAX_ASKED_WORDS ? cleaned : null;
  };

  return {
    lang,
    shop,
    pack,
    tz,
    now,
    today,
    hours,
    owner: shop.ownerName,
    booking,
    place: pack.vocabulary[lang].place,
    pick: <T>(key: string, variants: readonly [T, ...T[]]) => pickVariant(seed, key, variants),
    dateOf,
    sessionsOf,
    clockOf,
    day,
    isToday,
    time,
    echo,
    when,
    whenOn,
    spokenService,
    offer,
    speakableName,
    plainAsked,
    catalog: () => catalogItems(shop, lang),
    service: (id: string) => serviceView(id, shop, pack).name[lang],
    view: (id: string) => serviceView(id, shop, pack),
    resource: (id: string) => shop.resources.find((r) => r.id === id)?.name[lang] ?? id,
    slot: (i: Temporal.Instant) => formatSlot(i, tz, lang),
  };
}

type Kit = ReturnType<typeof kit>;

// ---------------------------------------------------------------------------
// Shared by the front-desk-brain templates

/** "un corte de hombre" → "el corte de hombre"; "a fade" → "the fade". */
function definite(spoken: string, lang: Lang): string {
  if (lang === "en") return spoken.replace(/^(a|an) /i, "the ");
  return spoken.replace(/^unos /i, "los ").replace(/^unas /i, "las ").replace(/^una /i, "la ").replace(/^un /i, "el ");
}

/** A part's price as said: "desde" / "from" when it is a starting price. */
function priceWords(cents: number, from: boolean, lang: Lang): string {
  return `${from ? (lang === "es" ? "desde " : "from ") : ""}${speakPrice(cents, lang)}`;
}

/**
 * Up to 3 items in one sentence of at most 25 words, then "the rest" when some are left out
 * (9.1): fewer items are named when the sentence would be longer.
 */
function listSentence(items: readonly string[], lang: Lang, rest: string): string {
  for (let count = Math.min(3, items.length); count >= 1; count--) {
    const sentence = `${cap(joinAnd(items.slice(0, count), lang))}.`;
    if (wordsIn(sentence) <= MAX_WORDS || count === 1) return count < items.length ? `${sentence} ${rest}` : sentence;
  }
  return rest;
}

/** The address as said: digit runs as words, no markup ("Calle Mayor doce, Madrid"). */
function spokenAddress(address: string, lang: Lang): string {
  return address
    .replace(/\d+/g, (d) => speakNumber(Number(d), lang))
    .replace(/[*_#`~<>[\]{}|\\^=/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The services a topic is about: one id (a Combo_Id too), a Service_Choice's candidates, or a Category's services. */
function targetIds(k: Kit, topic: Extract<TopicHit, { kind: "price" | "duration" }>): string[] {
  const t = topic.target;
  if (t.kind === "service") return [t.id];
  if (t.kind === "choice") return t.candidates;
  return k.shop.services.filter((s) => s.category === t.categoryId).map((s) => s.id);
}

/** When the shop is open now, its closing instant; else the next opening within 8 days. Null without a clock. */
function openNow(k: Kit): { open: true; until: Temporal.Instant } | { open: false; next: Temporal.Instant | null } | null {
  if (!k.now) return null;
  const z = k.now.toZonedDateTimeISO(k.tz);
  const at = (date: Temporal.PlainDate, minute: number) =>
    date.toZonedDateTime({ timeZone: k.tz, plainTime: { hour: Math.floor(minute / 60), minute: minute % 60 } }).toInstant();
  const nowMin = z.hour * 60 + z.minute;
  const today = z.toPlainDate();
  for (const s of k.sessionsOf(today).sessions) {
    if (nowMin >= s.open && nowMin < s.close) return { open: true, until: at(today, s.close) };
  }
  for (let d = 0; d <= 8; d++) {
    const date = today.add({ days: d });
    const next = k.sessionsOf(date).sessions.find((s) => d > 0 || s.open > nowMin);
    if (next) return { open: false, next: at(date, next.open) };
  }
  return { open: false, next: null };
}

const TOPIC_LABELS: Record<Lang, Record<"hours" | "address" | "services" | "price" | "duration", string>> = {
  es: { hours: "el horario", address: "la dirección", services: "los servicios", price: "precios", duration: "duraciones" },
  en: { hours: "the opening hours", address: "the address", services: "the services", price: "prices", duration: "how long things take" },
};

/** How the Owner reads an answered topic: a built-in label, or the FAQ_Entry's first alias. */
function topicLabel(shop: ShopProfile, topic: AnsweredTopic, lang: Lang): string {
  if (!topic.startsWith("faq:")) return TOPIC_LABELS[lang][topic as keyof (typeof TOPIC_LABELS)["es"]];
  const id = topic.slice(4);
  return shop.faq?.find((f) => f.id === id)?.aliases[lang][0] ?? id;
}

const WEEKDAY: Record<Lang, readonly string[]> = {
  es: ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"],
  en: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
};

/** English: "on Saturday the twentieth", but "tomorrow", "this Saturday" and "next Saturday" take no "on". */
const enOn = (day: string) => (/^(today|tomorrow|this |next )/i.test(day) ? day : `on ${day}`);

/** Why a request cannot be taken, as the opening of the rejection (Spanish and English share its shape). */
type Why =
  | { kind: "past" }
  | { kind: "closedDay" }
  | { kind: "afterClose" }
  | { kind: "beforeOpen"; opens: Temporal.Instant | null }
  | { kind: "between"; opens: Temporal.Instant | null }
  | { kind: "fits" }
  | { kind: "busy" }
  | { kind: "other" };

function classify(k: Kit, reason: RejectionReason, requested: Temporal.Instant): Why {
  switch (reason) {
    case "in_the_past":
      return { kind: "past" };
    case "closed_day":
      return { kind: "closedDay" };
    case "does_not_fit":
      return { kind: "fits" };
    case "all_resources_busy":
      return { kind: "busy" };
    case "outside_hours": {
      const { ctx, minute } = k.clockOf(requested);
      const sessions = ctx.sessions;
      if (sessions.length === 0) return { kind: "closedDay" };
      const opening = (open: number) =>
        requested
          .toZonedDateTimeISO(k.tz)
          .with({ hour: Math.floor(open / 60), minute: open % 60, second: 0, millisecond: 0, microsecond: 0, nanosecond: 0 })
          .toInstant();
      const first = sessions[0];
      if (minute < first.open) return { kind: "beforeOpen", opens: opening(first.open) };
      const next = sessions.find((s) => s.open > minute);
      if (!next) return { kind: "afterClose" };
      return { kind: "between", opens: opening(next.open) };
    }
    default:
      return { kind: "other" };
  }
}

// ---------------------------------------------------------------------------
// Spanish (Spain, tú)

function spanish(k: Kit): PhraseSet {
  const { shop, owner, booking } = k;
  /** "la cita", "el encargo": Spanish nouns in -o are masculine in every pack's vocabulary. */
  const masculine = /o$/i.test(booking);
  const art = masculine ? "el" : "la";
  const pron = masculine ? "lo" : "la";

  const hello = (name: string | null) => (name ? `Hola ${name}` : "Hola");
  const reason = (why: Why, requested: Temporal.Instant): string => {
    if (why.kind === "past") return "Esa hora ya ha pasado";
    if (why.kind === "closedDay") return `${cap(k.day(k.dateOf(requested), true))} cerramos`;
    const lead = cap(`${k.isToday(requested) ? "" : `${k.day(k.dateOf(requested))} `}${k.echo(requested)}`);
    const opens = (i: Temporal.Instant | null) => (i ? `, abrimos ${k.time(i)}` : "");
    switch (why.kind) {
      case "afterClose":
        return `${lead} ya hemos cerrado`;
      case "beforeOpen":
        return `${lead} todavía no hemos abierto${opens(why.opens)}`;
      case "between":
        return `${lead} estamos cerrados${opens(why.opens)}`;
      case "fits":
        return `${lead} no nos da tiempo antes de cerrar`;
      case "busy":
        return `${lead} ya está todo cogido`;
      default:
        return `${lead} no puede ser`;
    }
  };
  const offerLine = (alts: readonly Temporal.Instant[], requested: Temporal.Instant | null) =>
    k.offer(alts, requested ? k.dateOf(requested) : null, (first, more) =>
      `¿Te viene bien ${first}?${more ? ` También tengo ${more}.` : ""}`,
    );
  const noneNearby = `No encuentro otro hueco cerca, así que se lo dejo apuntado a ${owner} para que te llame.`;

  return {
    greeting: () =>
      said(
        k.pick("greeting", [
          `¡Hola! Estás llamando a ${shop.name}, soy su asistente virtual. ¿En qué te puedo ayudar?`,
          `¡Hola! Has llamado a ${shop.name}. Te atiende su asistente virtual, ¿qué necesitas?`,
        ]),
      ),
    serviceNotOffered: (asked) => {
      const plain = k.plainAsked(asked);
      return said(
        plain
          ? `Uy, ${plain} no hacemos. Tenemos ${k.catalog()}, ¿te interesa algo?`
          : `Uy, eso no lo hacemos. Tenemos ${k.catalog()}, ¿te interesa algo?`,
        plain === null,
      );
    },
    rejected: (why, requested, alts) =>
      said(
        alts.length > 0
          ? `${reason(classify(k, why, requested), requested)}. ${offerLine(alts, requested)}`
          : `${reason(classify(k, why, requested), requested)}. ${noneNearby}`,
      ),
    askDayAndTime: (day) =>
      said(
        day
          ? `¿A qué hora te viene bien ${k.day(day)}?`
          : k.pick("askDayAndTime", ["¿Qué día y a qué hora te viene bien?", "¿Para cuándo lo quieres?"]),
      ),
    timeAcceptedAskName: (start) =>
      said(
        k.pick("timeAcceptedAskName", [
          `Genial, ${k.when(start)} tengo hueco. ¿Me dices tu nombre?`,
          `Vale, ${k.when(start)} me cuadra. ¿A nombre de quién lo pongo?`,
        ]),
      ),
    askName: () => said(k.pick("askName", ["¿Me dices tu nombre?", "¿A nombre de quién lo pongo?"])),
    askNameAgain: () =>
      said(
        k.pick("askNameAgain", [
          `¿Y tu nombre, para ${art} ${booking}?`,
          `Perdona, ¿cómo te llamas, para apuntar ${art} ${booking}?`,
        ]),
      ),
    askPhone: () =>
      said(
        k.pick("askPhone", [
          "Perfecto. ¿Me dejas un teléfono de contacto?",
          "Muy bien. ¿Y un teléfono por si hay que avisarte?",
        ]),
      ),
    serviceInfo: (id) => {
      const v = k.view(id);
      if (!v.known) return said("Claro.");
      const price = `${v.priceFrom ? "desde " : ""}${speakPrice(v.priceCents, "es")}`;
      // A Service_Combo is plural ("un corte y un degradado"), so it says "son", as the First_Offer does.
      if (v.parts.length > 1) return said(`Claro, ${v.spoken.es} son ${speakDuration(v.durationMin, "es")} y ${price}.`);
      return said(`Claro, ${v.spoken.es} dura ${speakDuration(v.durationMin, "es")} y cuesta ${price}.`);
    },
    readBack: (id, start, name, phone) => {
      const phoneSentence = `Tu teléfono es el ${speakPhone(phone, "es")}, ¿vale?`;
      const clean = k.speakableName(name);
      const together = `Te apunto ${k.spokenService(id)} ${k.when(start, true)}${clean ? `, a nombre de ${clean}` : ""}.`;
      // A long name on a far date would push the sentence past 25 words and lose the end of the
      // name when it is clamped, so the name then gets its own sentence.
      const first =
        wordsIn(together) <= MAX_WORDS
          ? together
          : `Te apunto ${k.spokenService(id)} ${k.when(start, true)}.${clean ? ` A nombre de ${clean}.` : ""}`;
      return said(`${first} ${phoneSentence}`, false);
    },
    slotJustTaken: (requested, alts) =>
      said(
        alts.length > 0
          ? `¡Vaya, justo se acaba de ocupar! ${offerLine(alts, requested)}`
          : `¡Vaya, justo se acaba de ocupar! ${noneNearby}`,
      ),
    booked: (id, start) =>
      said(
        k.pick("booked", [
          `¡Hecho! Te esperamos ${k.when(start, true)}. ${owner} verá tu mensaje y te confirma.`,
          `¡Listo, apuntado para ${k.when(start, true)}! ${owner} verá tu mensaje y te confirma.`,
        ]),
      ),
    existingForReschedule: (id, start) =>
      said(`Vale, tienes ${k.spokenService(id)} ${k.when(start, true)}. ¿A qué día y hora te ${pron} cambio?`),
    rescheduleReadBack: (id, start) => said(`Te cambio ${art} ${booking} para ${k.when(start, true)}, ¿vale?`),
    rescheduled: (id, start) =>
      said(`¡Hecho! Tu ${booking} queda para ${k.when(start, true)}. ${owner} verá tu mensaje.`),
    cancelReadBack: (id, start) =>
      said(`Tienes ${k.spokenService(id)} ${k.when(start, true)}. ¿Seguro que ${pron} anulo?`),
    cancelled: () => said(`Hecho, he anulado tu ${booking}. ${owner} verá tu mensaje. ¡Hasta pronto!`),
    bookingNotFound: () => said(`Vaya, no encuentro nada con esos datos. ¿Quieres que le deje un mensaje a ${owner}?`),
    dontKnow: () => said(`Eso no lo sé, pero se lo dejo apuntado a ${owner} y te llama.`),
    goodbye: () => said(`¡Gracias por llamar! ${owner} verá tu mensaje y te dice algo. ¡Hasta luego!`),
    maxTurns: () => said(`Se lo dejo todo apuntado a ${owner} y te llama. ¡Gracias por llamar!`),
    fallbackEnd: () =>
      said(`Perdona, ahora mismo no puedo atenderte bien. Le dejo tu mensaje a ${owner} y te llama, ¿vale?`),
    fallbackRetry: () =>
      said(`Perdona, no te he entendido bien. ¿Me lo repites? Si quieres, se lo dejo apuntado a ${owner}.`),
    rateLimitedStart: () => said("Uy, ahora mismo hay muchas llamadas. Prueba otra vez en unos minutos, ¿vale?"),
    lineCut: () => said(`Se ha cortado la línea. ${owner} tiene tu mensaje y te llamará.`),
    typeInstead: () => said("No te oigo bien, pero puedes escribirme aquí abajo."),
    firstOffer: (id, slot) => {
      const v = k.view(id);
      const question = offerLine([slot], null);
      const invite = "Si prefieres otro día, dímelo.";
      if (!v.known) return said(`${question} ${invite}`);
      const what = `${speakDuration(v.durationMin, "es")} y ${priceWords(v.priceCents, v.priceFrom, "es")}`;
      // "son" for one service and for a Service_Combo alike, so no verb agrees with a plural name (design.md).
      const together = `${cap(v.spoken.es)} son ${what}.`;
      const lead = wordsIn(together) <= MAX_WORDS ? [together] : [`${cap(v.spoken.es)}.`, `Son ${what}.`];
      return said([...lead, question, ...(lead.length === 1 ? [invite] : [])].join(" "));
    },
    offerAgain: (slot) => said(offerLine([slot], null)),
    noSlotNearby: () => said(noneNearby),
    askService: (brief = false) =>
      said(
        brief
          ? "¿Qué te quieres hacer?"
          : k.pick("askService", [
              `Claro. ${catalogLine(shop, "es")} ¿Qué te quieres hacer?`,
              `Vale. ${catalogLine(shop, "es")} ¿Qué te apetece hacerte?`,
            ]),
      ),
    askServiceChoice: (candidates) => {
      const spoken = candidates.map((c) => k.spokenService(c));
      if (spoken.length > 3) return said(`Tenemos ${joinAnd([...spoken.slice(0, 3), "más cosas"], "es")}. ¿Cuál quieres?`);
      // "un corte de mujer", "un corte de hombre", "un corte infantil" → "¿El corte es de mujer, de hombre o infantil?"
      const split = spoken.map((s) => s.split(" "));
      let shared = 0;
      while (split.every((w) => w.length > shared + 1 && w[shared] === split[0][shared])) shared++;
      if (shared >= 2 && /^(un|una)$/.test(split[0][0])) {
        const head = definite(split[0].slice(0, shared).join(" "), "es");
        return said(`¿${cap(head)} es ${joinOr(split.map((w) => w.slice(shared).join(" ")), "es")}?`);
      }
      return said(`¿Cuál quieres: ${joinOr(spoken, "es")}?`);
    },
    topicAnswer: (topic) => {
      switch (topic.kind) {
        case "hours": {
          const now = topic.now ? openNow(k) : null;
          if (now?.open) return said(`Sí, ahora mismo estamos abiertos, hasta ${k.time(now.until).replace(/^a /, "")}.`);
          if (now && !now.open)
            return said(now.next ? `Ahora mismo estamos cerrados. Abrimos ${k.when(now.next)}.` : "Ahora mismo estamos cerrados.");
          if (topic.day) {
            const d = topic.day;
            const text = daySessionsInWords(shop, d.dayOfWeek as Weekday, "es");
            return said(text ? `${cap(k.day(d))} abrimos ${text}.` : `${cap(k.day(d))} cerramos.`);
          }
          const { open, closed } = hoursGroups(shop, "es");
          if (open.length === 0) return said("Ahora mismo no tenemos horario de apertura.");
          const lines = [`Abrimos ${open[0]}.`, ...open.slice(1).map((g) => `Y ${g}.`)];
          if (closed.length > 0) lines.push(`${cap(joinAnd(closed, "es"))} cerramos.`);
          return said(lines.join(" "));
        }
        case "address":
          return said(`Estamos en ${spokenAddress(shop.address, "es")}.`);
        case "services":
          return said(catalogLine(shop, "es"));
        case "price":
        case "duration": {
          const ids = targetIds(k, topic);
          const rest = "Te cuento el resto si quieres.";
          const items = ids.map((id, n) => {
            const v = k.view(id);
            if (!v.known) return v.spoken.es;
            const price = priceWords(v.priceCents, v.priceFrom, "es");
            const dur = speakDuration(v.durationMin, "es");
            if (ids.length === 1)
              return topic.kind === "price" ? `por ${v.spoken.es} son ${price}, y se tarda ${dur}` : `para ${v.spoken.es} se tarda ${dur}, y son ${price}`;
            if (topic.kind === "price") return n === 0 ? `por ${v.spoken.es} son ${price}` : `por ${v.spoken.es} ${price}`;
            return `para ${v.spoken.es} ${n === 0 ? "se tarda " : ""}${dur}`;
          });
          return said(items.length === 0 ? catalogLine(shop, "es") : listSentence(items, "es", rest));
        }
        case "faq": {
          const entry = shop.faq?.find((f) => f.id === topic.id);
          return said(entry ? entry.answer.es : `Eso no lo sé, pero se lo apunto a ${owner}.`);
        }
      }
    },
    ownerNoted: (continuing = false) =>
      said(
        continuing
          ? `Se lo apunto a ${owner} para que te llame.`
          : `Se lo apunto a ${owner} para que te llame. Mientras, ¿te doy cita o te cuento horarios y precios?`,
      ),
    sensitiveNoted: (continuing = false) =>
      said(
        continuing
          ? `De eso no te puedo aconsejar, pero se lo apunto a ${owner} y te llama hoy mismo.`
          : `De eso no te puedo aconsejar, pero se lo apunto a ${owner} y te llama hoy mismo. ¿Te ayudo con algo más?`,
      ),
    unknownKeepAlive: (continuing = false) =>
      said(
        continuing
          ? `Eso no lo sé, pero se lo apunto a ${owner}.`
          : `Eso no lo sé, pero se lo apunto a ${owner}. ¿Te ayudo con una cita, horarios o precios?`,
      ),
    notUnderstood: () =>
      said(
        k.pick("notUnderstood", [
          "Perdona, no te he entendido. Puedo darte cita o contarte horarios, precios y servicios.",
          "Perdona, no te he pillado. Te puedo dar cita o contarte horarios, precios y servicios.",
        ]),
      ),
    notUnderstoodAgain: () =>
      said(`Se lo dejo apuntado a ${owner} por si acaso. Si te resulta más fácil, también puedes escribirme aquí abajo.`),
    languageSwitched: () => said("Claro, seguimos en español. ¿En qué te puedo ayudar?"),
    phoneAgain: () => said("Perdona, no me ha quedado claro el número. ¿Me lo dices otra vez, despacio?"),
    tooManyServices: () =>
      said(`Como mucho te puedo apuntar ${speakNumber(MAX_COMBO_PARTS, "es")} servicios seguidos. ¿Cuáles quieres?`),
    addOnRemoved: (addOns, bases, continuing = false) => {
      const base = joinAnd(bases.map((b) => definite(k.spokenService(b), "es")), "es");
      const extra = addOns.map((a) => definite(k.spokenService(a), "es"));
      const it = extra.length > 1 ? "los quito" : "lo quito";
      const goes = extra.length > 1 ? "van" : "va";
      const text = `Vale, sin ${base}. ${cap(joinAnd(extra, "es"))} ${goes} con ${base}, así que ${it} también.`;
      return said(continuing ? text : `${text} ¿Qué te quieres hacer?`);
    },
    confirmAgain: () => said("¿Te lo dejo apuntado, entonces?"),
    smallTalk: (kind) =>
      said(
        kind === "thanks"
          ? "¡A ti! ¿Te ayudo con algo más?"
          : kind === "greeting"
            ? "¡Hola! ¿En qué te puedo ayudar?"
            : "Vale. ¿Te ayudo con algo más?",
      ),
    owner: {
      defaultReason: () => "Llamada sin terminar",
      agreedBooked: (id, start, res) => `${cap(booking)} de ${k.service(id)} ${k.slot(start)} (${k.resource(res)})`,
      agreedRescheduled: (id, start, res) =>
        `${cap(booking)} de ${k.service(id)} cambiada: ahora ${k.slot(start)} (${k.resource(res)})`,
      agreedCancelled: (id, start) => `${cap(booking)} de ${k.service(id)} anulada: era ${k.slot(start)}`,
      agreedNothing: (detail) => `Nada acordado; ${detail}`,
      detailFallback: () => "el contestador falló a mitad de la llamada",
      detailAbandoned: () => "colgó antes de terminar",
      replyBooked: (name, id, start) =>
        `${hello(name)}, te confirmo tu ${booking} de ${k.service(id)} ${k.slot(start)}. ¡Hasta pronto! ${owner}`,
      replyRescheduled: (name, id, start) =>
        `${hello(name)}, te confirmo el cambio: tu ${booking} de ${k.service(id)} queda ${k.slot(start)}. ¡Hasta pronto! ${owner}`,
      replyCancelled: (name) =>
        `${hello(name)}, te confirmo que he anulado tu ${booking}. Cuando quieras, vuelve a llamar. ${owner}`,
      replyCallBack: (name) =>
        `${hello(name)}, soy ${owner}, de ${shop.name}. He visto tu mensaje, ¿en qué te puedo ayudar?`,
      reasonWants: (names) => `Quiere ${joinOr(names, "es")}`,
      reasonAsked: (topics) => `Preguntó por ${joinAnd(topics.map((t) => topicLabel(shop, t, "es")), "es")}`,
      note: (n) => {
        switch (n.kind) {
          case "owner_request":
            return `Pide que ${owner} le llame`;
          case "sensitive":
            return `Tema delicado («${n.term}»), no se le aconsejó`;
          case "unanswered":
            return `Sin respuesta: «${n.question}»`;
          case "not_understood":
            return "No se le entendió bien";
        }
      },
    },
  };
}

// ---------------------------------------------------------------------------
// English (en-US)

function english(k: Kit): PhraseSet {
  const { shop, owner, booking, place } = k;
  const what = (id: string) => `${k.service(id)} ${booking}`;
  const hello = (name: string | null) => (name ? `Hi ${name}` : "Hi");

  const reason = (why: Why, requested: Temporal.Instant): string => {
    if (why.kind === "past") return "That time has already passed";
    if (why.kind === "closedDay") return `We're closed ${enOn(k.day(k.dateOf(requested), true))}`;
    const lead = cap(`${k.isToday(requested) ? "" : `${k.day(k.dateOf(requested))} `}${k.echo(requested)}`);
    const opens = (i: Temporal.Instant | null) => (i ? `, we open ${k.time(i)}` : "");
    switch (why.kind) {
      case "afterClose":
        return `${lead} we're already closed`;
      case "beforeOpen":
        return `${lead} we're not open yet${opens(why.opens)}`;
      case "between":
        return `${lead} we're closed${opens(why.opens)}`;
      case "fits":
        return `${lead} there isn't enough time before we close`;
      case "busy":
        return `${lead} we're fully booked`;
      default:
        return `${lead} that doesn't work`;
    }
  };
  const offerLine = (alts: readonly Temporal.Instant[], requested: Temporal.Instant | null) =>
    k.offer(alts, requested ? k.dateOf(requested) : null, (first, more) =>
      `Does ${first} work for you?${more ? ` I also have ${more}.` : ""}`,
    );
  const noneNearby = `I can't find another time nearby, so I'll leave a note for ${owner} to call you.`;

  return {
    greeting: () =>
      said(
        k.pick("greeting", [
          `Hi! You've reached ${shop.name}, I'm ${place}'s virtual assistant. How can I help?`,
          `Hello! This is ${shop.name}. You're talking to ${place}'s virtual assistant, what do you need?`,
        ]),
      ),
    serviceNotOffered: (asked) => {
      const plain = k.plainAsked(asked);
      return said(
        plain
          ? `Sorry, we don't do ${plain}. We have ${k.catalog()}, would any of those work?`
          : `Sorry, we don't do that. We have ${k.catalog()}, would any of those work?`,
        plain === null,
      );
    },
    rejected: (why, requested, alts) =>
      said(
        alts.length > 0
          ? `${reason(classify(k, why, requested), requested)}. ${offerLine(alts, requested)}`
          : `${reason(classify(k, why, requested), requested)}. ${noneNearby}`,
      ),
    askDayAndTime: (day) =>
      said(
        day
          ? `What time suits you ${enOn(k.day(day))}?`
          : k.pick("askDayAndTime", ["What day and time suits you?", "When would you like to come in?"]),
      ),
    timeAcceptedAskName: (start) =>
      said(
        k.pick("timeAcceptedAskName", [
          `Great, ${k.when(start)} works. Can I have your name?`,
          `Okay, ${k.when(start)} is free. What name should I put it under?`,
        ]),
      ),
    askName: () => said(k.pick("askName", ["Can I have your name?", "What name should I put it under?"])),
    askNameAgain: () =>
      said(
        k.pick("askNameAgain", [
          `And your name, for the ${booking}?`,
          `Sorry, what's your name, so I can put the ${booking} down?`,
        ]),
      ),
    askPhone: () =>
      said(
        k.pick("askPhone", [
          "Perfect. Can I have a contact number?",
          "Thanks. And a phone number, in case we need to reach you?",
        ]),
      ),
    serviceInfo: (id) => {
      const v = k.view(id);
      if (!v.known) return said("Sure.");
      const price = `${v.priceFrom ? "from " : ""}${speakPrice(v.priceCents, "en")}`;
      if (v.parts.length > 1) return said(`Sure, ${v.spoken.en} take ${speakDuration(v.durationMin, "en")} and cost ${price}.`);
      return said(`Sure, ${v.spoken.en} takes ${speakDuration(v.durationMin, "en")} and costs ${price}.`);
    },
    readBack: (id, start, name, phone) => {
      const phoneSentence = `Your number is ${speakPhone(phone, "en")}, right?`;
      const clean = k.speakableName(name);
      const together = `I'll put you down for ${k.spokenService(id)} ${k.whenOn(start, true)}${clean ? `, under ${clean}` : ""}.`;
      const first =
        wordsIn(together) <= MAX_WORDS
          ? together
          : `I'll put you down for ${k.spokenService(id)} ${k.whenOn(start, true)}.${clean ? ` That's under ${clean}.` : ""}`;
      return said(`${first} ${phoneSentence}`, false);
    },
    slotJustTaken: (requested, alts) =>
      said(
        alts.length > 0
          ? `Oh, that one was just taken! ${offerLine(alts, requested)}`
          : `Oh, that one was just taken! ${noneNearby}`,
      ),
    booked: (id, start) =>
      said(
        k.pick("booked", [
          `Done! See you ${k.whenOn(start, true)}. ${owner} will see your message and confirm.`,
          `All set, you're down for ${k.whenOn(start, true)}! ${owner} will see your message and confirm.`,
        ]),
      ),
    existingForReschedule: (id, start) =>
      said(`Okay, you have ${k.spokenService(id)} ${k.whenOn(start, true)}. What day and time should I move it to?`),
    rescheduleReadBack: (id, start) => said(`I'll move your ${booking} to ${k.whenOn(start, true)}, okay?`),
    rescheduled: (id, start) =>
      said(`Done! Your ${booking} is now ${k.whenOn(start, true)}. ${owner} will see your message.`),
    cancelReadBack: (id, start) =>
      said(`You have ${k.spokenService(id)} ${k.whenOn(start, true)}. Do you want me to cancel it?`),
    cancelled: () => said(`Done, I've cancelled your ${booking}. ${owner} will see your message. Take care!`),
    bookingNotFound: () =>
      said(`Sorry, I can't find anything with those details. Would you like me to leave a message for ${owner}?`),
    dontKnow: () => said(`I don't know that, but I'll leave a note for ${owner} and you'll get a call back.`),
    goodbye: () => said(`Thanks for calling! ${owner} will see your message and get back to you. Bye for now!`),
    maxTurns: () => said(`I'll leave everything for ${owner}, who will call you. Thanks for calling!`),
    fallbackEnd: () =>
      said(`Sorry, I can't help you properly right now. I'll leave your message for ${owner} and you'll get a call back, okay?`),
    fallbackRetry: () =>
      said(`Sorry, I didn't catch that. Could you say it again? Or I can leave a note for ${owner}.`),
    rateLimitedStart: () => said("Oh, there are a lot of calls right now. Please try again in a few minutes, okay?"),
    lineCut: () => said(`The line dropped. ${owner} has your message and will call you.`),
    typeInstead: () => said("I can't hear you well, but you can type to me below."),
    firstOffer: (id, slot) => {
      const v = k.view(id);
      const question = offerLine([slot], null);
      const invite = "If another day suits you better, just say.";
      if (!v.known) return said(`${question} ${invite}`);
      const plural = v.parts.length > 1;
      const what = `${plural ? "take" : "takes"} ${speakDuration(v.durationMin, "en")} and ${plural ? "cost" : "costs"} ${priceWords(v.priceCents, v.priceFrom, "en")}`;
      const together = `${cap(v.spoken.en)} ${what}.`;
      const lead =
        wordsIn(together) <= MAX_WORDS
          ? [together]
          : [`${cap(v.spoken.en)}.`, `${plural ? "Together they" : "It"} ${what}.`];
      return said([...lead, question, ...(lead.length === 1 ? [invite] : [])].join(" "));
    },
    offerAgain: (slot) => said(offerLine([slot], null)),
    noSlotNearby: () => said(noneNearby),
    askService: (brief = false) =>
      said(
        brief
          ? "What would you like to have done?"
          : k.pick("askService", [
              `Sure. ${catalogLine(shop, "en")} What would you like to have done?`,
              `Okay. ${catalogLine(shop, "en")} What can we do for you?`,
            ]),
      ),
    askServiceChoice: (candidates) => {
      const spoken = candidates.map((c) => k.spokenService(c));
      if (spoken.length > 3) return said(`We have ${joinAnd([...spoken.slice(0, 3), "more"], "en")}. Which one would you like?`);
      return said(`Is it ${joinOr(spoken, "en")}?`);
    },
    topicAnswer: (topic) => {
      switch (topic.kind) {
        case "hours": {
          const now = topic.now ? openNow(k) : null;
          if (now?.open) return said(`Yes, we're open right now, until ${k.time(now.until).replace(/^at /, "")}.`);
          if (now && !now.open)
            return said(now.next ? `We're closed right now. We open ${k.whenOn(now.next)}.` : "We're closed right now.");
          if (topic.day) {
            const d = topic.day;
            const text = daySessionsInWords(shop, d.dayOfWeek as Weekday, "en");
            return said(text ? `${cap(enOn(k.day(d)))} we're open ${text}.` : `We're closed ${enOn(k.day(d))}.`);
          }
          const { open, closed } = hoursGroups(shop, "en");
          if (open.length === 0) return said("We don't have any opening hours right now.");
          const lines = [`We're open ${open[0]}.`, ...open.slice(1).map((g) => `And ${g}.`)];
          if (closed.length > 0) lines.push(`We're closed on ${joinAnd(closed, "en")}.`);
          return said(lines.join(" "));
        }
        case "address":
          return said(`We're at ${spokenAddress(shop.address, "en")}.`);
        case "services":
          return said(catalogLine(shop, "en"));
        case "price":
        case "duration": {
          const ids = targetIds(k, topic);
          const rest = "I can tell you about the rest if you like.";
          const items = ids.map((id, n) => {
            const v = k.view(id);
            if (!v.known) return v.spoken.en;
            const price = priceWords(v.priceCents, v.priceFrom, "en");
            const dur = speakDuration(v.durationMin, "en");
            if (ids.length === 1)
              return topic.kind === "price" ? `for ${v.spoken.en} it's ${price}, and it takes ${dur}` : `for ${v.spoken.en} it takes ${dur}, and it's ${price}`;
            if (topic.kind === "price") return n === 0 ? `for ${v.spoken.en} it's ${price}` : `for ${v.spoken.en} ${price}`;
            return `for ${v.spoken.en} ${n === 0 ? "it takes " : ""}${dur}`;
          });
          return said(items.length === 0 ? catalogLine(shop, "en") : listSentence(items, "en", rest));
        }
        case "faq": {
          const entry = shop.faq?.find((f) => f.id === topic.id);
          return said(entry ? entry.answer.en : `I don't know that, but I'll leave a note for ${owner}.`);
        }
      }
    },
    ownerNoted: (continuing = false) =>
      said(
        continuing
          ? `I'll leave a note for ${owner} to call you.`
          : `I'll leave a note for ${owner} to call you. In the meantime, shall I book you in, or tell you our hours and prices?`,
      ),
    sensitiveNoted: (continuing = false) =>
      said(
        continuing
          ? `I can't give advice on that, but I'll leave a note for ${owner} and you'll get a call today.`
          : `I can't give advice on that, but I'll leave a note for ${owner} and you'll get a call today. Can I help with anything else?`,
      ),
    unknownKeepAlive: (continuing = false) =>
      said(
        continuing
          ? `I don't know that, but I'll leave a note for ${owner}.`
          : `I don't know that, but I'll leave a note for ${owner}. Can I help with a booking, our hours or prices?`,
      ),
    notUnderstood: () =>
      said(
        k.pick("notUnderstood", [
          "Sorry, I didn't understand. I can book you in, or tell you our hours, prices and services.",
          "Sorry, I didn't catch that. I can make a booking, or tell you our hours, prices and services.",
        ]),
      ),
    notUnderstoodAgain: () =>
      said(`I'll leave a note for ${owner}, just in case. If it's easier, you can also type to me below.`),
    languageSwitched: () => said("Of course, we can carry on in English. How can I help?"),
    phoneAgain: () => said("Sorry, I didn't quite get the number. Could you say it again, slowly?"),
    tooManyServices: () =>
      said(`I can book at most ${speakNumber(MAX_COMBO_PARTS, "en")} services in a row. Which ones would you like?`),
    addOnRemoved: (addOns, bases, continuing = false) => {
      const base = joinAnd(bases.map((b) => definite(k.spokenService(b), "en")), "en");
      const extra = addOns.map((a) => definite(k.spokenService(a), "en"));
      const plural = extra.length > 1;
      const text = `Okay, no ${bases.map((b) => k.spokenService(b).replace(/^(a|an) /i, "")).join(" or ")}. ${cap(joinAnd(extra, "en"))} ${plural ? "go" : "goes"} with ${base}, so I'll take ${plural ? "them" : "it"} off too.`;
      return said(continuing ? text : `${text} What would you like to have done?`);
    },
    confirmAgain: () => said("Shall I put it down, then?"),
    smallTalk: (kind) =>
      said(
        kind === "thanks"
          ? "You're welcome! Is there anything else I can help with?"
          : kind === "greeting"
            ? "Hi! How can I help?"
            : "Okay. Is there anything else I can help with?",
      ),
    owner: {
      defaultReason: () => "Unfinished call",
      agreedBooked: (id, start, res) => `${cap(what(id))} on ${k.slot(start)} (${k.resource(res)})`,
      agreedRescheduled: (id, start, res) => `${cap(what(id))} moved: now ${k.slot(start)} (${k.resource(res)})`,
      agreedCancelled: (id, start) => `${cap(what(id))} cancelled: was ${k.slot(start)}`,
      agreedNothing: (detail) => `Nothing agreed; ${detail}`,
      detailFallback: () => "the answering machine failed mid-call",
      detailAbandoned: () => "hung up before finishing",
      replyBooked: (name, id, start) =>
        `${hello(name)}, your ${what(id)} on ${k.slot(start)} is confirmed. See you soon! ${owner}`,
      replyRescheduled: (name, id, start) =>
        `${hello(name)}, the change is confirmed: your ${what(id)} is now on ${k.slot(start)}. See you soon! ${owner}`,
      replyCancelled: (name) => `${hello(name)}, your ${booking} is cancelled. Call us whenever you like. ${owner}`,
      replyCallBack: (name) => `${hello(name)}, this is ${owner} from ${shop.name}. I got your message, how can I help?`,
      reasonWants: (names) => `Wants ${joinOr(names, "en")}`,
      reasonAsked: (topics) => `Asked about ${joinAnd(topics.map((t) => topicLabel(shop, t, "en")), "en")}`,
      note: (n) => {
        switch (n.kind) {
          case "owner_request":
            return `Asked for ${owner} to call back`;
          case "sensitive":
            return `Sensitive ("${n.term}"), no advice given`;
          case "unanswered":
            return `No answer for: "${n.question}"`;
          case "not_understood":
            return "Could not be understood";
        }
      },
    },
  };
}
