import { Temporal } from "temporal-polyfill";
import type { ExistingBooking } from "@/lib/booking";
import { buildOwnerMessage } from "@/lib/conversation/ownerMessage";
import { messageWrite } from "@/lib/conversation/messageWrite";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import type { CallerBooking, NewBooking, Repository, StoredCall, Write } from "@/lib/conversation/types";
import { getSectorPack } from "@/lib/sectors";

/**
 * An in-memory `Repository` for the conversation-level properties (front-desk-brain task 9.1).
 * It keeps what the PGlite repository keeps, with the same rules that matter to `handleTurn`:
 *
 * - `commit` is atomic: the writes run in order on a copy, and the copy replaces the store only
 *   if every write succeeded. An insert that overlaps a confirmed booking of the same shop and
 *   resource (half-open `[start, end)`, like the `bookings_no_overlap` constraint) returns
 *   `{ ok: false, conflict: "booking_overlap" }` and writes nothing, like SQLSTATE 23P01.
 * - One Booking per Call and one Message per Call, like `bookings_call_uq` and `messages_call_uq`:
 *   a second booking for the same Call throws (a unique violation is not an overlap); a second
 *   Message for the same Call is ignored (`onConflictDoNothing`).
 * - A cancel only touches a confirmed booking; an update of an unknown Call changes nothing.
 * - The JSON columns (`state`, `transcript`) are copied through JSON, as `jsonb` would.
 *
 * `tests/conversation/memoryRepository.test.ts` compares it with the PGlite repository on the
 * same scripted Calls.
 */
export interface MemoryBooking extends NewBooking {
  status: "confirmed" | "cancelled";
  cancelledBy?: "caller";
}

export type MemoryMessage = Extract<Write, { type: "insertMessage" }>["message"] & { createdAt: Temporal.Instant };

interface Store {
  calls: Map<string, StoredCall>;
  bookings: MemoryBooking[];
  messages: MemoryMessage[];
  rate: Map<string, number>;
}

export interface MemoryRepository extends Repository {
  readonly calls: () => StoredCall[];
  readonly bookings: () => MemoryBooking[];
  readonly messages: () => MemoryMessage[];
  /** Every commit's result, in order. */
  readonly commits: ("ok" | "booking_overlap")[];
}

const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const overlaps = (a: { start: Temporal.Instant; end: Temporal.Instant }, b: { start: Temporal.Instant; end: Temporal.Instant }) =>
  Temporal.Instant.compare(a.start, b.end) < 0 && Temporal.Instant.compare(b.start, a.end) < 0;

class OverlapConflict extends Error {}

function copyStore(s: Store): Store {
  return {
    calls: new Map([...s.calls].map(([k, v]) => [k, { ...v }])),
    bookings: s.bookings.map((b) => ({ ...b })),
    messages: [...s.messages],
    rate: new Map(s.rate),
  };
}

export function memoryRepository(opts: {
  shops: readonly ShopProfile[];
  /** The `updatedAt` of a written Call; the real clock by default, as `now()` in Postgres. */
  clock?: () => Temporal.Instant;
}): MemoryRepository {
  const shops = new Map(opts.shops.map((s) => [s.id, json(s)]));
  const clock = opts.clock ?? (() => Temporal.Now.instant());
  let store: Store = { calls: new Map(), bookings: [], messages: [], rate: new Map() };
  const commits: ("ok" | "booking_overlap")[] = [];

  function apply(s: Store, w: Write): void {
    switch (w.type) {
      case "insertCall": {
        if (s.calls.has(w.call.id)) throw new Error(`duplicate call id ${w.call.id}`);
        if (!shops.has(w.call.shopId)) throw new Error(`unknown shop ${w.call.shopId}`);
        s.calls.set(w.call.id, { ...w.call, state: json(w.call.state), transcript: json(w.call.transcript), updatedAt: clock() });
        return;
      }
      case "updateCall": {
        const c = s.calls.get(w.callId);
        if (!c) return;
        s.calls.set(w.callId, {
          ...c,
          state: json(w.state),
          language: w.state.language,
          transcript: json(w.transcript),
          turnCount: w.turnCount,
          updatedAt: clock(),
          ...(w.status ? { status: w.status } : {}),
        });
        return;
      }
      case "insertBooking": {
        const b = w.booking;
        if (Temporal.Instant.compare(b.start, b.end) >= 0) throw new Error("booking ends before it starts");
        if (s.bookings.some((x) => x.callId === b.callId)) throw new Error(`a second booking for call ${b.callId}`);
        if (!s.calls.has(b.callId)) throw new Error(`booking for unknown call ${b.callId}`);
        const clash = s.bookings.some(
          (x) => x.status === "confirmed" && x.shopId === b.shopId && x.resourceId === b.resourceId && overlaps(x, b),
        );
        if (clash) throw new OverlapConflict();
        s.bookings.push({ ...b, status: "confirmed" });
        return;
      }
      case "cancelBooking": {
        const b = s.bookings.find((x) => x.id === w.bookingId && x.status === "confirmed");
        if (b) Object.assign(b, { status: "cancelled", cancelledBy: "caller" });
        return;
      }
      case "insertMessage": {
        if (s.messages.some((m) => m.callId === w.message.callId)) return;
        s.messages.push({ ...json(w.message), createdAt: clock() });
        return;
      }
    }
  }

  const repo: MemoryRepository = {
    calls: () => [...store.calls.values()].map((c) => ({ ...c, state: json(c.state), transcript: json(c.transcript) })),
    bookings: () => store.bookings.map((b) => ({ ...b })),
    messages: () => store.messages.map((m) => ({ ...m })),
    commits,

    async getShop(id) {
      const s = shops.get(id);
      return s ? json(s) : null;
    },

    async getCall(id, shopId) {
      const c = store.calls.get(id);
      if (!c || c.shopId !== shopId) return null;
      return { ...c, state: json(c.state), transcript: json(c.transcript) };
    },

    async listBookings(shopId, from, to): Promise<ExistingBooking[]> {
      return store.bookings
        .filter(
          (b) =>
            b.shopId === shopId &&
            b.status === "confirmed" &&
            Temporal.Instant.compare(b.start, to) < 0 &&
            Temporal.Instant.compare(b.end, from) > 0,
        )
        .sort((a, b) => Temporal.Instant.compare(a.start, b.start) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((b) => ({ id: b.id, resourceId: b.resourceId, start: b.start, end: b.end }));
    },

    async findCallerBookings(shopId, phone, now): Promise<CallerBooking[]> {
      return store.bookings
        .filter((b) => b.shopId === shopId && b.status === "confirmed" && b.customerPhone === phone && Temporal.Instant.compare(b.start, now) >= 0)
        .sort((a, b) => Temporal.Instant.compare(a.start, b.start))
        .map((b) => ({
          id: b.id,
          resourceId: b.resourceId,
          serviceId: b.serviceId,
          start: b.start,
          end: b.end,
          customerName: b.customerName,
          customerPhone: b.customerPhone,
        }));
    },

    async commit(writes) {
      if (writes.length === 0) return { ok: true };
      const next = copyStore(store);
      try {
        for (const w of writes) apply(next, w);
      } catch (err) {
        if (err instanceof OverlapConflict) {
          commits.push("booking_overlap");
          return { ok: false, conflict: "booking_overlap" };
        }
        throw err;
      }
      store = next;
      commits.push("ok");
      return { ok: true };
    },

    async hitRateLimits(visitorKey, now) {
      const ms = now.epochMilliseconds;
      const vk = `${visitorKey}@${ms - (ms % 60_000)}`;
      const gk = `global@${ms - (ms % 3_600_000)}`;
      store.rate.set(vk, (store.rate.get(vk) ?? 0) + 1);
      store.rate.set(gk, (store.rate.get(gk) ?? 0) + 1);
      return { visitor: store.rate.get(vk)!, global: store.rate.get(gk)! };
    },

    async pruneRateLimits(before) {
      let n = 0;
      for (const k of [...store.rate.keys()]) {
        if (Number(k.slice(k.lastIndexOf("@") + 1)) < before.epochMilliseconds) {
          store.rate.delete(k);
          n++;
        }
      }
      return n;
    },

    async closeStaleCalls(shopId, idleBefore, now = Temporal.Now.instant()) {
      const shop = shops.get(shopId);
      if (!shop) return 0;
      const pack = getSectorPack(shop.sectorPackId);
      let closed = 0;
      for (const call of [...store.calls.values()]) {
        if (call.shopId !== shopId || call.status !== "open" || Temporal.Instant.compare(call.updatedAt, idleBefore) >= 0) continue;
        const state = { ...call.state, stage: "done" as const, pending: undefined };
        const message = buildOwnerMessage(state, "abandoned", shop, pack);
        await repo.commit([
          { type: "updateCall", callId: call.id, state, transcript: call.transcript, turnCount: call.turnCount, status: "abandoned" },
          messageWrite(message, { call, shop, pack, transcript: call.transcript, now }),
        ]);
        closed++;
      }
      return closed;
    },
  };
  return repo;
}
