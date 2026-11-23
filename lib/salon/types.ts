import type { Temporal } from "temporal-polyfill";

/** Time nobody can book: a day off, a holiday, a break. `resourceId` null = the whole shop. */
export interface TimeBlock {
  id: string;
  resourceId: string | null;
  start: Temporal.Instant;
  /** Exclusive. */
  end: Temporal.Instant;
  reason: string;
}
