// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WeekPanel } from "@/components/machine/WeekPanel";
import type { WeekStats } from "@/lib/owner/weekStats";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const STATS: WeekStats = {
  from: "2026-11-03",
  to: "2026-11-10",
  callsAnswered: 9,
  bookings: 3,
  revenueCents: 7500,
  revenueFrom: false,
  lostCalls: 2,
  timeSavedSeconds: 1620,
  timedCalls: 9,
};
const answer = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("WeekPanel", () => {
  it("shows the week's numbers and states the time formula, in Spanish", async () => {
    vi.stubGlobal("fetch", answer(STATS));
    render(<WeekPanel shopId="peluqueria-lola" lang="es" refreshKey={1} onLocked={() => {}} />);
    expect(await screen.findByRole("heading", { name: "Últimos 7 días" })).toBeTruthy();
    expect(screen.getByText("Llamadas atendidas").nextElementSibling?.textContent).toBe("9");
    expect(screen.getByText("Facturación reservada").nextElementSibling?.textContent).toMatch(/75/);
    expect(screen.getByText("Tiempo ahorrado").nextElementSibling?.textContent).toBe("27 min");
    expect(screen.getByText(/Tiempo ahorrado = suma de la duración/)).toBeTruthy();
  });

  it("speaks English and drops the numbers that cannot be computed", async () => {
    vi.stubGlobal("fetch", answer({ ...STATS, revenueCents: null, timeSavedSeconds: null, timedCalls: 0 }));
    render(<WeekPanel shopId="peluqueria-lola" lang="en" refreshKey={1} onLocked={() => {}} />);
    expect(await screen.findByRole("heading", { name: "Last 7 days" })).toBeTruthy();
    expect(screen.queryByText("Revenue booked")).toBeNull();
    expect(screen.queryByText("Time saved")).toBeNull();
    expect(screen.queryByText(/Time saved =/)).toBeNull();
  });

  it("goes back to the gate on 401 and shows nothing invented on a failure", async () => {
    const locked = vi.fn();
    vi.stubGlobal("fetch", answer({}, 401));
    const view = render(<WeekPanel shopId="x" lang="es" refreshKey={1} onLocked={locked} />);
    await vi.waitFor(() => expect(locked).toHaveBeenCalled());
    expect(view.container.textContent).toBe("");
    cleanup();
    vi.stubGlobal("fetch", answer({ error: "unavailable" }, 503));
    render(<WeekPanel shopId="x" lang="es" refreshKey={1} onLocked={() => {}} />);
    expect(await screen.findByText(/No se pudieron cargar/)).toBeTruthy();
  });
});
