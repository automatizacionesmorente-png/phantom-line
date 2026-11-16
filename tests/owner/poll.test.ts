import { describe, expect, it, vi } from "vitest";
import { Temporal } from "temporal-polyfill";
import type { AgendaBooking } from "@/lib/owner/agenda";
import { pollResponse, toAgendaItem, type Snapshot } from "@/lib/owner/poll";
import { tapeItem } from "./pollFixtures";

const head = { version: 41, counts: { new: 2, unheard: 1 } };
const snapshot: Snapshot = {
  now: "2026-11-12T10:00:00Z",
  tape: [tapeItem("m1"), tapeItem("m2", { heard: true })],
  agenda: [{ date: "2026-11-12", items: [] }],
};

describe("pollResponse (owner-machine 12.2, 12.3)", () => {
  it("the unchanged body has exactly changed, version and counts, and loads nothing", async () => {
    const load = vi.fn(async () => snapshot);
    const res = await pollResponse(41, head, load);
    expect(Object.keys(res).sort()).toEqual(["changed", "counts", "version"]);
    expect(res).toEqual({ changed: false, version: 41, counts: { new: 2, unheard: 1 } });
    expect(load).not.toHaveBeenCalled();
    expect(new TextEncoder().encode(JSON.stringify(res)).length).toBeLessThan(200);
  });

  it("the changed body has the tape and the agenda, for another version and for no version", async () => {
    for (const since of [40, 42, null]) {
      const res = await pollResponse(since, head, async () => snapshot);
      expect(res.changed).toBe(true);
      if (!res.changed) continue;
      expect(res.version).toBe(41);
      expect(res.counts).toEqual(head.counts);
      expect(res.now).toBe(snapshot.now);
      expect(res.tape.map((t) => t.id)).toEqual(["m1", "m2"]);
      expect(res.agenda).toEqual(snapshot.agenda);
    }
  });

  it("drops any key a row carries beyond TapeItem, the Transcript first (14.2)", async () => {
    const leaky = { ...tapeItem("m1"), transcript: [{ caller: "Soy Ana", receptionist: "Hola" }], visitorKey: "v" };
    const res = await pollResponse(null, head, async () => ({ ...snapshot, tape: [leaky] }));
    if (!res.changed) throw new Error("expected the full body");
    expect(res.tape[0]).toEqual(tapeItem("m1"));
    expect(JSON.stringify(res)).not.toContain("transcript");
  });

  it("returns a plain body: Cache-Control is set by the handler, not here (12.8)", async () => {
    for (const since of [41, null]) {
      const res = await pollResponse(since, head, async () => snapshot);
      expect(res).not.toBeInstanceOf(Response);
      expect(Object.getPrototypeOf(res)).toBe(Object.prototype);
      expect(JSON.stringify(res).toLowerCase()).not.toContain("cache-control");
      expect(Object.keys(res)).not.toContain("headers");
    }
  });
});

describe("toAgendaItem", () => {
  const at = (s: string) => Temporal.Instant.from(s);
  const booking: AgendaBooking = {
    id: "b1",
    revision: 2,
    resourceId: "chair-1",
    serviceId: "corte",
    start: at("2026-11-14T16:00:00Z"),
    end: at("2026-11-14T16:30:00Z"),
    status: "confirmed",
    ownerConfirmedAt: null,
    cancelledBy: null,
    customerName: "Ana",
    channel: "voice",
    lastOwnerAction: { action: "move", label: "Lola", at: at("2026-11-12T09:00:00Z") },
  };

  it("sends ISO instants, the Owner's word for the status and the actions allowed now", () => {
    expect(toAgendaItem(booking, at("2026-11-12T10:00:00Z"))).toEqual({
      id: "b1",
      revision: 2,
      resourceId: "chair-1",
      serviceId: "corte",
      start: "2026-11-14T16:00:00Z",
      end: "2026-11-14T16:30:00Z",
      status: "booked",
      cancelledBy: null,
      customerName: "Ana",
      channel: "voice",
      actions: ["confirm", "move", "cancel"],
      lastOwnerAction: { action: "move", label: "Lola", at: "2026-11-12T09:00:00Z" },
    });
    expect(toAgendaItem(booking, at("2026-11-14T16:00:00Z")).actions).toEqual([]);
    expect(toAgendaItem({ ...booking, lastOwnerAction: null }, at("2026-11-12T10:00:00Z")).lastOwnerAction).toBeNull();
  });
});
