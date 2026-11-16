import type { Temporal } from "temporal-polyfill";
import type { RejectionReason } from "@/lib/booking";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import type { Lang, SectorPack } from "@/lib/sectors";
import { formatSlot, joinAnd, joinOr } from "./format";
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

  const spokenService = (id: string): string => {
    const s = shop.services.find((x) => x.id === id);
    if (!s) return id;
    if (s.spokenName) return s.spokenName[lang];
    const name = s.name[lang];
    if (lang === "es") return `${/o$/i.test(booking) ? "un" : "una"} ${booking} de ${name}`;
    return `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name} ${booking}`;
  };

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
    catalog: () => joinAnd(shop.services.map((s) => s.name[lang]), lang),
    service: (id: string) => shop.services.find((s) => s.id === id)?.name[lang] ?? id,
    resource: (id: string) => shop.resources.find((r) => r.id === id)?.name[lang] ?? id,
    slot: (i: Temporal.Instant) => formatSlot(i, tz, lang),
  };
}

type Kit = ReturnType<typeof kit>;

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
      const s = shop.services.find((x) => x.id === id);
      if (!s) return said("Claro.");
      return said(`Claro, ${k.spokenService(id)} dura ${speakDuration(s.durationMin, "es")} y cuesta ${speakPrice(s.priceCents, "es")}.`);
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
      const s = shop.services.find((x) => x.id === id);
      if (!s) return said("Sure.");
      return said(`Sure, ${k.spokenService(id)} takes ${speakDuration(s.durationMin, "en")} and costs ${speakPrice(s.priceCents, "en")}.`);
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
    },
  };
}
