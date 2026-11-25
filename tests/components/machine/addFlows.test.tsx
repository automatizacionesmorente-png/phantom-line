// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MACHINE_COPY } from "@/components/machine/machineCopy";
import { TodayView } from "@/components/machine/today/TodayView";
import type { AgendaDayDto, AgendaItem } from "@/lib/owner/api";
import { agendaItem, demoShop, NOW, stubMatchMedia } from "./machineFixtures";

/** Salon spec 2.1 and 2.5: the + button, the new-booking and block dialogs, and Cobrar. */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const OPEN = "2026-11-10T10:30:00Z"; // 11:30 in Madrid
const DAYS = ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17"];
const agenda: AgendaDayDto[] = DAYS.map((date) => ({
  date,
  items: date === "2026-11-10" ? [agendaItem({ id: "b1", start: "2026-11-10T09:00:00Z", end: "2026-11-10T09:30:00Z", priceCents: 1500 })] : [],
}));

type Handler = (url: string, init: RequestInit | undefined) => Response | undefined;

/** Reads answer with empty data; `post` answers the write under test. */
function stubApi(post: Handler) {
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (init?.method === "POST") {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      return post(url, init) ?? json({ error: "unavailable" }, 503);
    }
    if (/\/blocks\?/.test(url)) return json({ blocks: [] });
    if (/\/payments\?day=/.test(url)) return json({ day: "2026-11-10", totalCents: 0, byMethod: { cash: 0, card: 0, bizum: 0, voucher: 0 }, count: 0 });
    if (/\/clients$/.test(url))
      return json({
        now: NOW,
        lapsed: [],
        clients: [
          { id: "c9", name: "Marta Ruiz", phone: "+34600111222", language: "es", note: "", birthday: null, promoConsentAt: null, fields: {}, spentCents: 0, totalVisits: 2, noShows: 0, lastVisit: null, upcoming: null, intervalDays: null, usualServices: [], history: [] },
        ],
      });
    return json({ error: "unavailable" }, 503);
  });
  vi.stubGlobal("fetch", fetchMock);
  return posts;
}

function view(over: Partial<React.ComponentProps<typeof TodayView>> = {}) {
  const onRefresh = vi.fn();
  const onItem = vi.fn();
  const onLocked = vi.fn();
  render(
    <TodayView
      shop={demoShop}
      lang="es"
      copy={MACHINE_COPY.es}
      agenda={agenda}
      now={OPEN}
      newMessages={0}
      refreshKey={1}
      onOpenTape={() => {}}
      onItem={onItem}
      onLocked={onLocked}
      onRefresh={onRefresh}
      {...over}
    />,
  );
  return { onRefresh, onItem, onLocked };
}

/** jsdom has no modal <dialog>, so the page behind stays in the tree: look inside the open dialog first. */
const scope = () => {
  const open = screen.queryAllByRole("dialog");
  return within(open.length > 0 ? open[open.length - 1] : document.body);
};
const click = (name: string | RegExp) => fireEvent.click(scope().getByRole("button", { name }));
const set = (label: string | RegExp, value: string) => fireEvent.change(scope().getByLabelText(label), { target: { value } });

async function openNewBooking() {
  click("Añadir");
  click(/Nueva/);
  return screen.getByRole("dialog");
}

async function toClientStep() {
  const d = await openNewBooking();
  set("Agenda de", "chair-2");
  set("Día", "2026-11-10");
  set("Hora", "12:00");
  click("Siguiente");
  click(/corte/i);
  return d;
}

beforeEach(() => stubMatchMedia(false));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the + button", () => {
  it("is always there, opens a two-item menu and Escape closes it", () => {
    stubApi(() => undefined);
    view();
    const plus = screen.getByRole("button", { name: "Añadir" });
    expect(plus.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(plus);
    expect(plus.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /Nueva/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bloquear horas" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("button", { name: "Bloquear horas" }), { key: "Escape" });
    expect(plus.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Bloquear horas" })).toBeNull();
  });
});

describe("new booking", () => {
  it("new booking in three taps posts the right body", async () => {
    const posts = stubApi(() => json({ id: "n1" }, 201));
    const { onRefresh } = view();
    await toClientStep();
    set("Cliente", "Marta");
    click("Reservar");
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toBe("/api/machine/peluqueria-lola/bookings");
    expect(posts[0].body).toEqual({ resourceId: "chair-2", serviceId: "haircut", start: "2026-11-10T11:00:00Z", name: "Marta" });
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it("searching the client book fills the name and the phone", async () => {
    const posts = stubApi(() => json({ id: "n1" }, 201));
    view();
    await toClientStep();
    set("Cliente", "marta");
    fireEvent.click(await screen.findByRole("button", { name: /Marta Ruiz/ }));
    click("Reservar");
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body).toMatchObject({ name: "Marta Ruiz", phone: "+34600111222" });
  });

  it("409 shows taken and refreshes", async () => {
    stubApi(() => json({ error: "taken", slots: [] }, 409));
    const { onRefresh } = view();
    await toClientStep();
    set("Cliente", "Marta");
    click("Reservar");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Ese hueco se acaba de ocupar"));
    expect(onRefresh).toHaveBeenCalled();
    // Back on the time step, to pick another.
    expect(screen.getByLabelText("Hora")).toBeTruthy();
  });

  it.each([
    ["in_the_past", "ya ha pasado"],
    ["too_far", "hasta dentro de un año"],
    ["closed", "está cerrado"],
    ["blocked", "está bloqueada"],
  ])("422 %s says why, in Spanish, on the time step", async (code, text) => {
    stubApi(() => json({ error: code }, 422));
    view();
    await toClientStep();
    set("Cliente", "Marta");
    click("Reservar");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(text));
    expect(screen.getByLabelText("Hora")).toBeTruthy();
  });

  it("a failed write keeps the typed client and says to try again", async () => {
    stubApi(() => undefined);
    view();
    await toClientStep();
    set("Cliente", "Marta");
    click("Reservar");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("No se pudo guardar"));
    expect((screen.getByLabelText("Cliente") as HTMLInputElement).value).toBe("Marta");
  });

  it("401 sends the machine back to the PIN", async () => {
    stubApi(() => json({ error: "wrong_pin" }, 401));
    const { onLocked } = view();
    await toClientStep();
    set("Cliente", "Marta");
    click("Reservar");
    await waitFor(() => expect(onLocked).toHaveBeenCalled());
  });
});

describe("block time", () => {
  async function openBlock() {
    click("Añadir");
    click("Bloquear horas");
    return screen.getByRole("dialog");
  }

  it("block whole shop for a day", async () => {
    const posts = stubApi(() => json({ block: { id: "k1", resourceId: null, start: "", end: "", reason: "Médico" }, overlapping: [], truncated: false }, 201));
    const { onRefresh } = view();
    await openBlock();
    click("Hoy entero");
    click("Médico");
    click("Bloquear");
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toBe("/api/machine/peluqueria-lola/blocks");
    expect(posts[0].body).toEqual({ resourceId: null, start: "2026-11-09T23:00:00Z", end: "2026-11-10T23:00:00Z", reason: "Médico" });
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it("one worker, with a typed reason", async () => {
    const posts = stubApi(() => json({ block: { id: "k1", resourceId: "chair-1", start: "", end: "", reason: "" }, overlapping: [], truncated: false }, 201));
    view();
    await openBlock();
    set("A quién afecta", "chair-1");
    click("Otro");
    fireEvent.change(screen.getByPlaceholderText("Escribe el motivo"), { target: { value: "  Curso  " } });
    click("Bloquear");
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body).toMatchObject({ resourceId: "chair-1", reason: "Curso" });
  });

  it("warns with the bookings under the block, and says when the list is cut", async () => {
    const under: AgendaItem[] = [
      agendaItem({ id: "u1", start: "2026-11-10T14:00:00Z", end: "2026-11-10T14:30:00Z", customerName: "Lucía" }),
      agendaItem({ id: "u2", start: "2026-11-10T15:00:00Z", end: "2026-11-10T15:30:00Z", customerName: "Pedro" }),
    ];
    stubApi(() => json({ block: { id: "k1", resourceId: null, start: "", end: "", reason: "" }, overlapping: under, truncated: true }, 201));
    const { onRefresh } = view();
    await openBlock();
    click("Hoy entero");
    click("Bloquear");
    const warn = await screen.findByText(/Ojo: más de 2 citas/);
    expect(warn).toBeTruthy();
    expect(screen.getByText(/Lucía/)).toBeTruthy();
    expect(screen.getByText(/Pedro/)).toBeTruthy();
    expect(screen.getByText(/Hay más/)).toBeTruthy();
    expect(onRefresh).toHaveBeenCalled();
    // The dialog stays until the Owner has read it.
    expect(screen.getByRole("dialog")).toBeTruthy();
    click("Entendido");
  });

  it("an end before the start is refused before any request", async () => {
    const posts = stubApi(() => undefined);
    view();
    await openBlock();
    set("Desde", "2026-11-12");
    set("Hasta", "2026-11-11");
    click("Bloquear");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("posterior"));
    expect(posts).toHaveLength(0);
  });

  it("422 on a start too far ahead and 409 limit_reached say why", async () => {
    let answer: Response = json({ error: "invalid_request", issues: [{ path: ["start"], message: "x" }] }, 422);
    stubApi(() => answer);
    view();
    await openBlock();
    click("Bloquear");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("más de un año"));
    answer = json({ error: "limit_reached" }, 409);
    click("Bloquear");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("máximo de bloqueos"));
  });
});

describe("Cobrar", () => {
  async function openPay() {
    fireEvent.click(document.querySelector('[data-booking="b1"]')!);
    click("Cobrar");
    return screen.getByRole("dialog", { name: /Cobrar a Ana/ });
  }
  const paid = agendaItem({ id: "b1", start: "2026-11-10T09:00:00Z", end: "2026-11-10T09:30:00Z", priceCents: 1500, paidCents: 1500, state: "done" });

  it("pay with bizum marks done", async () => {
    const posts = stubApi(() => json({ id: "p1", booking: paid }, 201));
    const { onItem, onRefresh } = view();
    const d = await openPay();
    expect((within(d).getByLabelText(/Importe del servicio/) as HTMLInputElement).value).toBe("15");
    fireEvent.click(within(d).getByRole("button", { name: "Bizum" }));
    fireEvent.click(within(d).getByRole("button", { name: /Cobrar 15/ }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toBe("/api/machine/peluqueria-lola/bookings/b1/pay");
    expect(posts[0].body).toEqual({ amountCents: 1500, method: "bizum" });
    await waitFor(() => expect(onItem).toHaveBeenCalledWith(paid));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("an edited amount and a product line add up to the total", async () => {
    const posts = stubApi(() => json({ id: "p1", booking: paid }, 201));
    view();
    const d = await openPay();
    fireEvent.change(within(d).getByLabelText(/Importe del servicio/), { target: { value: "17,50" } });
    fireEvent.click(within(d).getByRole("button", { name: "Añadir producto" }));
    fireEvent.change(within(d).getByLabelText("Producto (opcional)"), { target: { value: "Champú" } });
    fireEvent.change(within(d).getByLabelText(/Importe del producto/), { target: { value: "9" } });
    expect(within(d).getByText("Total: 26,50 €")).toBeTruthy();
    fireEvent.click(within(d).getByRole("button", { name: "Tarjeta" }));
    fireEvent.click(within(d).getByRole("button", { name: /Cobrar 26,50/ }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body).toEqual({ amountCents: 2650, method: "card", productCents: 900, productLabel: "Champú" });
  });

  it("asks for a method and a valid amount before any request", async () => {
    const posts = stubApi(() => undefined);
    view();
    const d = await openPay();
    fireEvent.click(within(d).getByRole("button", { name: /Cobrar 15/ }));
    expect(within(d).getByRole("alert").textContent).toContain("Elige cómo ha pagado");
    fireEvent.click(within(d).getByRole("button", { name: "Efectivo" }));
    fireEvent.change(within(d).getByLabelText(/Importe del servicio/), { target: { value: "abc" } });
    fireEvent.click(within(d).getByRole("button", { name: /^Cobrar/ }));
    expect(within(d).getByRole("alert").textContent).toContain("importe válido");
    expect(posts).toHaveLength(0);
  });

  it.each([
    ["already_paid", 409, "ya estaba cobrada"],
    ["cancelled", 409, "está cancelada"],
    ["not_yet", 422, "Todavía falta mucho"],
  ])("%s is explained", async (code, status, text) => {
    stubApi(() => json({ error: code }, status));
    view();
    const d = await openPay();
    fireEvent.click(within(d).getByRole("button", { name: "Efectivo" }));
    fireEvent.click(within(d).getByRole("button", { name: /Cobrar 15/ }));
    await waitFor(() => expect(within(d).getByRole("alert").textContent).toContain(text));
  });

  it("closing the pay dialog goes back to the sheet", async () => {
    stubApi(() => undefined);
    view();
    const d = await openPay();
    await act(async () => {
      fireEvent.click(within(d).getByRole("button", { name: "Cerrar" }));
      // jsdom has no <dialog>.close(): the dialog fires its own close.
      fireEvent(d, new Event("close"));
    });
    expect(screen.queryByRole("dialog", { name: /Cobrar a Ana/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Cobrar" })).toBeTruthy();
  });
});
