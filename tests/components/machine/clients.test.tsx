// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientsView } from "@/components/machine/ClientsView";
import { MACHINE_COPY } from "@/components/machine/machineCopy";
import type { ClientsResponse } from "@/lib/clients/api";
import { demoShop } from "./machineFixtures";

/** BACKLOG 14, 15: the Clientes tab in Spanish and English. */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const book = (note = ""): ClientsResponse => ({
  now: "2026-11-10T08:00:00Z",
  clients: [
    {
      id: "c1",
      name: "Carlos Vega",
      phone: "+34612345678",
      language: "es",
      note,
      totalVisits: 3,
      noShows: 1,
      lastVisit: "2026-09-01T08:00:00Z",
      upcoming: null,
      intervalDays: 30,
      usualServices: [{ serviceId: "haircut", count: 3 }],
      history: [
        { bookingId: "b1", serviceId: "haircut", start: "2026-09-01T08:00:00Z", end: "2026-09-01T08:30:00Z", state: "visit", canMarkNoShow: true },
        { bookingId: "b2", serviceId: "haircut", start: "2026-08-01T08:00:00Z", end: "2026-08-01T08:30:00Z", state: "no_show", canMarkNoShow: true },
      ],
    },
  ],
  lapsed: [
    {
      clientId: "c1",
      name: "Carlos Vega",
      language: "es",
      daysSince: 70,
      thresholdDays: 30,
      overdueDays: 40,
      text: "Hola Carlos, hace tiempo que no te vemos.",
      whatsappUrl: "https://wa.me/34612345678?text=Hola%20Carlos%2C%20hace%20tiempo%20que%20no%20te%20vemos.",
    },
  ],
});

function stub(responses: ClientsResponse[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

describe.each([
  ["es", "Clientes que no han vuelto", "Escribir a Carlos Vega por WhatsApp", "Guardar nota", "Quitar «No vino»"],
  ["en", "Clients who haven't come back", "Message Carlos Vega on WhatsApp", "Save note", 'Undo "Didn\'t come"'],
] as const)("Clients tab in %s", (lang, lapsedTitle, whatsapp, save, undo) => {
  const copy = MACHINE_COPY[lang];

  it("fetches only when active, lists the lapsed with a wa.me link and the clients", async () => {
    const calls = stub([book()]);
    const { rerender } = render(<ClientsView active={false} shop={demoShop} lang={lang} copy={copy} onLocked={() => {}} />);
    expect(calls).toHaveLength(0);
    rerender(<ClientsView active shop={demoShop} lang={lang} copy={copy} onLocked={() => {}} />);
    expect(await screen.findByRole("heading", { name: lapsedTitle })).toBeTruthy();
    expect(calls[0].url).toBe(`/api/machine/${demoShop.id}/clients`);
    const link = screen.getByRole("link", { name: whatsapp });
    expect(link.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/34612345678\?text=/);
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText("Hola Carlos, hace tiempo que no te vemos.")).toBeTruthy();
    expect(screen.getByText(copy.clients.visits(3))).toBeTruthy();
    expect(screen.getByText(copy.clients.noShows(1))).toBeTruthy();
  });

  it("opens a card, saves the note and marks / undoes No vino through the API", async () => {
    const calls = stub([book(), book("Prefiere el sillón 2"), book()]);
    render(<ClientsView active shop={demoShop} lang={lang} copy={copy} onLocked={() => {}} />);
    await screen.findByRole("heading", { name: lapsedTitle });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(copy.clients.open) }));
    const card = document.querySelector("[data-client='c1']") as HTMLElement;
    fireEvent.change(within(card).getByLabelText(copy.clients.note), { target: { value: "Prefiere el sillón 2" } });
    fireEvent.click(within(card).getByRole("button", { name: save }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].url).toBe(`/api/machine/${demoShop.id}/clients/c1`);
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ action: "note", note: "Prefiere el sillón 2" });
    expect(await screen.findByText(copy.clients.saved)).toBeTruthy();

    fireEvent.click(within(card).getByRole("button", { name: undo }));
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({ action: "no_show", bookingId: "b2", noShow: false });
  });

  it("shows the empty text when there are no clients", async () => {
    stub([{ now: "2026-11-10T08:00:00Z", clients: [], lapsed: [] }]);
    render(<ClientsView active shop={demoShop} lang={lang} copy={copy} onLocked={() => {}} />);
    expect(await screen.findByText(copy.clients.empty)).toBeTruthy();
    expect(screen.getByText(copy.clients.lapsedNone)).toBeTruthy();
  });

  it("a 401 sends the owner back to the gate", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
    const onLocked = vi.fn();
    render(<ClientsView active shop={demoShop} lang={lang} copy={copy} onLocked={onLocked} />);
    await waitFor(() => expect(onLocked).toHaveBeenCalled());
  });
});
