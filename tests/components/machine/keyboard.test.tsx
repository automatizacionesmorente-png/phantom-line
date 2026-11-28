// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MachineScreen } from "@/components/machine/MachineScreen";
import { PinGate } from "@/components/machine/PinGate";
import { demoGate, demoShop, fakeMachineApi, initialPoll, nameOf, stubMatchMedia, tabbables } from "./machineFixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// owner-machine 11.6 (Requirement 13.1, 13.6, 13.9): the tab order of the PIN_Gate and of the
// machine in both views, as design.md "Keyboard order" lists it; no tabindex above 0; the
// tabs are one tab stop and the arrow keys move between them.
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  stubMatchMedia(false);
  vi.stubGlobal("fetch", fakeMachineApi([]).fetchMock);
});

const noPositiveTabindex = () => {
  for (const el of document.querySelectorAll("[tabindex]")) expect(Number(el.getAttribute("tabindex"))).toBeLessThanOrEqual(0);
};

describe("keyboard order", () => {
  it("PIN_Gate: language switch, PIN, then name, then Open the machine", () => {
    render(<PinGate shop={demoGate} />);
    expect(tabbables().map(nameOf)).toEqual(["Español", "English", "field:PIN de 6 cifras", "field:Tu nombre (opcional)", "Abrir el contestador"]);
    noPositiveTabindex();
  });

  it("four tabs in order", () => {
    render(<MachineScreen shop={demoShop} initial={initialPoll()} label="Lola" />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Hoy", "Clientes", "Mi negocio", "Ajustes"]);
    expect(screen.getByRole("tab", { name: "Hoy" }).getAttribute("aria-selected")).toBe("true");
  });

  it("English labels the four tabs", () => {
    render(<MachineScreen shop={{ ...demoShop, languages: ["en"] }} initial={initialPoll()} label="Lola" />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Today", "Clients", "My business", "Settings"]);
  });

  it("messages tile opens the tape and back returns", () => {
    render(<MachineScreen shop={demoShop} initial={initialPoll()} label="Lola" />);
    fireEvent.click(screen.getByRole("button", { name: /Mensajes nuevos/ }));
    expect(screen.getByRole("button", { name: "Escuchar" })).toBeTruthy();
    expect(screen.queryByRole("tab", { selected: true })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Volver" }));
    expect(screen.getByRole("tab", { name: "Hoy" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("button", { name: "Escuchar" })).toBeNull();
  });

  it("machine, Tape view: language switch, Lock, Today as the tab stop, Back, PLAY, then the cards in Tape_Order", () => {
    render(<MachineScreen shop={demoShop} initial={initialPoll()} label="Lola" />);
    fireEvent.click(screen.getByRole("button", { name: /Mensajes nuevos/ }));
    // NEXT, ERASE and COPY REPLY are disabled until a Message plays.
    expect(tabbables().map(nameOf)).toEqual(["Español", "English", "Bloquear", "Hoy", "Volver", "Escuchar", "card:m1", "card:m2"]);
    noPositiveTabindex();
  });

  it("machine, Tape view while playing: PLAY, NEXT, ERASE, COPY REPLY, then the cards", async () => {
    render(<MachineScreen shop={demoShop} initial={initialPoll()} label="Lola" />);
    fireEvent.click(screen.getByRole("button", { name: /Mensajes nuevos/ }));
    fireEvent.click(screen.getByRole("button", { name: "Escuchar" }));
    await waitFor(() => expect(document.querySelectorAll("[data-line]").length).toBeGreaterThan(0));
    expect(tabbables().map(nameOf)).toEqual([
      "Español",
      "English",
      "Bloquear",
      "Hoy",
      "Volver",
      "Escuchar",
      "Siguiente",
      "Borrar",
      "Copiar respuesta",
      "card:m1",
      "card:m2",
    ]);
    noPositiveTabindex();
  });

  it("machine, Today: language switch, Lock, the selected tab, the numbers, the day arrows, the week strip, then the day's bookings", () => {
    render(<MachineScreen shop={demoShop} initial={initialPoll()} label="Lola" />);
    expect(tabbables().map(nameOf)).toEqual([
      "Español",
      "English",
      "Bloquear",
      "Hoy",
      "Mensajes nuevos2",
      // Previous day is disabled on the first day of the agenda.
      "Día siguiente",
      "Día",
      "Semana",
      "mar 10, 1 cita",
      "mié 11, 1 cita",
      "jue 12, 0 citas",
      "vie 13, 0 citas",
      "sáb 14, 0 citas",
      "dom 15, 0 citas",
      "lun 16, 0 citas",
      // Tuesday 10, Ana at 16:00 (booked).
      "Hueco libre de 10:00 a 14:00",
      "16:00-16:30, Ana, corte, Pendiente",
      "Hueco libre de 17:00 a 20:00",
      "Hueco libre de 10:00 a 14:00",
      "Hueco libre de 17:00 a 20:00",
      // The + button comes last, after the book.
      "Añadir",
    ]);
    noPositiveTabindex();
  });

  it("only the selected tab is tabbable, and ArrowRight / ArrowLeft move selection and focus", () => {
    render(<MachineScreen shop={demoShop} initial={initialPoll()} label="Lola" />);
    const today = screen.getByRole("tab", { name: "Hoy" });
    const clients = screen.getByRole("tab", { name: "Clientes" });
    expect(today.getAttribute("aria-selected")).toBe("true");
    expect(today.tabIndex).toBe(0);
    expect(clients.tabIndex).toBe(-1);

    act(() => today.focus());
    fireEvent.keyDown(today, { key: "ArrowRight" });
    expect(clients.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(clients);
    expect(clients.tabIndex).toBe(0);
    expect(today.tabIndex).toBe(-1);
    expect(screen.getByRole("tabpanel").id).toBe(clients.getAttribute("aria-controls"));

    fireEvent.keyDown(clients, { key: "ArrowLeft" });
    expect(today.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(today);

    // Wraps around: ArrowLeft on the first tab goes to the last (Ajustes), ArrowRight comes back.
    fireEvent.keyDown(today, { key: "ArrowLeft" });
    const settings = screen.getByRole("tab", { name: "Ajustes" });
    expect(document.activeElement).toBe(settings);
    fireEvent.keyDown(settings, { key: "ArrowRight" });
    expect(document.activeElement).toBe(today);
  });

  it("stored view survives reload", () => {
    const { unmount } = render(<MachineScreen shop={demoShop} initial={initialPoll()} label="Lola" />);
    fireEvent.click(screen.getByRole("tab", { name: "Mi negocio" }));
    unmount();
    render(<MachineScreen shop={demoShop} initial={initialPoll()} label="Lola" />);
    expect(screen.getByRole("tab", { name: "Mi negocio" }).getAttribute("aria-selected")).toBe("true");
  });

  it("an unknown stored view falls back to Today", () => {
    sessionStorage.setItem(`pl:view:${demoShop.id}`, "agenda");
    render(<MachineScreen shop={demoShop} initial={initialPoll()} label="Lola" />);
    expect(screen.getByRole("tab", { name: "Hoy" }).getAttribute("aria-selected")).toBe("true");
  });
});
