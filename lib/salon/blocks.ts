import type { ExistingBooking } from "@/lib/booking";
import type { TimeBlock } from "./types";

/**
 * Blocks as busy intervals for the booking rules: a whole-shop block becomes one entry per
 * resource, a block of one resource one entry. The ids (`block:<uuid>:<resourceId>`) never
 * equal a booking id, so no "own booking" lookup can match a block. A block of a resource
 * the shop no longer has is dropped.
 */
export function blocksAsBusy(blocks: readonly TimeBlock[], resources: readonly { id: string }[]): ExistingBooking[] {
  const out: ExistingBooking[] = [];
  for (const b of blocks) {
    for (const r of resources) {
      if (b.resourceId !== null && b.resourceId !== r.id) continue;
      out.push({ id: `block:${b.id}:${r.id}`, resourceId: r.id, start: b.start, end: b.end });
    }
  }
  return out;
}
