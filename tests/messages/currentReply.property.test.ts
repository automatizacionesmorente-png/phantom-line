import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { buildOwnerMessage } from "@/lib/conversation/ownerMessage";
import { initialCallState } from "@/lib/conversation/types";
import { currentReply, type ReplyBooking } from "@/lib/messages/currentReply";
import { phrases } from "@/lib/receptionist/phrases";
import { getSectorPack, type Lang } from "@/lib/sectors";
import { lolaProfile } from "../fixtures/lola";

/**
 * Backlog 19. Whatever the Caller or the Owner did to the Booking after the Message, the
 * Current_Reply never names a time that is not the Booking's current time: a cancelled Booking
 * names no time at all, a moved one names its new time, an untouched one its original time.
 */
const pack = getSectorPack("hair-salon");
const createdAt = Temporal.Instant.from("2026-11-10T12:00:00Z");
const originalStart = Temporal.Instant.from("2026-11-11T18:30:00Z"); // Wednesday 11, 19:30
const movedStart = Temporal.Instant.from("2026-11-13T09:00:00Z"); // Friday 13, 10:00

const arbBooking = fc.record({
  status: fc.constantFrom<"confirmed" | "cancelled">("confirmed", "cancelled"),
  cancelledBy: fc.constantFrom<"caller" | "owner" | null>("caller", "owner", null),
  ownerMoved: fc.constantFrom<"never" | "before" | "after">("never", "before", "after"),
});

describe("currentReply never names a stale time (backlog 19)", () => {
  it("over every sequence of caller and owner actions, in both languages", () => {
    fc.assert(
      fc.property(arbBooking, fc.constantFrom<Lang>("es", "en"), (b, lang) => {
        const state = { ...initialCallState(lang), fields: { name: "Ana", phone: "+34612345678", serviceId: "haircut" } };
        const stored = {
          ...buildOwnerMessage(state, "booked", lolaProfile, pack, { serviceId: "haircut", start: originalStart, resourceId: "chair-1" }),
          createdAt,
        };
        const movedAfter = b.ownerMoved === "after" && b.status === "confirmed";
        const booking: ReplyBooking = {
          serviceId: "haircut",
          start: movedAfter ? movedStart : originalStart,
          status: b.status,
          cancelledBy: b.status === "cancelled" ? (b.cancelledBy ?? "caller") : null,
          ownerMovedAt:
            b.ownerMoved === "never" ? null : Temporal.Instant.from(b.ownerMoved === "after" ? "2026-11-10T15:00:00Z" : "2026-11-10T11:00:00Z"),
        };
        const o = phrases(lang, pack, lolaProfile).owner;
        const named = (start: Temporal.Instant) => o.replyBooked("Ana", "haircut", start);
        const reply = currentReply(stored, booking, lang, lolaProfile, pack);
        const slotOf = (start: Temporal.Instant) => named(start).split(", ")[1].match(/(el|on|este|this) .*?(?=\.)/)?.[0];
        const oldTime = slotOf(originalStart);
        const newTime = slotOf(movedStart);
        if (b.status === "cancelled") {
          expect(reply).toBe(o.replyCancelled("Ana"));
        } else if (movedAfter) {
          expect(reply).toBe(o.replyRescheduled("Ana", "haircut", movedStart));
          expect(reply).not.toContain(oldTime!);
        } else {
          expect(reply).toBe(stored.suggestedReply);
          expect(reply).not.toContain(newTime!);
        }
      }),
      { numRuns: 200 },
    );
  });
});
