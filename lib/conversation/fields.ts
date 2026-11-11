import { Temporal } from "temporal-polyfill";
import type { ModelTurn } from "@/lib/receptionist/schema";
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
}

/**
 * Server values are kept unless the model returns a new, valid, non-null value.
 * A time without a date that matches one of the slots just offered takes that
 * slot's date ("vale, a las siete y media").
 */
export function mergeFields(state: CallState, turn: ModelTurn, shop: ShopProfile): MergeResult {
  const fields: CallFields = { ...state.fields };
  let unknownService: string | null = null;
  let invalidPhone = false;

  const name = turn.name?.trim().replace(/\s+/g, " ");
  if (name) fields.name = name;

  if (turn.phone !== null) {
    const phone = normalizePhone(turn.phone, countryForTimeZone(shop.timeZone));
    if (phone) fields.phone = phone;
    else invalidPhone = true;
  }

  if (turn.service !== null) {
    const id = matchService(turn.service, shop);
    if (id) fields.serviceId = id;
    else unknownService = turn.service.trim();
  }

  let date = turn.date ?? fields.requested?.date ?? null;
  const time = turn.time ?? fields.requested?.time ?? null;
  if (turn.time !== null && turn.date === null && state.lastOffer?.length) {
    const offered = state.lastOffer
      .map((iso) => Temporal.Instant.from(iso).toZonedDateTimeISO(shop.timeZone))
      .find((z) => z.toPlainTime().toString().slice(0, 5) === turn.time);
    if (offered) date = offered.toPlainDate().toString();
  }
  if (date && time && validDate(date)) fields.requested = { date, time };

  return { fields, unknownService, invalidPhone };
}
