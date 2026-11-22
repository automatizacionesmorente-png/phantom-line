import { Temporal } from "temporal-polyfill";
import type { Lang, SectorPack } from "@/lib/sectors";
import { minuteSessions, todayIn, type MinuteRange } from "@/lib/receptionist/spoken";
import type { CallState } from "../types";
import type { ShopProfile } from "../shopProfile";
import { LEXICON, lexiconWords, phrasesOf } from "./lexicon";
import { phraseAt, tokenize, words, type Tok } from "./normalize";
import { readName, readPhone } from "./person";
import { matchServices, serviceIndex, servicesOfCall, type ServiceMatch, type ServiceRequest } from "./services";
import { matchTopic, type TopicHit } from "./topics";
import { readWhen, type PartOfDay } from "./when";

/**
 * The Code_Brain's one entry point (front-desk-brain 3.1–3.6, 19.2; design.md "The Reading",
 * "What makes a Reading sure"). Pure and synchronous: no I/O, no model, no clock of its own.
 */

export type BrainIntent =
  | "owner_request"
  | "language_switch"
  | "yes"
  | "no"
  | "cancel"
  | "reschedule"
  | "booking"
  | "question"
  | "goodbye"
  | "thanks"
  | "greeting"
  | "unknown";

/** The Intent order of Requirement 3.3 (a Sensitive_Hit is a field of its own, between the first two). */
export const INTENT_ORDER: readonly BrainIntent[] = [
  "owner_request",
  "language_switch",
  "yes",
  "no",
  "cancel",
  "reschedule",
  "booking",
  "question",
  "goodbye",
  "thanks",
  "greeting",
  "unknown",
];

/** Why a Reading is sure, for tests and the Timing_Panel; never shown to anyone. */
export type SureBasis =
  | "read_back_answer"
  | "offer_answer"
  | "choice_answer"
  | "next_field"
  | "service_request"
  | "topic"
  | "owner_request"
  | "sensitive"
  | "language_switch"
  | "closing";

export interface Reading {
  intents: BrainIntent[];
  services: ServiceRequest;
  /** What the service request does to the Call's services (Add_On bases, removals, the cap). */
  serviceChange: Pick<ServiceMatch, "next" | "removed" | "removedAddOns" | "tooMany" | "choiceAnswered">;
  day: Temporal.PlainDate | null;
  time: Temporal.PlainTime | null;
  partOfDay: PartOfDay | null;
  name: string | null;
  /** E.164, already through `normalizePhone`. */
  phone: string | null;
  phoneRejected: boolean;
  yes: boolean;
  no: boolean;
  topic: TopicHit | null;
  ownerRequest: boolean;
  sensitive: { term: string; lang: Lang } | null;
  wantsLanguage: Lang | null;
  question: boolean;
  /** Normalized words no rule placed, for the not-understood rule only. */
  leftover: string;
  /** How many of them count against a Sure_Reading (19.2). */
  unplaced: number;
  sure: boolean;
  sureBasis: SureBasis | null;
}

export interface ReadInput {
  utterance: string;
  state: CallState;
  shop: ShopProfile;
  pack: SectorPack;
  now: Temporal.Instant;
  lang: Lang;
}

/** At most this many unplaced words in a Sure_Reading (19.2). */
export const MAX_UNPLACED = 2;

/** The next field the booking asks for, in the pack's order. */
export function nextField(state: CallState, pack: SectorPack): SectorPack["requiredFields"][number] | null {
  for (const f of pack.requiredFields) {
    if (f === "service" && !state.fields.serviceId) return f;
    if (f === "requestedTime" && !state.fields.requested) return f;
    if (f === "name" && !state.fields.name) return f;
    if (f === "phone" && !state.fields.phone) return f;
  }
  return null;
}

/** The shop's open sessions of a local date, in minutes. */
export function sessionsOfShop(shop: ShopProfile): (d: Temporal.PlainDate) => MinuteRange[] {
  return (d) => minuteSessions(shop.hours[d.dayOfWeek as 1 | 2 | 3 | 4 | 5 | 6 | 7] ?? []);
}

function anyPhrase(toks: readonly Tok[], phrases: readonly (readonly string[])[], free: (i: number) => boolean): { start: number; end: number } | null {
  for (const p of phrases)
    for (let i = 0; i + p.length <= toks.length; i++) {
      if (!phraseAt(toks, i, p)) continue;
      let ok = true;
      for (let k = i; k < i + p.length; k++) if (!free(k)) ok = false;
      if (ok) return { start: i, end: i + p.length };
    }
  return null;
}

const BOTH = new Map<string, readonly (readonly string[])[]>();
function both(list: Parameters<typeof phrasesOf>[1]): readonly (readonly string[])[] {
  let p = BOTH.get(list);
  if (!p) {
    p = [...phrasesOf("es", list), ...phrasesOf("en", list)].sort((a, b) => b.length - a.length);
    BOTH.set(list, p);
  }
  return p;
}

/** Owner_Request phrases with the owner's name and the lexicon's owner words in place of `{owner}`. */
const OWNER_PHRASES = new WeakMap<ShopProfile, (readonly string[])[]>();
function ownerPhrases(shop: ShopProfile): (readonly string[])[] {
  const cached = OWNER_PHRASES.get(shop);
  if (cached) return cached;
  const owners = [words(shop.ownerName), ...both("ownerWords")];
  const out: (readonly string[])[] = [];
  for (const lang of ["es", "en"] as const) {
    for (const template of LEXICON[lang].ownerRequest) {
      if (!template.includes("{owner}")) {
        out.push(words(template));
        continue;
      }
      const [before, after] = template.split("{owner}");
      for (const o of owners) out.push([...words(before), ...o, ...words(after)]);
    }
  }
  const result = out.filter((p) => p.length > 0).sort((a, b) => b.length - a.length);
  OWNER_PHRASES.set(shop, result);
  return result;
}

const ARTICLES = new Set(["un", "una", "unos", "unas", "el", "la", "los", "las", "a", "an", "some", "the"]);

/** What the Code_Brain understood in one utterance. */
export function readUtterance(input: ReadInput): Reading {
  const { utterance, state, shop, pack, now, lang } = input;
  const toks = tokenize(utterance);
  const today = todayIn(now, shop.timeZone);
  const sessionsOf = sessionsOfShop(shop);
  const lex = lexiconWords();
  const placed = new Set<number>();
  const isPlaced = (i: number) => placed.has(i);
  const addAll = (s: Iterable<number>) => {
    for (const k of s) placed.add(k);
  };

  const current = servicesOfCall(state.fields.serviceId);
  const waitingReadBack = state.stage === "awaiting_confirmation" && state.pending !== undefined;
  const waitingOffer = state.stage === "collecting" && (state.lastOffer?.length ?? 0) > 0;
  const choice = state.fields.serviceChoice ?? null;
  const field = state.stage === "collecting" ? nextField(state, pack) : null;

  // 1. FAQ aliases first: their words belong to the FAQ (9.7).
  const faqFirst = matchTopic(toks, shop, { lang, pack, current });
  const faq = faqFirst.faqPlaced;
  addAll(faq);

  // 2. A phone, before the clock reader, so its digits are never a time (5.7).
  const phone = readPhone(utterance, shop.timeZone, { skip: isPlaced });
  addAll(phone.placed);

  // 3. Services.
  const svc = matchServices(toks, shop, { current, choice, skip: isPlaced });
  addAll(svc.placed);

  // 4. Day and time.
  const defaultDay = state.fields.requested?.date ?? state.fields.day ?? null;
  const when = readWhen(toks, today, lang, sessionsOf, {
    defaultDay: defaultDay ? Temporal.PlainDate.from(defaultDay) : null,
    skip: isPlaced,
  });
  addAll(when.placed);

  // 5. Topics, now that the services and the day are known.
  const topicRead = matchTopic(toks, shop, { lang, pack, current, day: when.day, services: svc });
  addAll(topicRead.placed);
  const topic = topicRead.topic;

  // 6. Owner_Request and language switch.
  const owner = anyPhrase(toks, ownerPhrases(shop), (i) => !faq.has(i));
  if (owner) for (let k = owner.start; k < owner.end; k++) placed.add(k);
  let wantsLanguage: Lang | null = null;
  const toEn = anyPhrase(toks, both("toEn"), (i) => !faq.has(i));
  const toEs = anyPhrase(toks, both("toEs"), (i) => !faq.has(i));
  const target: Lang | null = toEn && !toEs ? "en" : toEs && !toEn ? "es" : null;
  for (const s of [toEn, toEs]) if (s) for (let k = s.start; k < s.end; k++) placed.add(k);
  if (topic?.kind === "faq") {
    const alias = [...faq].map((k) => toks[k].w);
    if (lang === "es" && alias.some((x) => x === "ingles" || x === "english")) wantsLanguage = "en";
    if (lang === "en" && alias.some((x) => x === "spanish" || x === "espanol")) wantsLanguage = "es";
  }
  if (target) wantsLanguage = target;
  if (wantsLanguage && (wantsLanguage === state.language || !shop.languages.includes(wantsLanguage))) wantsLanguage = null;

  // 7. Name.
  const index = serviceIndex(shop);
  const name = readName(toks, {
    expectName: field === "name",
    ownerName: shop.ownerName,
    shopName: shop.name,
    isShopWord: (x) => index.aliasWords.has(x),
    skip: isPlaced,
  });
  if (name) addAll(name.placed);

  // 8. Yes and no: only as the first word or phrase (3.5).
  const lead = new Set(["pues", "bueno", "eh", "em", "mm", "ehm", "oye", "mira", "well", "so", "um", "uh", "erm", "hmm"]);
  let first = 0;
  while (first < toks.length && lead.has(toks[first].w)) first++;
  const yesAt = both("yes").find((p) => phraseAt(toks, first, p));
  const noAt = yesAt ? undefined : both("no").find((p) => phraseAt(toks, first, p));
  const yes = yesAt !== undefined;
  const no = noAt !== undefined;
  const answer = yesAt ?? noAt;
  if (answer) for (let k = first; k < first + answer.length; k++) placed.add(k);

  // 9. Intent words.
  const free = (i: number) => !faq.has(i);
  const cancel = anyPhrase(toks, both("cancel"), free);
  const reschedule = anyPhrase(toks, both("reschedule"), free);
  const bookingWord = anyPhrase(toks, both("booking"), free);
  const wanting = anyPhrase(toks, both("wanting"), free);
  for (const s of [cancel, reschedule, bookingWord, wanting]) if (s) for (let k = s.start; k < s.end; k++) placed.add(k);

  // A service word not in the catalog, right after a wanting word: "quería una manicura" (4.8).
  let services: ServiceRequest = svc.request;
  if (services.kind === "none" && !topic && wanting) {
    let k = wanting.end;
    if (ARTICLES.has(toks[k]?.w ?? "")) k++;
    const said: number[] = [];
    while (k < toks.length && said.length < 3 && !placed.has(k) && !lex.has(toks[k].w) && !/\d/.test(toks[k].w)) {
      if (said.length > 0 && toks[k].brk) break;
      said.push(k);
      k++;
    }
    const ends = k >= toks.length || placed.has(k) || toks[k].brk || lex.has(toks[k].w);
    if (said.length >= 1 && said.length <= 2 && ends && k > wanting.end) {
      services = { kind: "unknown", said: said.map((x) => toks[x].raw).join(" ") };
      addAll(said);
    }
  }

  const hasService = services.kind !== "none";
  const hasWhen = when.day !== null || when.time !== null || when.partOfDay !== null;
  const question = /[¿?]/.test(utterance) || (toks[first] !== undefined && both("question").some((p) => phraseAt(toks, first, p)));
  const flow = cancel !== null || reschedule !== null;
  const booking = hasService || bookingWord !== null || (hasWhen && !flow && !topic && !owner);
  const closingBlocked = booking || flow || topic !== null;
  const goodbye = !closingBlocked && anyPhrase(toks, both("goodbye"), free) !== null;
  const thanks = anyPhrase(toks, both("thanks"), free) !== null;
  const greeting = anyPhrase(toks, both("greeting"), free) !== null;

  const intents: BrainIntent[] = [];
  const push = (x: BrainIntent, on: boolean) => {
    if (on) intents.push(x);
  };
  const waitingAnswer = waitingReadBack || waitingOffer || choice !== null;
  push("owner_request", owner !== null);
  push("language_switch", wantsLanguage !== null);
  push("yes", yes && waitingAnswer);
  push("no", no && waitingAnswer);
  push("cancel", cancel !== null);
  push("reschedule", reschedule !== null);
  push("booking", booking);
  push("question", topic !== null || question);
  push("goodbye", goodbye);
  push("thanks", thanks);
  push("greeting", greeting);
  if (intents.length === 0) intents.push("unknown");

  // 10. What no rule placed (19.2): lexicon words, greetings, fillers and the shop's names never count.
  const nameWords = new Set([...words(shop.ownerName), ...words(shop.name)]);
  const left: string[] = [];
  toks.forEach((t, k) => {
    if (placed.has(k) || lex.has(t.w) || nameWords.has(t.w)) return;
    left.push(t.w);
  });

  // 11. Sure (design.md, "What makes a Reading sure").
  const newFacts = hasService || svc.next !== null || when.day !== null || when.time !== null;
  let basis: SureBasis | null = null;
  // A read-back answer is a first-word yes or no; a change is read as a change, and is sure when placed.
  if (waitingReadBack && (yes || no || newFacts)) basis = "read_back_answer";
  else if (waitingOffer && (yes || no || hasWhen)) basis = "offer_answer";
  else if (choice && svc.choiceAnswered) basis = "choice_answer";
  else if (
    (field === "name" && name !== null) ||
    // A phone once the name is known is sure even before a time: with no free slot the Call takes a message.
    ((field === "phone" || (state.stage === "collecting" && state.fields.name !== undefined && !state.fields.phone)) &&
      (phone.phone !== null || phone.rejected)) ||
    (field === "requestedTime" && hasWhen)
  )
    basis = "next_field";
  else if (owner) basis = "owner_request";
  else if (topicRead.sensitive) basis = "sensitive";
  else if (wantsLanguage) basis = "language_switch";
  else if (topic) basis = "topic";
  else if (hasService && booking) basis = "service_request";
  else if ((goodbye || thanks) && intents.every((x) => x === "goodbye" || x === "thanks" || x === "greeting")) basis = "closing";
  const sure = basis !== null && left.length <= MAX_UNPLACED;

  return {
    intents,
    services,
    serviceChange: {
      next: svc.next,
      removed: svc.removed,
      removedAddOns: svc.removedAddOns,
      tooMany: svc.tooMany,
      choiceAnswered: svc.choiceAnswered,
    },
    day: when.day,
    time: when.time,
    partOfDay: when.partOfDay,
    name: name?.name ?? null,
    phone: phone.phone,
    phoneRejected: phone.rejected,
    yes,
    no,
    topic,
    ownerRequest: owner !== null,
    sensitive: topicRead.sensitive,
    wantsLanguage,
    question,
    leftover: left.join(" "),
    unplaced: left.length,
    sure,
    sureBasis: sure ? basis : null,
  };
}
