import { Temporal } from "temporal-polyfill";
import { checkBooking, toInstant, type RuleContext } from "@/lib/booking";
import { toShopRules, type ShopProfile } from "@/lib/conversation/shopProfile";
import type { Lang, SectorPack } from "@/lib/sectors";
import { fixedPhrases, renderAllVariants, renderer, VariantSeeds, type RenderedLine, type TemplateName } from "./fixedPhrases";

/**
 * Which lines to synthesize ahead of time for a shop, most heard first (natural-voice design.md,
 * "Pre-generation for the demo shop"). Pure: every line is rendered by the real `phrases()` and
 * the same spoken pass as `handleTurn`, with the empty agenda and each of the next 7 days as
 * "today", so a planned line is exactly the text a Call will look up.
 *
 * | Tier | Lines |
 * |---|---|
 * | 1 | the Fixed_Phrases, every variant (pinned) |
 * | 2 | the demo conversation: the first service tomorrow at 21:00, rejected; the first alternative offered, accepted with the name ask; and `booked` (pinned) |
 * | 3 | rejections of a request for today outside hours on an open day, every half hour from an hour before opening to 90 minutes after closing, for each service |
 * | 4 | "time accepted + ask name" for today and tomorrow, at the round and half-past start times inside the sessions |
 * | 5 | `booked` for tomorrow at the same times |
 */

export type Tier = 1 | 2 | 3 | 4 | 5;
export const PINNED_TIERS: ReadonlySet<Tier> = new Set<Tier>([1, 2]);
/** How many days ahead are rendered as "today". */
export const PLAN_DAYS = 7;
/**
 * Tier 4 covers today and tomorrow. Owner's call, 2026-11-15: two days ahead is "el martes",
 * not "pasado mañana", so those lines differ per weekday and no longer repeat every day.
 */
export const TIER4_DAYS = 2;
/** The demo request of `check-turn --conversation`: "mañana a las nueve de la noche". */
export const DEMO_REQUEST_TIME = "21:00";

export interface PlanLine extends RenderedLine {
  tier: Tier;
  lang: Lang;
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

type Sessions = readonly { open: string; close: string }[];

function sessionsOn(shop: ShopProfile, date: Temporal.PlainDate): Sessions {
  return (shop.hours as Record<number, Sessions | undefined>)[date.dayOfWeek] ?? [];
}

/** Round and half-past start times inside the sessions. */
function halfHoursInside(sessions: Sessions): number[] {
  const out: number[] = [];
  for (const s of sessions) {
    for (let t = Math.ceil(minutesOf(s.open) / 30) * 30; t < minutesOf(s.close); t += 30) out.push(t);
  }
  return out;
}

/** Half hours outside the sessions, from an hour before opening to 90 minutes after closing. */
function halfHoursOutside(sessions: Sessions): number[] {
  if (sessions.length === 0) return [];
  const first = minutesOf(sessions[0].open);
  const last = minutesOf(sessions[sessions.length - 1].close);
  const inside = (t: number) => sessions.some((s) => t >= minutesOf(s.open) && t < minutesOf(s.close));
  const out: number[] = [];
  for (let t = Math.max(0, Math.ceil((first - 60) / 30) * 30); t < Math.min(24 * 60, last + 90); t += 30) {
    if (!inside(t)) out.push(t);
  }
  return out;
}

/** The lines of one language, tiers 1 to 5, deduplicated (the first, lowest tier, wins). */
export function cachePlan(shop: ShopProfile, pack: SectorPack, lang: Lang, today: Temporal.PlainDate): PlanLine[] {
  const tz = shop.timeZone;
  const rules = toShopRules(shop);
  const seeds = new VariantSeeds();
  const lines: PlanLine[] = [];
  const add = (tier: Tier, rendered: readonly RenderedLine[]) => {
    for (const r of rendered) lines.push({ ...r, tier, lang });
  };
  const days = Array.from({ length: PLAN_DAYS }, (_, d) => today.add({ days: d }));
  const nowOf = (date: Temporal.PlainDate) => date.toZonedDateTime({ timeZone: tz }).toInstant();
  const ctxOf = (now: Temporal.Instant): RuleContext => ({
    now,
    shop: rules,
    pack: { slotStepMin: pack.slotStepMin, rules: pack.rules },
    existing: [],
  });
  const at = (date: Temporal.PlainDate, minute: number) => toInstant(date, Temporal.PlainTime.from(hhmm(minute)), tz);
  const variants = (now: Temporal.Instant, template: TemplateName, args: readonly unknown[]) =>
    renderAllVariants(renderer(shop, pack, lang, now), seeds, now, template, args);
  /** The first service that can start then, as the Booking_Rules decide with an empty agenda. */
  const accepted = (now: Temporal.Instant, start: Temporal.Instant) => {
    for (const s of shop.services) {
      const v = checkBooking({ serviceId: s.id, start }, ctxOf(now));
      if (v.ok) return { serviceId: s.id, start: v.start };
    }
    return null;
  };

  // Tier 1: the Fixed_Phrases (they do not depend on the day).
  add(1, fixedPhrases(shop, pack, lang, nowOf(today), seeds));

  // Tier 2: the demo conversation, with each day as "today".
  const demoService = shop.services[0].id;
  for (const date of days) {
    const now = nowOf(date);
    const requested = toInstant(date.add({ days: 1 }), Temporal.PlainTime.from(DEMO_REQUEST_TIME), tz);
    const v = checkBooking({ serviceId: demoService, start: requested }, ctxOf(now));
    if (v.ok) continue;
    const alts = v.alternatives.map((a) => a.start);
    add(2, variants(now, "rejected", [v.reason, requested, alts]));
    const chosen = alts[0];
    if (!chosen) continue;
    add(2, variants(now, "timeAcceptedAskName", [chosen]));
    add(2, variants(now, "booked", [demoService, chosen]));
  }

  // Tier 3: a request for today outside the hours of an open day, for each service.
  for (const date of days) {
    const sessions = sessionsOn(shop, date);
    if (sessions.length === 0) continue;
    const now = nowOf(date);
    for (const service of shop.services) {
      for (const minute of halfHoursOutside(sessions)) {
        const requested = at(date, minute);
        const v = checkBooking({ serviceId: service.id, start: requested }, ctxOf(now));
        if (v.ok) continue;
        add(3, variants(now, "rejected", [v.reason, requested, v.alternatives.map((a) => a.start)]));
      }
    }
  }

  // Tier 4: the time is accepted, for today and tomorrow (the only days still said with a
  // relative word, so their lines repeat every day; from two days ahead the line names the weekday).
  for (const date of days) {
    const now = nowOf(date);
    for (let ahead = 0; ahead < TIER4_DAYS; ahead++) {
      const day = date.add({ days: ahead });
      for (const minute of halfHoursInside(sessionsOn(shop, day))) {
        const ok = accepted(now, at(day, minute));
        if (ok) add(4, variants(now, "timeAcceptedAskName", [ok.start]));
      }
    }
  }

  // Tier 5: booked for tomorrow.
  for (const date of days) {
    const now = nowOf(date);
    const tomorrow = date.add({ days: 1 });
    for (const minute of halfHoursInside(sessionsOn(shop, tomorrow))) {
      const ok = accepted(now, at(tomorrow, minute));
      if (ok) add(5, variants(now, "booked", [ok.serviceId, ok.start]));
    }
  }

  return dedupe(lines);
}

function dedupe(lines: readonly PlanLine[]): PlanLine[] {
  const seen = new Set<string>();
  return lines.filter((l) => {
    const id = `${l.lang}\u0000${l.text}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * The whole plan in build order: tiers 1–2 in each language, then tiers 3–5 in each language.
 * `langs` lists the languages whose voice is chosen (English waits for task 2.4).
 */
export function fullCachePlan(shop: ShopProfile, pack: SectorPack, today: Temporal.PlainDate, langs: readonly Lang[]): PlanLine[] {
  const per = langs.map((lang) => cachePlan(shop, pack, lang, today));
  return [...per.flatMap((p) => p.filter((l) => l.tier <= 2)), ...per.flatMap((p) => p.filter((l) => l.tier > 2))];
}
