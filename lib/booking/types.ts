import type { Temporal } from "temporal-polyfill";

export type ServiceId = string;
export type ResourceId = string;
/** ISO weekday, 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** One opening session, local wall-clock "HH:MM", open < close, same local day. */
export interface Session {
  open: string;
  close: string;
}
export type WeeklyHours = Readonly<Partial<Record<Weekday, readonly Session[]>>>;

export interface Service {
  id: ServiceId;
  durationMin: number;
}
export interface Resource {
  id: ResourceId;
}

export interface ShopRules {
  /** IANA time zone, e.g. "Europe/Madrid". */
  timeZone: string;
  hours: WeeklyHours;
  services: readonly Service[];
  /** Order = allocation preference. */
  resources: readonly Resource[];
}

export interface ExistingBooking {
  id: string;
  resourceId: ResourceId;
  start: Temporal.Instant;
  /** Exclusive. */
  end: Temporal.Instant;
}

export interface BookingRequest {
  /** May be unknown: rejected with "unknown_service". */
  serviceId: string;
  start: Temporal.Instant;
  /** The booking being rescheduled; it does not make its resource busy. */
  ignoreBookingId?: string;
}

export interface SessionInstants {
  open: Temporal.Instant;
  close: Temporal.Instant;
}

export interface SectorRuleInput {
  service: Service;
  start: Temporal.Instant;
  end: Temporal.Instant;
  session: SessionInstants;
  timeZone: string;
}
export type SectorRule = (input: SectorRuleInput) => { ok: true } | { ok: false; reason: string };

export interface RuleContext {
  now: Temporal.Instant;
  shop: ShopRules;
  /** The parts of a SectorPack the rules use. */
  pack: { slotStepMin: number; rules: readonly SectorRule[] };
  existing: readonly ExistingBooking[];
}

export type RejectionReason =
  | "unknown_service"
  | "in_the_past"
  | "closed_day"
  | "outside_hours"
  | "does_not_fit"
  | "all_resources_busy"
  | `sector:${string}`;

export type Evaluation =
  | {
      ok: true;
      resourceId: ResourceId;
      start: Temporal.Instant;
      end: Temporal.Instant;
      session: SessionInstants;
    }
  | { ok: false; reason: RejectionReason };

export type AcceptedVerdict = Extract<Evaluation, { ok: true }>;
export type Verdict =
  | AcceptedVerdict
  | { ok: false; reason: RejectionReason; alternatives: readonly Slot[] };

export interface Slot {
  start: Temporal.Instant;
  end: Temporal.Instant;
  resourceId: ResourceId;
}

export interface SlotSearchOptions {
  /** Default 3. */
  limit?: number;
  /** Default 14. */
  windowDays?: number;
}
