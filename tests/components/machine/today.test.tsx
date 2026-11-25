// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MACHINE_COPY } from "@/components/machine/machineCopy";
import { TodayView } from "@/components/machine/today/TodayView";
import type { ClientsResponse } from "@/lib/clients/api";
import type { AgendaDayDto } from "@/lib/owner/api";
import { agendaItem, demoShop, NOW, stubMatchMedia } from "./machineFixtures";

/** Salon spec 2.1: Today, the booking book (Tuesday 10 November 2026, 09:00 in Madrid). */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** 11:30 local: the shop is open, so the red line is on the book. */
const OPEN = "2026-11-10T10:30:00Z";
const PAYMENTS = { day: "2026-11-10", totalCents: 6000, byMethod: { cash: 3500, card: 2000, bizum: 500, voucher: 0 }, count: 3 };

function clientsWith(note: string): ClientsResponse {
  return {
    now: NOW,
    lapsed: [],
    clients: [
      {
        id: "c1",
        name: "Ana",
        phone: "+34600000009",
        language: "es",
        note,
        birthday: null,
        promoConsentAt: null,
        fields: {},
        spentCents: 0,
        totalVisits: 1,
        noShows: 0,
        lastVisit: null,
        upcoming: "2026-11-10T09:00:00Z",
        intervalDays: null,
        usualServices: [],
        history: [
          { bookingId: "b1", serviceId: "haircut", start: "2026-11-10T09:00:00Z", end: "2026-11-10T09:30:00Z", state: "upcoming", canMarkNoShow: false, paidCents: null, visitNote: "" },
        ],
      },
    ],
  };
}

function stubApi(note = "", payments: unknown = PAYMENTS) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (/\/blocks\?/.test(url)) return json({ blocks: [{ id: "k1", resourceId: null, start: "2026-11-10T11:00:00Z", end: "2026-11-10T12:00:00Z", reason: "Médico" }] });
    if (/\/payments\?day=/.test(url)) return json(payments);
    if (/\/clients$/.test(url)) return json(clientsWith(note));
    return json({ error: "unavailable" }, 503);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const DAYS = ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17"];
const agenda: AgendaDayDto[] = DAYS.map((date) => ({
  date,
  items:
    date === "2026-11-10"
      ? [
          // 10:00 to 10:30 local on chair 1; the second chair is empty.
          agendaItem({ id: "b1", start: "2026-11-10T09:00:00Z", end: "2026-11-10T09:30:00Z", priceCents: 1500 }),
          agendaItem({ id: "b3", start: "2026-11-10T10:00:00Z", end: "2026-11-10T10:30:00Z", status: "cancelled", priceCents: 9900, customerName: "Fuera" }),
        ]
      : [],
}));

function view(over: Partial<React.ComponentProps<typeof TodayView>> = {}) {
  return render(
    <TodayView
      shop={demoShop}
      lang="es"
      copy={MACHINE_COPY.es}
      agenda={agenda}
      now={OPEN}
      newMessages={2}
      refreshKey={1}
      onOpenTape={() => {}}
      onItem={() => {}}
      onLocked={() => {}}
      onRefresh={() => {}}
      {...over}
    />,
  );
}

beforeEach(() => stubMatchMedia(false));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Today, the booking book", () => {
  it("shows one column per resource with names from the pack", async () => {
    stubApi();
    view();
    const cols = [...document.querySelectorAll("[data-column]")];
    expect(cols.map((c) => c.getAttribute("data-column"))).toEqual(demoShop.resources.map((r) => r.id));
    expect(screen.getByText("Sillón 1")).toBeTruthy();
    expect(screen.getByText("Sillón 2")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText("Médico")[0]).toBeTruthy());
  });

  it("four numbers: appointments, free slots, expected takings (cancelled ones left out) and messages", async () => {
    stubApi();
    view();
    const k = (id: string) => document.querySelector(`[data-kpi="${id}"]`)!.textContent!;
    expect(k("appointments")).toContain("1");
    expect(k("takings")).toContain("15");
    expect(k("takings")).not.toContain("114");
    expect(Number(k("free").match(/\d+/)![0])).toBeGreaterThan(0);
    expect(k("messages")).toContain("2");
    await waitFor(() => expect(screen.getAllByText("Médico")[0]).toBeTruthy());
  });

  it("the messages number opens the tape", () => {
    stubApi();
    const onOpenTape = vi.fn();
    view({ onOpenTape });
    fireEvent.click(screen.getByRole("button", { name: /Mensajes nuevos/ }));
    expect(onOpenTape).toHaveBeenCalledTimes(1);
  });

  it("free gap opens the new booking dialog pre-filled", () => {
    stubApi();
    view();
    const gap = document.querySelector<HTMLElement>('[data-column="chair-1"] [data-free]')!;
    expect(gap).not.toBeNull();
    fireEvent.click(gap);
    const dialog = screen.getByRole("dialog");
    expect((within(dialog).getByLabelText("Hora") as HTMLInputElement).value).toBe("10:30");
    expect((within(dialog).getByLabelText("Día") as HTMLInputElement).value).toBe("2026-11-10");
    expect((within(dialog).getByLabelText("Agenda de") as HTMLSelectElement).value).toBe("chair-1");
  });


  it("allergy icon on a client with a note", async () => {
    stubApi("Alergia al amoníaco");
    view();
    await waitFor(() => expect(document.querySelector('[data-booking="b1"] [data-allergy]')).not.toBeNull());
  });

  it("no allergy icon when the client's note is empty", async () => {
    const f = stubApi("");
    view();
    await waitFor(() => expect(f.mock.calls.some(([u]) => /\/clients$/.test(String(u)))).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector("[data-allergy]")).toBeNull();
  });

  it("now line only on today", async () => {
    stubApi();
    view();
    expect(document.querySelector("[data-now-line]")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Día siguiente" }));
    expect(document.querySelector("[data-now-line]")).toBeNull();
  });

  it("cash strip sums today's payments by method", async () => {
    stubApi();
    view();
    const strip = await waitFor(() => {
      const el = document.querySelector<HTMLElement>("[data-cash-strip]")!;
      expect(el.textContent).toContain("Efectivo");
      expect(el.textContent).toContain("35");
      return el;
    });
    expect(within(strip).getByText("Tarjeta")).toBeTruthy();
    expect(strip.textContent).toContain("20");
    expect(strip.textContent).toContain("Bizum");
    expect(strip.textContent).toContain("60");
  });

  it("tapping a booking opens its sheet with the actions the server allows", async () => {
    stubApi();
    view();
    fireEvent.click(document.querySelector('[data-booking="b1"]') as HTMLElement);
    const dialog = await waitFor(() => {
      const d = document.querySelector("dialog")!;
      expect(d).not.toBeNull();
      return d;
    });
    for (const name of ["Confirmar", "Mover", "Cancelar"]) expect(within(dialog).getByRole("button", { name })).toBeTruthy();
  });

  it("the week switch lists the seven days with their counts and tapping one selects it", () => {
    stubApi();
    view();
    fireEvent.click(screen.getByRole("button", { name: "Semana" }));
    const days = document.querySelectorAll("[data-week-day]");
    expect(days.length).toBe(7);
    fireEvent.click(days[1]);
    expect(document.querySelector("[data-now-line]")).toBeNull();
  });
});
