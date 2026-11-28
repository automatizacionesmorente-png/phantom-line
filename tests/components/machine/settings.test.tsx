// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsView } from "@/components/machine/settings/SettingsView";
import type { OutboxItemDto, SettingsResponse } from "@/lib/salon/api";
import { demoShop } from "./machineFixtures";

/** Salon spec 2.4, 9.7, 9.8: the switches, the review link, VAT and the outbox. */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const LINK = "https://g.page/r/abc123/review";
const OFF: SettingsResponse = {
  automations: { reminder: false, review: false, gap: false, winback: false, birthday: false },
  googleReviewUrl: null,
  vatRatePct: 21,
};
const msg = (over: Partial<OutboxItemDto> & { id: string }): OutboxItemDto => ({
  kind: "reminder",
  clientId: null,
  clientFirstName: null,
  bookingId: null,
  phone: "+34600111222",
  language: "es",
  body: "Hola, te esperamos mañana.",
  status: "prepared",
  createdAt: "2026-11-10T08:00:00Z",
  actedAt: null,
  waUrl: "https://wa.me/34600111222?text=Hola",
  ...over,
});

let settings: SettingsResponse;
let outbox: OutboxItemDto[];
let posts: { url: string; body: Record<string, unknown> }[];
let reads: string[];
let postAnswer: (url: string, body: Record<string, unknown>) => Response;

beforeEach(() => {
  settings = OFF;
  outbox = [msg({ id: "m1" }), msg({ id: "m2", kind: "winback", body: "Te echamos de menos. Responde BAJA si no quieres más mensajes." })];
  posts = [];
  reads = [];
  postAnswer = () => json({ ok: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        posts.push({ url, body });
        return postAnswer(url, body);
      }
      reads.push(url);
      if (/\/settings$/.test(url)) return json(settings);
      if (/\/outbox$/.test(url)) return json({ items: outbox });
      return json({ error: "unavailable" }, 503);
    }),
  );
  document.addEventListener("click", stopNav); // jsdom cannot navigate
});
const stopNav = (e: Event) => {
  if ((e.target as Element).closest("a")) e.preventDefault();
};
afterEach(() => {
  document.removeEventListener("click", stopNav);
  cleanup();
  vi.unstubAllGlobals();
});

const view = (active = true, onLocked = vi.fn()) =>
  render(<SettingsView shop={demoShop} lang="es" active={active} refreshKey={0} onLocked={onLocked} />);

describe("SettingsView", () => {
  it("shows hours, services with prices and the team, read-only, with the Volver a nacer note", async () => {
    view();
    const box = await screen.findByTestId("shop-summary");
    const text = box.textContent ?? "";
    expect(text).toContain(demoShop.services[0].name.es);
    expect(text).toContain(demoShop.resources[0].name.es);
    const price = demoShop.services.find((s) => s.priceCents !== undefined);
    if (price) expect(text).toMatch(/\d/);
    const open = Object.values(demoShop.hours).flat()[0]!;
    expect(text).toContain(`${open.open}-${open.close}`);
    expect(text).toContain("Volver a nacer");
    expect(within(box).queryByRole("textbox")).toBeNull();
  });

  it("puts the switches first, the outbox second and the business last, collapsed by default", async () => {
    view();
    const box = await screen.findByTestId("shop-summary");
    expect(box.tagName).toBe("DETAILS");
    expect(box.hasAttribute("open")).toBe(false);
    expect(within(box).getByText("Mi horario, servicios y equipo")).toBeTruthy();
    const sw = screen.getAllByRole("switch")[0];
    const card = screen.getAllByTestId("outbox-item")[0];
    const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(sw, card)).toBe(true);
    expect(follows(card, box)).toBe(true);
  });

  it("names the client by first name when there is one, otherwise the phone", async () => {
    outbox = [msg({ id: "n1", clientFirstName: "Ana" }), msg({ id: "n2" })];
    view();
    const cards = await screen.findAllByTestId("outbox-item");
    expect(cards[0].textContent).toContain("Para Ana");
    expect(cards[0].textContent).not.toContain("+34600111222");
    expect(cards[1].textContent).toContain("Para +34600111222");
  });

  it("does not read anything while the tab is inactive", () => {
    view(false);
    expect(reads).toEqual([]);
  });

  it("review switch disabled without link", async () => {
    view();
    const sw = await screen.findByRole("switch", { name: "Pedir reseña" });
    expect((sw as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("switch", { name: "Recordatorio" }) as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByText(/Tras la visita, pide una reseña/)).toBeTruthy();
  });

  it("review switch is enabled once a link is saved", async () => {
    settings = { ...OFF, googleReviewUrl: LINK };
    view();
    const sw = await screen.findByRole("switch", { name: "Pedir reseña" });
    expect((sw as HTMLInputElement).disabled).toBe(false);
  });

  it("a switch saves the whole settings object", async () => {
    view();
    fireEvent.click(await screen.findByRole("switch", { name: "Recordatorio" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toMatch(/\/settings$/);
    expect(posts[0].body).toEqual({ ...OFF, automations: { ...OFF.automations, reminder: true } });
  });

  it("saves a valid link and the VAT", async () => {
    view();
    fireEvent.change(await screen.findByLabelText("Enlace de reseñas de Google"), { target: { value: LINK } });
    fireEvent.change(screen.getByLabelText("IVA (%)"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar ajustes" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body).toMatchObject({ googleReviewUrl: LINK, vatRatePct: 10 });
    expect(await screen.findByText("Guardado.")).toBeTruthy();
  });

  it("an invalid link is refused before sending", async () => {
    view();
    fireEvent.change(await screen.findByLabelText("Enlace de reseñas de Google"), { target: { value: "https://evil.example/x" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar ajustes" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/enlace de reseñas de Google/);
    expect(posts).toEqual([]);
  });

  it("shows the server's review_needs_link and invalid_request clearly", async () => {
    view();
    postAnswer = () => json({ error: "review_needs_link" }, 422);
    fireEvent.change(await screen.findByLabelText("IVA (%)"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar ajustes" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/hace falta un enlace/);
    postAnswer = () => json({ error: "invalid_request", issues: [] }, 400);
    fireEvent.click(screen.getByRole("button", { name: "Guardar ajustes" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/no parece un enlace/));
  });

  it("a bad VAT is refused", async () => {
    view();
    fireEvent.change(await screen.findByLabelText("IVA (%)"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar ajustes" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/entre 0 y 30/);
    expect(posts).toEqual([]);
  });

  it("send opens wa.me and marks sent", async () => {
    view();
    const cards = await screen.findAllByTestId("outbox-item");
    const link = within(cards[0]).getByRole("link", { name: "Enviar por WhatsApp" });
    expect(link.getAttribute("href")).toBe("https://wa.me/34600111222?text=Hola");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toMatch(/noopener/);
    fireEvent.click(link);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toMatch(/\/outbox\/m1$/);
    expect(posts[0].body).toEqual({ action: "sent" });
    await waitFor(() => expect(screen.getAllByTestId("outbox-item")).toHaveLength(1));
  });

  it("dismiss removes the card", async () => {
    view();
    const cards = await screen.findAllByTestId("outbox-item");
    fireEvent.click(within(cards[0]).getByRole("button", { name: "Descartar" }));
    await waitFor(() => expect(posts[0]?.body).toEqual({ action: "dismissed" }));
    await waitFor(() => expect(screen.getAllByTestId("outbox-item")).toHaveLength(1));
    expect(screen.queryByText("Hola, te esperamos mañana.")).toBeNull();
  });

  it("a promo shows the consent and BAJA note, a reminder does not", async () => {
    view();
    const cards = await screen.findAllByTestId("outbox-item");
    expect(within(cards[0]).queryByText(/consentimiento/)).toBeNull();
    expect(within(cards[1]).getByText(/consentimiento/).textContent).toMatch(/BAJA/);
  });

  it("not_prepared drops the card and says it was handled", async () => {
    view();
    postAnswer = () => json({ error: "not_prepared" }, 409);
    const cards = await screen.findAllByTestId("outbox-item");
    fireEvent.click(within(cards[0]).getByRole("button", { name: "Descartar" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/ya estaba gestionado/);
    expect(screen.getAllByTestId("outbox-item")).toHaveLength(1);
  });

  it("an unsafe waUrl is never linked", async () => {
    outbox = [msg({ id: "m1", waUrl: "javascript:alert(1)" })];
    view();
    await screen.findByTestId("outbox-item");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("a 401 locks the machine", async () => {
    const onLocked = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "unauthorized" }, 401)));
    view(true, onLocked);
    await waitFor(() => expect(onLocked).toHaveBeenCalled());
  });
});
