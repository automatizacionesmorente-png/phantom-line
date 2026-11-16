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
  it("PIN_Gate: PIN, then name, then Open the machine", () => {
    render(<PinGate shop={demoGate} />);
    expect(tabbables().map(nameOf)).toEqual(["field:PIN de 6 cifras", "field:Tu nombre (opcional)", "Abrir el contestador"]);
    noPositiveTabindex();
  });

  it("machine, Tape view: language switch, Lock, the selected tab, PLAY, then the cards in Tape_Order", () => {
    render(<MachineScreen shop={demoShop} initial={initialPoll()} label="Lola" />);
    // NEXT, ERASE and COPY REPLY are disabled until a Message plays.
    expect(tabbables().map(nameOf)).toEqual(["Español", "English", "Bloquear", "Cinta", "Escuchar", "card:m1", "card:m2"]);
    noPositiveTabindex();
  });

  it("machine, Tape view while playing: PLAY, NEXT, ERASE, COPY REPLY, then the cards", async () => {
    render(<MachineScreen shop={demoShop} initial={initialPoll()} label="Lola" />);
    fireEvent.click(screen.getByRole("button", { name: "Escuchar" }));
    await waitFor(() => expect(document.querySelectorAll("[data-line]").length).toBeGreaterThan(0));
    expect(tabbables().map(nameOf)).toEqual([
      "Español",
      "English",
      "Bloquear",
      "Cinta",
      "Escuchar",
      "Siguiente",
      "Borrar",
      "Copiar respuesta",
      "card:m1",
      "card:m2",
    ]);
    noPositiveTabindex();
  });

  it("machine, Agenda view: language switch, Lock, the selected tab, then each day's actions in time order", () => {
    render(<MachineScreen shop={demoShop} initial={initialPoll()} label="Lola" />);
    fireEvent.click(screen.getByRole("tab", { name: "Agenda" }));
    expect(tabbables().map(nameOf)).toEqual([
      "Español",
      "English",
      "Bloquear",
      "Agenda",
      // Tuesday 10, Ana at 16:00 (booked): confirm, move, cancel.
      "Confirmar",
      "Mover",
      "Cancelar",
      // Wednesday 11, Pedro at 11:00 (confirmed): move, cancel.
      "Mover",
      "Cancelar",
    ]);
    noPositiveTabindex();
  });

  it("only the selected tab is tabbable, and ArrowRight / ArrowLeft move selection and focus", () => {
    render(<MachineScreen shop={demoShop} initial={initialPoll()} label="Lola" />);
    const tape = screen.getByRole("tab", { name: "Cinta" });
    const agenda = screen.getByRole("tab", { name: "Agenda" });
    expect(tape.getAttribute("aria-selected")).toBe("true");
    expect(tape.tabIndex).toBe(0);
    expect(agenda.tabIndex).toBe(-1);

    act(() => tape.focus());
    fireEvent.keyDown(tape, { key: "ArrowRight" });
    expect(agenda.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(agenda);
    expect(agenda.tabIndex).toBe(0);
    expect(tape.tabIndex).toBe(-1);
    expect(screen.getByRole("tabpanel").id).toBe(agenda.getAttribute("aria-controls"));

    fireEvent.keyDown(agenda, { key: "ArrowLeft" });
    expect(tape.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tape);

    // Wraps around: ArrowLeft on the first tab goes to the last.
    fireEvent.keyDown(tape, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(agenda);
  });

  it("remembers the last view during the session (6.6)", () => {
    const { unmount } = render(<MachineScreen shop={demoShop} initial={initialPoll()} label="Lola" />);
    fireEvent.click(screen.getByRole("tab", { name: "Agenda" }));
    unmount();
    render(<MachineScreen shop={demoShop} initial={initialPoll()} label="Lola" />);
    expect(screen.getByRole("tab", { name: "Agenda" }).getAttribute("aria-selected")).toBe("true");
  });
});
