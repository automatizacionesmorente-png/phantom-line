import { describe, expect, it } from "vitest";
import type { AgendaDayDto, AgendaItem } from "@/lib/owner/api";
import { withAgendaItem } from "@/lib/owner/poll";

/** Owner-machine task 11: the page replaces one Agenda row with the server's answer (9.1, 9.4). */
const row = (id: string, start: string, over: Partial<AgendaItem> = {}): AgendaItem => ({
  id,
  revision: 0,
  resourceId: "chair-1",
  serviceId: "haircut",
  start,
  end: start,
  status: "booked",
  cancelledBy: null,
  customerName: id,
  channel: "voice", source: "receptionist", state: "pending", paidCents: null, priceCents: null, visitNote: "",
  actions: [],
  lastOwnerAction: null,
  ...over,
});

const days: AgendaDayDto[] = [
  { date: "2026-10-24", items: [row("a", "2026-10-24T08:00:00Z"), row("b", "2026-10-24T09:00:00Z")] },
  { date: "2026-10-25", items: [row("c", "2026-10-25T09:00:00Z")] },
];

describe("withAgendaItem", () => {
  it("replaces a row in place and keeps the day's order", () => {
    const out = withAgendaItem(days, row("a", "2026-10-24T08:00:00Z", { status: "confirmed", revision: 1 }), "Europe/Madrid");
    expect(out[0].items.map((i) => [i.id, i.status])).toEqual([
      ["a", "confirmed"],
      ["b", "booked"],
    ]);
    expect(out[1]).toEqual(days[1]);
  });

  it("a cancelled row goes below the active rows of its day", () => {
    const out = withAgendaItem(days, row("a", "2026-10-24T08:00:00Z", { status: "cancelled" }), "Europe/Madrid");
    expect(out[0].items.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("a moved row leaves its old day and joins the day of its new local start", () => {
    // 23:30 UTC on 24 October is 01:30 on the 25th in Madrid (still summer time).
    const out = withAgendaItem(days, row("a", "2026-10-24T23:30:00Z"), "Europe/Madrid");
    expect(out[0].items.map((i) => i.id)).toEqual(["b"]);
    expect(out[1].items.map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("a row moved outside the shown days disappears from them", () => {
    const out = withAgendaItem(days, row("c", "2026-11-02T09:00:00Z"), "Europe/Madrid");
    expect(out.flatMap((d) => d.items.map((i) => i.id))).toEqual(["a", "b"]);
  });

  it("does not change its input", () => {
    const before = JSON.stringify(days);
    withAgendaItem(days, row("a", "2026-10-25T10:00:00Z"), "Europe/Madrid");
    expect(JSON.stringify(days)).toBe(before);
  });
});
