// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RebirthWizard, STORAGE_KEY } from "@/components/rebirth/RebirthWizard";
import { SuccessScreen } from "@/components/rebirth/SuccessScreen";
import { TrialBadge } from "@/components/TrialBadge";
import { emptyState, starterFaq, starterServices, type WizardState } from "@/lib/rebirth/state";
import { sectorById } from "@/lib/rebirth/sectors";
import { websiteSnippet } from "@/lib/rebirth/snippet";
import { stubMatchMedia } from "./machine/machineFixtures";

const NO_WAIT = { rewindMs: 0, blinkMs: 0 };
const sector = () => sectorById("hair-salon")!;

function filled(step: number): WizardState {
  return {
    ...emptyState(),
    step,
    sectorId: "hair-salon",
    name: "Barbería Paco",
    address: "Calle Mayor 12",
    city: "Madrid",
    ownerName: "Paco",
    website: "https://barberiapaco.example",
    members: ["Sillón 1", "Sillón 2"],
    concurrent: "2",
    hours: { 1: [{ open: "10:00", close: "14:00" }, { open: "17:00", close: "20:00" }] },
    services: starterServices(sector()),
    faq: starterFaq(sector()),
  };
}
const save = (s: WizardState) => localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
const type = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  stubMatchMedia(false);
  localStorage.clear();
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("the wizard in Spanish", () => {
  it("starts with the sector cards and refuses to go on without one", () => {
    render(<RebirthWizard timing={NO_WAIT} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Tu teléfono, de vuelta a la vida");
    const radios = screen.getAllByRole("radio");
    expect(radios.length).toBeGreaterThan(0);
    expect(radios[0].textContent).toContain("Peluquería");
    click("Siguiente");
    expect(screen.getByText("Este campo es obligatorio.")).toBeTruthy();
    fireEvent.click(radios[0]);
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    click("Siguiente");
    expect(screen.getByLabelText("Nombre del negocio")).toBeTruthy();
  });

  it("validates the business step: required fields, no markup, a real website, a language", () => {
    save({ ...emptyState(), step: 1, sectorId: "hair-salon" });
    render(<RebirthWizard timing={NO_WAIT} />);
    click("Siguiente");
    expect(screen.getAllByText("Este campo es obligatorio.").length).toBeGreaterThanOrEqual(4);
    type("Nombre del negocio", "<b>Paco</b>");
    type("Dirección", "Calle Mayor 12");
    type("Ciudad", "Madrid");
    type("Tu nombre de pila", "Paco");
    type(/Tu web/, "javascript:alert(1)");
    click("Siguiente");
    expect(screen.getByText("No uses < ni > ni caracteres de control.")).toBeTruthy();
    expect(screen.getByText(/empiece por http/)).toBeTruthy();
    expect(screen.getByLabelText("Nombre del negocio").getAttribute("aria-invalid")).toBe("true");
    type("Nombre del negocio", "Barbería Paco");
    type(/Tu web/, "");
    click("Siguiente");
    expect(screen.getByRole("heading", { name: "Tu equipo", level: 2 })).toBeTruthy();
  });

  it("the team step needs names and a possible number of workers at once", () => {
    save({ ...filled(2), members: [""], concurrent: "3" });
    render(<RebirthWizard timing={NO_WAIT} />);
    click("Siguiente");
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    type("Nombre 1", "Marta");
    click("Añadir otra persona o puesto");
    type("Nombre 2", "Luis");
    click("Siguiente");
    expect(screen.getByText("No puede ser mayor que el número de nombres.")).toBeTruthy();
    type("¿Cuántos pueden trabajar a la vez?", "2");
    click("Siguiente");
    expect(screen.getByRole("heading", { name: "Horario, servicios y precios", level: 2 })).toBeTruthy();
  });

  it("the catalogue step starts from the starter, shows an editable table and checks it", () => {
    save({ ...filled(3), services: [], hours: {} });
    render(<RebirthWizard timing={NO_WAIT} />);
    expect(screen.getByText(/Todavía no hay servicios/)).toBeTruthy();
    click("Usar el catálogo de ejemplo");
    expect(screen.getByRole("group", { name: "Servicio 1" })).toBeTruthy();
    expect((screen.getAllByLabelText("Nombre")[0] as HTMLInputElement).value).toBe("Corte de mujer");
    click("Siguiente");
    expect(screen.getByText("Marca al menos un día abierto.")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Lunes"));
    fireEvent.click(screen.getByRole("button", { name: "Añadir tramo (horario partido)" }));
    expect(screen.getAllByLabelText(/^Lunes (Desde|hasta)$/)).toHaveLength(4);
    // A bad price is refused on its own field.
    fireEvent.change(screen.getAllByLabelText("Precio (EUR)")[0], { target: { value: "abc" } });
    click("Siguiente");
    expect(screen.getAllByText("El valor no es válido.").length).toBeGreaterThan(0);
    fireEvent.change(screen.getAllByLabelText("Precio (EUR)")[0], { target: { value: "12,50" } });
    click("Siguiente");
    expect(screen.getByRole("heading", { name: "Políticas y preguntas frecuentes", level: 2 })).toBeTruthy();
  });

  it("reads a document: the result fills the editable form, nothing is created", async () => {
    save({ ...filled(3), services: [], hours: {} });
    const fetchMock = vi.fn(async () =>
      Response.json({
        ok: true,
        extraction: {
          hours: { "2": [{ open: "09:00", close: "13:00" }, { open: "16:00", close: "19:00" }] },
          services: [{ name: "Corte caballero", durationMin: 30, priceEur: 13.5, from: false }, { name: "Barba", durationMin: null, priceEur: 8, from: true }],
          faq: [{ question: "Aparcamiento", answer: "Hay parking cerca." }],
          dropped: 2,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<RebirthWizard timing={NO_WAIT} />);
    fireEvent.change(screen.getByLabelText(/O pega aquí el texto/), { target: { value: "Corte caballero 13,50" } });
    click("Leer el documento");
    await waitFor(() => expect(screen.getByText(/Hemos leído 2 servicios y 1 respuestas/)).toBeTruthy());
    expect(screen.getByText(/2 elementos no eran válidos/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe("/api/nacer/extract");
    expect((screen.getAllByLabelText("Nombre")[0] as HTMLInputElement).value).toBe("Corte caballero");
    expect((screen.getAllByLabelText("Duración (minutos)")[1] as HTMLInputElement).value).toBe(""); // not invented
    expect((screen.getByLabelText("Martes") as HTMLInputElement).checked).toBe(true);
    // The owner can still edit it.
    fireEvent.change(screen.getAllByLabelText("Nombre")[0], { target: { value: "Corte de caballero" } });
    expect((screen.getAllByLabelText("Nombre")[0] as HTMLInputElement).value).toBe("Corte de caballero");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a wrong type or an oversized PDF in the browser, before sending anything", async () => {
    save({ ...filled(3), services: [] });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<RebirthWizard timing={NO_WAIT} />);
    const input = screen.getByLabelText(/PDF de tu lista/);
    fireEvent.change(input, { target: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
    click("Leer el documento");
    expect(screen.getByRole("alert").textContent).toBe("Solo se aceptan archivos PDF.");
    const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], "big.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [big] } });
    click("Leer el documento");
    expect(screen.getByRole("alert").textContent).toBe("El PDF pesa más de 4 MB.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the FAQ step is prefilled from the sector, needs spoken form, and an empty answer is fine", () => {
    save(filled(4));
    render(<RebirthWizard timing={NO_WAIT} />);
    expect(screen.getAllByRole("group", { name: /^Pregunta \d$/ }).length).toBeGreaterThanOrEqual(4);
    click("Siguiente"); // all empty: skipped
    expect(screen.getByRole("heading", { name: "Tu PIN y la prueba", level: 2 })).toBeTruthy();
    click("Atrás");
    fireEvent.change(screen.getAllByLabelText("Tu respuesta")[0], { target: { value: "Cuesta 3 euros." } });
    click("Siguiente");
    expect(screen.getByText(/sin cifras, ni símbolos/)).toBeTruthy();
    fireEvent.change(screen.getAllByLabelText("Tu respuesta")[0], { target: { value: "Cuesta tres euros." } });
    click("Siguiente");
    expect(screen.getByRole("heading", { name: "Tu PIN y la prueba", level: 2 })).toBeTruthy();
  });

  it("the last step checks the PIN twice and the terms before it sends anything", async () => {
    save(filled(5));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<RebirthWizard timing={NO_WAIT} />);
    click("Volver a nacer");
    expect(screen.getByText("El PIN son exactamente 6 cifras.")).toBeTruthy();
    expect(screen.getByText("Debes aceptar las condiciones de la prueba.")).toBeTruthy();
    type("PIN del contestador (6 cifras)", "123456");
    type("Repite el PIN", "123457");
    fireEvent.click(screen.getByLabelText(/Acepto las condiciones de la prueba/));
    click("Volver a nacer");
    expect(screen.getByText("Los dos PIN no coinciden.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the wizard in English", () => {
  beforeEach(() => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("en-GB");
  });

  it("follows the browser language, labels every step and switches back to Spanish", () => {
    render(<RebirthWizard timing={NO_WAIT} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Your phone, back from the dead");
    expect(screen.getByText("What kind of business do you run?")).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "1. Sector", "2. Business", "3. Team", "4. Hours and services", "5. Policies and questions", "6. PIN and trial",
    ]);
    click("Next");
    expect(screen.getByText("This field is required.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Español" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Tu teléfono, de vuelta a la vida");
  });

  it("the final button is 'Bring it back to life'", () => {
    save(filled(5));
    render(<RebirthWizard timing={NO_WAIT} />);
    expect(screen.getByRole("button", { name: "Bring it back to life" })).toBeTruthy();
    expect(screen.getByText(/trial shop, its data is deleted after 7 days/)).toBeTruthy();
    expect(screen.getByLabelText("Answering machine PIN (6 digits)")).toBeTruthy();
  });
});

describe("progress is saved", () => {
  it("restores a draft after a reload and says so, and 'start over' clears it", () => {
    save({ ...filled(2), name: "Barbería Paco" });
    render(<RebirthWizard timing={NO_WAIT} />);
    expect(screen.getByText("Hemos recuperado lo que ya habías escrito.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Tu equipo", level: 2 })).toBeTruthy();
    expect((screen.getByLabelText("Nombre 1") as HTMLInputElement).value).toBe("Sillón 1");
    click("Empezar de cero");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).name).toBe("");
  });

  it("writes what is typed, never the PIN, and drops a tampered draft", async () => {
    save(filled(5));
    render(<RebirthWizard timing={NO_WAIT} />);
    type("PIN del contestador (6 cifras)", "654321");
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toContain("Barbería Paco"));
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain("654321");
    cleanup();
    localStorage.setItem(STORAGE_KEY, '{"step":99,"sectorId":{"$":1},"services":"x"}');
    render(<RebirthWizard timing={NO_WAIT} />);
    expect(screen.getByText("¿Qué tipo de negocio tienes?")).toBeTruthy();
  });
});

describe("Volver a nacer", () => {
  const created = { ok: true, shopId: "barberia-paco", callPath: "/call/barberia-paco", machinePath: "/machine/barberia-paco", expiresAt: "2026-12-08T10:00:00.000Z" };

  async function fillAndSubmit() {
    type("PIN del contestador (6 cifras)", "246810");
    type("Repite el PIN", "246810");
    fireEvent.click(screen.getByLabelText(/Acepto las condiciones de la prueba/));
    click("Volver a nacer");
  }

  it("the tape rewinds (reels turn) while the shop is created, then the light blinks and the success screen shows", async () => {
    save(filled(5));
    let release!: (r: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((r) => (release = r)));
    vi.stubGlobal("fetch", fetchMock);
    render(<RebirthWizard timing={{ rewindMs: 0, blinkMs: 30 }} />);
    await fillAndSubmit();
    await waitFor(() => expect(document.querySelector("[data-stage='rewinding']")).not.toBeNull());
    expect(document.querySelector("[data-reels]")?.getAttribute("data-reels")).toBe("spinning");
    expect(screen.getByText("Rebobinando la cinta…")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Volver a nacer" }) as HTMLButtonElement).disabled).toBe(true);
    const sent = JSON.parse(((fetchMock.mock.calls[0] as unknown[])[1] as RequestInit).body as string);
    expect(sent).toMatchObject({ pin: "246810", acceptTerms: true });
    expect(sent.draft.business.name).toBe("Barbería Paco");
    await act(async () => release(Response.json(created, { status: 201 })));
    await waitFor(() => expect(document.querySelector("[data-stage='alive']")).not.toBeNull());
    expect(document.querySelector("[data-light]")?.getAttribute("data-light")).toBe("blinking");
    await waitFor(() => expect(document.querySelector("[data-success]")).not.toBeNull());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Ha vuelto a la vida");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("with reduced motion nothing moves: the reels stay still and the success screen comes at once", async () => {
    stubMatchMedia(true);
    save(filled(5));
    let release!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => (release = r))));
    render(<RebirthWizard />); // the default timings would take 2.8 s if they were used
    await fillAndSubmit();
    await waitFor(() => expect(document.querySelector("[data-stage='rewinding']")).not.toBeNull());
    expect(document.querySelector("[data-reels]")?.getAttribute("data-reels")).toBe("still");
    expect(document.querySelector(".reel-spin")).toBeNull();
    expect(document.querySelector(".light-blink, .light-flicker")).toBeNull();
    expect(screen.getByText("Rebobinando la cinta…")).toBeTruthy(); // the state is still said, in text
    await act(async () => release(Response.json(created, { status: 201 })));
    await waitFor(() => expect(document.querySelector("[data-success]")).not.toBeNull(), { timeout: 1000 });
  });

  it.each([
    [409, "Ya existe un negocio con ese nombre"],
    [429, "Has creado demasiados negocios hoy"],
    [400, "Hay datos que no son válidos"],
    [503, "No hemos podido crearlo"],
  ])("a %i answer shows its message and brings the button back", async (status, message) => {
    save(filled(5));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "x" }, { status })));
    render(<RebirthWizard timing={NO_WAIT} />);
    await fillAndSubmit();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(message));
    expect((screen.getByRole("button", { name: "Volver a nacer" }) as HTMLButtonElement).disabled).toBe(false);
    expect(document.querySelector("[data-success]")).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull(); // the work is kept
  });

  it("a network failure is a message, not a crash", async () => {
    save(filled(5));
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    render(<RebirthWizard timing={NO_WAIT} />);
    await fillAndSubmit();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("No hemos podido crearlo"));
  });

  it("an earlier step that became invalid sends the owner back to it, without calling the server", async () => {
    save({ ...filled(5), name: "" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<RebirthWizard timing={NO_WAIT} />);
    await fillAndSubmit();
    expect(screen.getByRole("heading", { name: "Tu negocio", level: 2 })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the success screen", () => {
  const data = { shopName: "Barbería Paco", callUrl: "https://pl.example/call/barberia-paco", machineUrl: "https://pl.example/machine/barberia-paco", expiresAt: "2026-12-08T10:00:00.000Z" };

  it("shows the links, a QR as inline SVG, the website snippet and the checklist, in Spanish and English", () => {
    render(<SuccessScreen lang="es" data={data} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Ha vuelto a la vida");
    expect(document.querySelector("[data-call-url]")?.textContent).toBe(data.callUrl);
    expect(document.querySelector("[data-machine-url]")?.textContent).toBe(data.machineUrl);
    const qr = document.querySelector("svg[data-qr]")!;
    expect(qr.getAttribute("role")).toBe("img");
    expect(qr.querySelectorAll("path")).toHaveLength(1);
    expect((screen.getByLabelText("Botón para tu web") as HTMLTextAreaElement).value).toBe(websiteSnippet(data.callUrl, "Llámanos"));
    expect(screen.getByText("Qué hacer ahora")).toBeTruthy();
    expect(document.querySelectorAll("section ul li")).toHaveLength(5);
    expect(screen.getByText(/se borrará el/)).toBeTruthy();
    cleanup();
    render(<SuccessScreen lang="en" data={data} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("It is alive");
    expect(screen.getByText("What to do next")).toBeTruthy();
  });

  it("copies the link", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<SuccessScreen lang="es" data={data} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Copiar" })[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(data.callUrl));
    expect(screen.getByRole("button", { name: "Copiado" })).toBeTruthy();
  });

  it("renders a hostile shop name as text, never as HTML", () => {
    const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const { container } = render(<SuccessScreen lang="es" data={{ ...data, shopName: evil }} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(within(container).getByText(new RegExp("onerror"))).toBeTruthy();
  });
});

describe("the Prueba badge and the snippet", () => {
  it("says Prueba / Trial", () => {
    const { container } = render(<TrialBadge lang="es" />);
    expect(container.textContent).toBe("Prueba");
    cleanup();
    expect(render(<TrialBadge lang="en" />).container.textContent).toBe("Trial");
  });

  it("the snippet escapes whatever is in the URL or the label", () => {
    const s = websiteSnippet('https://x.example/"><script>alert(1)</script>', "<b>Call</b>");
    expect(s).not.toContain("<script>");
    expect(s).not.toContain("<b>");
    expect(s).toContain("&quot;&gt;&lt;script&gt;");
  });
});
