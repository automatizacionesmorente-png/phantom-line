import { Temporal } from "temporal-polyfill";
import { comboId } from "@/lib/booking/services";
import type { ModelTurn } from "@/lib/receptionist/schema";
import { factsFromModel, type TurnFacts } from "./facts";
import type { CallFields, CallState } from "./types";
import type { ShopProfile } from "./shopProfile";

/** Calling codes and national number shapes the receptionist accepts without a "+". */
const NATIONAL: Record<string, { code: string; national: RegExp }> = {
  ES: { code: "34", national: /^[6789]\d{8}$/ },
};
const ZONE_COUNTRY: Record<string, string> = {
  "Europe/Madrid": "ES",
  "Atlantic/Canary": "ES",
  "Africa/Ceuta": "ES",
};

/** The country whose national numbers a shop accepts, from its time zone. */
export function countryForTimeZone(timeZone: string): string | null {
  return ZONE_COUNTRY[timeZone] ?? null;
}

/**
 * A phone number as heard ("612 34 56 78", "+34 612-345-678", "0034…") to E.164,
 * or null when it is not a plausible number.
 */
export function normalizePhone(raw: string, country: string | null): string | null {
  let s = raw.replace(/[\s\-.()/]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  const nat = country ? NATIONAL[country] : undefined;
  if (s.startsWith("+")) {
    const digits = s.slice(1);
    if (!/^\d{8,15}$/.test(digits)) return null;
    if (nat && digits.startsWith(nat.code) && !nat.national.test(digits.slice(nat.code.length))) return null;
    return `+${digits}`;
  }
  if (!/^\d+$/.test(s) || !nat) return null;
  if (nat.national.test(s)) return `+${nat.code}${s}`;
  if (s.startsWith(nat.code) && nat.national.test(s.slice(nat.code.length))) return `+${s}`;
  return null;
}

/** Lower case, no accents, letters and digits only, single spaces. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The catalog service the caller named, matched on its id, its names in both
 * languages and its aliases, ignoring case and accents. Null when nothing
 * matches or two services match equally well.
 */
export function matchService(text: string, shop: ShopProfile): string | null {
  const said = ` ${normalizeText(text)} `;
  if (said.trim() === "") return null;
  let best: { id: string; score: number } | null = null;
  let tie = false;
  for (const s of shop.services) {
    const names = [s.id.replace(/[-_]/g, " "), s.name.es, s.name.en, ...(s.aliases ?? [])];
    const score = Math.max(
      0,
      ...names.map(normalizeText).filter((n) => n && said.includes(` ${n} `)).map((n) => n.length),
    );
    if (score === 0) continue;
    if (!best || score > best.score) {
      best = { id: s.id, score };
      tie = false;
    } else if (score === best.score) {
      tie = true;
    }
  }
  return best && !tie ? best.id : null;
}

function validDate(s: string): boolean {
  try {
    Temporal.PlainDate.from(s, { overflow: "reject" });
    return true;
  } catch {
    return false;
  }
}

export interface MergeResult {
  fields: CallFields;
  /** The caller named a service that is not in the catalog (as they said it). */
  unknownService: string | null;
  /** The model heard a phone number that is not valid; the old value (if any) is kept. */
  invalidPhone: boolean;
  /** The Call's services would make a Service_Combo the Booking_Rules refuse (over 480 minutes); kept as they were. */
  comboRefused: boolean;
  /** A yes to the slot just offered became the requested time (front-desk-brain 8.4). Not a confirmation. */
  offerAccepted: boolean;
}

/**
 * Server values are kept unless the Turn's facts bring a new, valid, non-null value.
 * A time without a date that matches one of the slots just offered takes that
 * slot's date ("vale, a las siete y media"). A yes with no new day or time while a slot
 * is offered takes that slot as the requested time (8.4); the read-back still needs its own yes.
 */
export function mergeFields(state: CallState, input: TurnFacts | ModelTurn, shop: ShopProfile): MergeResult {
  // A validated model turn is read through the same matcher as the model path (front-desk-brain 4.9).
  const facts: TurnFacts = "source" in input ? input : factsFromModel(input, null, shop, { state });
  const fields: CallFields = { ...state.fields };
  let unknownService: string | null = null;
  let invalidPhone = false;
  let comboRefused = false;
  let offerAccepted = false;

  const name = facts.name?.trim().replace(/\s+/g, " ");
  if (name) fields.name = name;

  if (facts.phone !== null) {
    const phone = normalizePhone(facts.phone, countryForTimeZone(shop.timeZone));
    if (phone) fields.phone = phone;
    else invalidPhone = true;
  }

  // Services: the Call's list after this utterance, as one id or one Combo_Id (7.1, 7.3).
  const next = facts.serviceChange.next;
  if (facts.services.kind === "unknown") unknownService = facts.services.said.trim();
  if (next !== null) {
    if (next.length === 0) {
      delete fields.serviceId;
    } else {
      const id = next.length === 1 ? next[0] : comboId(next, shop.services);
      if (id) fields.serviceId = id;
      else comboRefused = true;
    }
    if (!comboRefused) delete fields.serviceChoice;
  }
  if (facts.services.kind === "choice" && next === null) {
    fields.serviceChoice = { candidates: [...facts.services.candidates], with: [...facts.services.with] };
  } else if (facts.services.kind === "category" && next === null) {
    const categoryId = facts.services.categoryId;
    const ids = shop.services.filter((s) => s.category === categoryId).map((s) => s.id);
    if (ids.length > 0) fields.serviceChoice = { candidates: ids, with: [...facts.services.with] };
  }

  // A time with no day takes the day said earlier ("el martes" … "a las cinco", 5.6).
  let date = facts.date ?? fields.requested?.date ?? (facts.time !== null ? (fields.day ?? null) : null);
  let time = facts.time ?? fields.requested?.time ?? null;
  if (facts.time !== null && facts.date === null && state.lastOffer?.length) {
    const offered = state.lastOffer
      .map((iso) => Temporal.Instant.from(iso).toZonedDateTimeISO(shop.timeZone))
      .find((z) => z.toPlainTime().toString().slice(0, 5) === facts.time);
    if (offered) date = offered.toPlainDate().toString();
  }
  // 8.4: "sí" to the slot just offered, with no new day or time.
  if (
    facts.yes &&
    facts.date === null &&
    facts.time === null &&
    state.stage === "collecting" &&
    state.lastOffer?.length
  ) {
    const z = Temporal.Instant.from(state.lastOffer[0]).toZonedDateTimeISO(shop.timeZone);
    date = z.toPlainDate().toString();
    time = z.toPlainTime().toString().slice(0, 5);
    offerAccepted = true;
  }
  if (date && time && validDate(date)) fields.requested = { date, time };
  // A day heard without a time narrows the First_Offer (5.6, 8.1).
  if (facts.date !== null && validDate(facts.date)) fields.day = facts.date;
  if (facts.partOfDay !== null) fields.partOfDay = facts.partOfDay;

  return { fields, unknownService, invalidPhone, comboRefused, offerAccepted };
}
