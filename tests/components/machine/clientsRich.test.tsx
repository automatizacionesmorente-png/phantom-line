// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientsView } from "@/components/machine/ClientsView";
import { MACHINE_COPY } from "@/components/machine/machineCopy";
import type { ClientDto, ClientsResponse } from "@/lib/clients/api";
import { toMachineShop } from "@/lib/owner/machineShop";
import { carWorkshop, hairSalon, psychologyPractice } from "@/lib/sectors";
import { lolaProfile } from "../../fixtures/lola";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const client = (over: Partial<ClientDto> & { id: string; name: string; phone: string }): ClientDto => ({
  language: "es",
  note: "",
  birthday: null,
  promoConsentAt: null,
  fields: {},
  spentCents: 0,
  totalVisits: 0,
  noShows: 0,
  lastVisit: null,
  upcoming: null,
  intervalDays: null,
  usualServices: [],
  history: [],
  ...over,
});
const base = client({
  id: "c1",
  name: "Carlos Vega",
  phone: "+34612345678",
  note: "Alérgico al amoníaco",
  spentCents: 7550,
  totalVisits: 2,
  promoConsentAt: "2026-10-05T08:00:00Z",
  birthday: "03-14",
  fields: { car: "Seat Ibiza 1234ABC" },
  history: [
    {
      bookingId: "b1",
      serviceId: "haircut",
      start: "2026-09-01T08:00:00Z",
      end: "2026-09-01T08:30:00Z",
      state: "visit",
      canMarkNoShow: true,
      paidCents: 2500,
      visitNote: "Tono 7.1 con 20 vol",
    },
    {
      bookingId: "b2",
      serviceId: "haircut",
      start: "2026-08-01T08:00:00Z",
      end: "2026-08-01T08:30:00Z",
      state: "visit",
      canMarkNoShow: true,
      paidCents: null,
      visitNote: "",
    },
  ],
});
const other = client({ id: "c2", name: "Marta Gil", phone: "+34699000111" });
const book = (clients: ClientDto[]): ClientsResponse => ({
  now: "2026-11-10T08:00:00Z",
  clients,
  lapsed: [],
});

function stub(responses: ClientsResponse[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(responses[Math.min(calls.length - 1, responses.length - 1)]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}
const hair = toMachineShop(lolaProfile, hairSalon);
const car = toMachineShop(lolaProfile, carWorkshop);
const psy = toMachineShop(lolaProfile, psychologyPractice);
const copy = MACHINE_COPY.es;
const mount = (shop = hair, extra: Partial<React.ComponentProps<typeof ClientsView>> = {}) =>
  render(<ClientsView active shop={shop} lang="es" copy={copy} onLocked={() => {}} {...extra} />);
const openCard = async () => {
  await screen.findByRole("heading", { name: "Carlos Vega" });
  fireEvent.click(screen.getAllByRole("button", { name: /Ver ficha/ })[0]);
  return document.querySelector("[data-client='c1']") as HTMLElement;
};

describe("Clients tab, salon card", () => {
  it("highlights the important note, shows spend and the history with what was paid", async () => {
    stub([book([base])]);
    mount();
    const card = await openCard();
    expect(within(card).getAllByText("Alérgico al amoníaco").length).toBeGreaterThan(0);
    expect(card.querySelector("[data-important]")?.textContent).toContain("Alérgico al amoníaco");
    expect(card.textContent).toMatch(/Ha gastado 75,50/);
    expect(card.querySelector("[data-history='b1']")?.textContent).toMatch(/Pagado 25/);
    expect(card.querySelector("[data-history='b2']")?.textContent).toContain("Sin cobrar");
  });

  it("consent switch posts consent and shows its date", async () => {
    const calls = stub([book([base]), book([{ ...base, promoConsentAt: null }])]);
    mount();
    const card = await openCard();
    const sw = within(card).getByRole("switch", { name: /Acepta promociones/ });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(card.textContent).toMatch(/Aceptó el 5 oct 2026/);
    fireEvent.click(sw);
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      action: "consent",
      consent: false,
    });
    await waitFor(() =>
      expect(
        within(card)
          .getByRole("switch", { name: /Acepta promociones/ })
          .getAttribute("aria-checked"),
      ).toBe("false"),
    );
  });

  it("birthday pickers post MM-DD", async () => {
    const calls = stub([book([{ ...base, birthday: null }]), book([base])]);
    mount();
    const card = await openCard();
    fireEvent.change(within(card).getByLabelText("Día"), {
      target: { value: "14" },
    });
    fireEvent.change(within(card).getByLabelText("Mes"), {
      target: { value: "3" },
    });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      action: "birthday",
      birthday: "03-14",
    });
  });

  it("the important note saves with the note action", async () => {
    const calls = stub([book([base]), book([base])]);
    mount();
    const card = await openCard();
    fireEvent.change(within(card).getByLabelText("Importante / alergias"), {
      target: { value: "Látex" },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Guardar nota" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      action: "note",
      note: "Látex",
    });
  });

  it("search filters by name and phone", async () => {
    stub([book([base, other])]);
    mount();
    await screen.findByRole("heading", { name: "Marta Gil" });
    const box = screen.getByRole("searchbox", {
      name: "Buscar por nombre o teléfono",
    });
    fireEvent.change(box, { target: { value: "marta" } });
    expect(screen.queryByRole("heading", { name: "Carlos Vega" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Marta Gil" })).toBeTruthy();
    fireEvent.change(box, { target: { value: "612 345" } });
    expect(screen.queryByRole("heading", { name: "Marta Gil" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Carlos Vega" })).toBeTruthy();
    fireEvent.change(box, { target: { value: "zzz" } });
    expect(screen.getByText("Nadie coincide con esa búsqueda.")).toBeTruthy();
  });

  it("focusClientId opens that card even when a search hides it", async () => {
    stub([book([base, other])]);
    const onDone = vi.fn();
    mount(hair, { focusClientId: "c2", onFocusDone: onDone });
    await screen.findByRole("heading", { name: "Carlos Vega" });
    const card = document.querySelector("[data-client='c2']") as HTMLElement;
    await waitFor(() => expect(within(card).getByRole("button", { name: /Cerrar ficha/ })).toBeTruthy());
    expect(onDone).toHaveBeenCalled();
  });
});

describe("Clients tab, sector packs", () => {
  it("car pack shows Coche y matrícula and posts fields", async () => {
    const calls = stub([book([{ ...base, fields: {} }]), book([base])]);
    mount(car);
    const card = await openCard();
    fireEvent.change(within(card).getByLabelText("Coche y matrícula"), {
      target: { value: "Seat Ibiza 1234ABC" },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Guardar datos" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      action: "fields",
      fields: { car: "Seat Ibiza 1234ABC" },
    });
  });

  it("hair pack labels the visit note and has no extra fields", async () => {
    stub([book([base])]);
    mount();
    const card = await openCard();
    expect(card.querySelector("[data-history='b1']")?.textContent).toContain("Fórmula del color / notas: Tono 7.1 con 20 vol");
    expect(within(card).queryByRole("button", { name: "Guardar datos" })).toBeNull();
  });

  it("psychology shows no visit note", async () => {
    stub([book([base])]);
    mount(psy);
    const card = await openCard();
    expect(card.textContent).not.toContain("Tono 7.1");
  });
});
