import type { Temporal } from "temporal-polyfill";
import type { RejectionReason } from "@/lib/booking";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import type { Lang, SectorPack } from "@/lib/sectors";
import { formatDay, formatSlot, formatSlotList, joinAnd } from "./format";

/**
 * Every templated line the receptionist says, and the owner-facing texts of a
 * Message, in one language. Lines that state facts about bookings, times or
 * availability always come from here, never from the model.
 */
export interface PhraseSet {
  greeting(): string;
  serviceNotOffered(asked: string | null): string;
  rejected(reason: RejectionReason, requested: Temporal.Instant, alternatives: readonly Temporal.Instant[]): string;
  /**
   * The service is known but the day or the time is not: the code asks for it itself, so
   * the caller never hears the model's own words about opening hours (Requirement 5.8).
   */
  askDayAndTime(day: Temporal.PlainDate | null): string;
  slotJustTaken(alternatives: readonly Temporal.Instant[]): string;
  readBack(serviceId: string, start: Temporal.Instant): string;
  booked(serviceId: string, start: Temporal.Instant): string;
  existingForReschedule(serviceId: string, start: Temporal.Instant): string;
  rescheduleReadBack(serviceId: string, newStart: Temporal.Instant): string;
  rescheduled(serviceId: string, newStart: Temporal.Instant): string;
  cancelReadBack(serviceId: string, start: Temporal.Instant): string;
  cancelled(): string;
  /** The same words whether no booking exists for the phone or the name does not match (12.7). */
  bookingNotFound(): string;
  dontKnow(): string;
  goodbye(): string;
  maxTurns(): string;
  fallbackEnd(): string;
  fallbackRetry(): string;
  rateLimitedStart(): string;
  lineCut(): string;
  typeInstead(): string;
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

export function phrases(lang: Lang, pack: SectorPack, shop: ShopProfile): PhraseSet {
  return lang === "es" ? spanish(pack, shop) : english(pack, shop);
}

function common(lang: Lang, pack: SectorPack, shop: ShopProfile) {
  const tz = shop.timeZone;
  return {
    tz,
    owner: shop.ownerName,
    booking: pack.vocabulary[lang].booking,
    slot: (i: Temporal.Instant) => formatSlot(i, tz, lang),
    day: (d: Temporal.PlainDate) => formatDay(d, lang),
    list: (is: readonly Temporal.Instant[]) => formatSlotList(is, tz, lang),
    service: (id: string) => shop.services.find((s) => s.id === id)?.name[lang] ?? id,
    resource: (id: string) => shop.resources.find((r) => r.id === id)?.name[lang] ?? id,
    catalog: () => joinAnd(shop.services.map((s) => s.name[lang]), lang),
  };
}

function spanish(pack: SectorPack, shop: ShopProfile): PhraseSet {
  const c = common("es", pack, shop);
  const why: Record<string, string> = {
    in_the_past: "esa hora ya ha pasado",
    closed_day: "ese día está cerrado",
    outside_hours: "a esa hora está cerrado",
    does_not_fit: "no da tiempo antes de cerrar",
    all_resources_busy: "a esa hora está todo ocupado",
  };
  const hello = (name: string | null) => (name ? `Hola ${name}` : "Hola");
  return {
    greeting: () =>
      `Hola, has llamado a ${shop.name}. Ahora mismo no pueden atenderte, soy su contestador. ¿En qué te ayudo?`,
    serviceNotOffered: (asked) =>
      `${asked ? `No hacemos ${asked}` : "Ese servicio no lo hacemos"}. Hacemos ${c.catalog()}.`,
    rejected: (reason, requested, alts) =>
      alts.length > 0
        ? `${cap(c.slot(requested))} no es posible, ${why[reason] ?? "a esa hora no se puede"}. Tengo libre ${c.list(alts)}.`
        : `${cap(c.slot(requested))} no es posible, ${why[reason] ?? "a esa hora no se puede"}. No encuentro otro hueco cerca, se lo dejo apuntado a ${c.owner} para que te llame.`,
    askDayAndTime: (day) =>
      day ? `¿A qué hora te viene bien ${c.day(day)}?` : "¿Qué día y a qué hora te viene bien?",
    slotJustTaken: (alts) =>
      alts.length > 0
        ? `Justo se acaba de ocupar. Tengo libre ${c.list(alts)}.`
        : `Justo se acaba de ocupar y no encuentro otro hueco cerca. Se lo dejo apuntado a ${c.owner} para que te llame.`,
    readBack: (id, start) => `Entonces, ${c.booking} de ${c.service(id)} ${c.slot(start)}. ¿Te lo confirmo?`,
    booked: (id, start) =>
      `Apuntado: ${c.booking} de ${c.service(id)} ${c.slot(start)}. ${c.owner} verá tu mensaje y te confirma.`,
    existingForReschedule: (id, start) =>
      `Tienes ${c.booking} de ${c.service(id)} ${c.slot(start)}. ¿Qué otro día y hora te viene bien?`,
    rescheduleReadBack: (id, start) =>
      `Entonces paso tu ${c.booking} de ${c.service(id)} ${c.slot(start)}. ¿Te lo confirmo?`,
    rescheduled: (id, start) =>
      `Apuntado: tu ${c.booking} de ${c.service(id)} pasa ${c.slot(start)}. ${c.owner} verá tu mensaje y te confirma.`,
    cancelReadBack: (id, start) =>
      `Tienes ${c.booking} de ${c.service(id)} ${c.slot(start)}. ¿Confirmas que la anulo?`,
    cancelled: () => `Hecho, he anulado tu ${c.booking}. ${c.owner} verá tu mensaje.`,
    bookingNotFound: () => `No encuentro nada con esos datos. ¿Quieres que le deje un mensaje a ${c.owner}?`,
    dontKnow: () => `Eso no lo sé, pero se lo dejo apuntado a ${c.owner} para que te llame.`,
    goodbye: () => `Gracias por llamar. ${c.owner} verá tu mensaje y te llamará.`,
    maxTurns: () => `Te dejo el mensaje a ${c.owner} y te llamará. Gracias por llamar.`,
    fallbackEnd: () =>
      `Perdona, ahora mismo no puedo atenderte bien. Le dejo tu mensaje a ${c.owner} y te llamará.`,
    fallbackRetry: () =>
      `Perdona, no te he entendido. ¿Me lo repites? Si prefieres, se lo dejo apuntado a ${c.owner}.`,
    rateLimitedStart: () => "Ahora mismo hay muchas llamadas, vuelve a intentarlo en unos minutos.",
    lineCut: () => `Se ha cortado la línea. ${c.owner} tiene tu mensaje y te llamará.`,
    typeInstead: () => "No te oigo bien, pero puedes escribirme aquí.",
    owner: {
      defaultReason: () => "Llamada sin terminar",
      agreedBooked: (id, start, res) => `${cap(c.booking)} de ${c.service(id)} ${c.slot(start)} (${c.resource(res)})`,
      agreedRescheduled: (id, start, res) =>
        `${cap(c.booking)} de ${c.service(id)} cambiada: ahora ${c.slot(start)} (${c.resource(res)})`,
      agreedCancelled: (id, start) => `${cap(c.booking)} de ${c.service(id)} anulada: era ${c.slot(start)}`,
      agreedNothing: (detail) => `Nada acordado; ${detail}`,
      detailFallback: () => "el contestador falló a mitad de la llamada",
      detailAbandoned: () => "colgó antes de terminar",
      replyBooked: (name, id, start) =>
        `${hello(name)}, te confirmo tu ${c.booking} de ${c.service(id)} ${c.slot(start)}. ¡Hasta pronto! ${c.owner}`,
      replyRescheduled: (name, id, start) =>
        `${hello(name)}, te confirmo el cambio: tu ${c.booking} de ${c.service(id)} queda ${c.slot(start)}. ¡Hasta pronto! ${c.owner}`,
      replyCancelled: (name) =>
        `${hello(name)}, te confirmo que he anulado tu ${c.booking}. Cuando quieras, vuelve a llamar. ${c.owner}`,
      replyCallBack: (name) =>
        `${hello(name)}, soy ${c.owner}, de ${shop.name}. He visto tu mensaje, ¿en qué te puedo ayudar?`,
    },
  };
}

function english(pack: SectorPack, shop: ShopProfile): PhraseSet {
  const c = common("en", pack, shop);
  const why: Record<string, string> = {
    in_the_past: "that time has already passed",
    closed_day: "we're closed that day",
    outside_hours: "we're closed at that time",
    does_not_fit: "there isn't enough time before closing",
    all_resources_busy: "we're fully booked then",
  };
  const a = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);
  const what = (id: string) => `${c.service(id)} ${c.booking}`;
  const hello = (name: string | null) => (name ? `Hi ${name}` : "Hi");
  return {
    greeting: () =>
      `Hi, you've reached ${shop.name}. Nobody can pick up right now, I'm the answering machine. How can I help?`,
    serviceNotOffered: (asked) =>
      `${asked ? `We don't do ${asked}` : "We don't offer that service"}. We do ${c.catalog()}.`,
    rejected: (reason, requested, alts) =>
      alts.length > 0
        ? `${cap(c.slot(requested))} isn't possible, ${why[reason] ?? "that time doesn't work"}. I have ${c.list(alts)}.`
        : `${cap(c.slot(requested))} isn't possible, ${why[reason] ?? "that time doesn't work"}. I can't find another time nearby, so I'll leave a note for ${c.owner} to call you.`,
    askDayAndTime: (day) => (day ? `What time suits you on ${c.day(day)}?` : "What day and time suits you?"),
    slotJustTaken: (alts) =>
      alts.length > 0
        ? `That time was just taken. I have ${c.list(alts)}.`
        : `That time was just taken and I can't find another one nearby. I'll leave a note for ${c.owner} to call you.`,
    readBack: (id, start) => `So, ${a(what(id))} on ${c.slot(start)}. Shall I confirm it?`,
    booked: (id, start) =>
      `Done: ${a(what(id))} on ${c.slot(start)}. ${c.owner} will see your message and confirm.`,
    existingForReschedule: (id, start) =>
      `You have ${a(what(id))} on ${c.slot(start)}. What other day and time suits you?`,
    rescheduleReadBack: (id, start) => `So I'll move your ${what(id)} to ${c.slot(start)}. Shall I confirm it?`,
    rescheduled: (id, start) =>
      `Done: your ${what(id)} is now on ${c.slot(start)}. ${c.owner} will see your message and confirm.`,
    cancelReadBack: (id, start) => `You have ${a(what(id))} on ${c.slot(start)}. Shall I cancel it?`,
    cancelled: () => `Done, I've cancelled your ${c.booking}. ${c.owner} will see your message.`,
    bookingNotFound: () => `I can't find anything with those details. Shall I leave a message for ${c.owner}?`,
    dontKnow: () => `I don't know that, but I'll leave a note for ${c.owner} to call you.`,
    goodbye: () => `Thanks for calling. ${c.owner} will see your message and call you back.`,
    maxTurns: () => `I'll leave your message for ${c.owner} and she'll call you. Thanks for calling.`,
    fallbackEnd: () =>
      `Sorry, I can't help properly right now. I'll leave your message for ${c.owner} and she'll call you back.`,
    fallbackRetry: () => `Sorry, I didn't catch that. Could you say it again? Or I can leave a note for ${c.owner}.`,
    rateLimitedStart: () => "There are a lot of calls right now, please try again in a few minutes.",
    lineCut: () => `The line dropped. ${c.owner} has your message and will call you.`,
    typeInstead: () => "I can't hear you well, but you can type to me here.",
    owner: {
      defaultReason: () => "Unfinished call",
      agreedBooked: (id, start, res) => `${cap(what(id))} on ${c.slot(start)} (${c.resource(res)})`,
      agreedRescheduled: (id, start, res) => `${cap(what(id))} moved: now ${c.slot(start)} (${c.resource(res)})`,
      agreedCancelled: (id, start) => `${cap(what(id))} cancelled: was ${c.slot(start)}`,
      agreedNothing: (detail) => `Nothing agreed; ${detail}`,
      detailFallback: () => "the answering machine failed mid-call",
      detailAbandoned: () => "hung up before finishing",
      replyBooked: (name, id, start) =>
        `${hello(name)}, your ${what(id)} on ${c.slot(start)} is confirmed. See you soon! ${c.owner}`,
      replyRescheduled: (name, id, start) =>
        `${hello(name)}, the change is confirmed: your ${what(id)} is now on ${c.slot(start)}. See you soon! ${c.owner}`,
      replyCancelled: (name) =>
        `${hello(name)}, your ${c.booking} is cancelled. Call us whenever you like. ${c.owner}`,
      replyCallBack: (name) => `${hello(name)}, this is ${c.owner} from ${shop.name}. I got your message, how can I help?`,
    },
  };
}
