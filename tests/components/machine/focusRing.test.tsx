// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MachineScreen } from "@/components/machine/MachineScreen";
import { PinGate } from "@/components/machine/PinGate";
import { demoGate, demoShop, fakeMachineApi, initialPoll, nameOf, stubMatchMedia, tabbables } from "./machineFixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// owner-machine 11.7 (Requirement 13.1, 13.9): every tabbable element carries `focus-ring`,
// the one class whose :focus-visible outline is gold (tests/design/contrast.test.ts checks
// the CSS rule). jsdom computes no :focus-visible styles, so the class is the contract.
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  stubMatchMedia(false);
});

const withoutRing = () => tabbables().filter((el) => !el.classList.contains("focus-ring")).map(nameOf);

describe("focus ring on every focusable control", () => {
  it("PIN_Gate", () => {
    vi.stubGlobal("fetch", fakeMachineApi([]).fetchMock);
    render(<PinGate shop={demoGate} />);
    expect(tabbables().length).toBe(5); // the ES / EN switch, PIN, name, Open
    expect(withoutRing()).toEqual([]);
  });

  it("machine, Tape view while a Message plays, including the copy fallback box", async () => {
    vi.stubGlobal("fetch", fakeMachineApi([]).fetchMock);
    // No Clipboard API: COPY REPLY shows the read-only text box, which is focusable too.
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    render(<MachineScreen shop={demoShop} initial={initialPoll()} label="Lola" />);
    fireEvent.click(screen.getByRole("button", { name: /Mensajes nuevos/ }));
    fireEvent.click(screen.getByRole("button", { name: "Escuchar" }));
    await waitFor(() => expect(document.querySelectorAll("[data-line]").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "Copiar respuesta" }));
    await waitFor(() => expect(document.querySelector("textarea")).not.toBeNull());
    expect(tabbables().length).toBeGreaterThanOrEqual(11);
    expect(withoutRing()).toEqual([]);
  });

  it("machine, Today view", () => {
    vi.stubGlobal("fetch", fakeMachineApi([]).fetchMock);
    render(<MachineScreen shop={demoShop} initial={initialPoll()} label="Lola" />);
    fireEvent.click(screen.getByRole("tab", { name: "Hoy" }));
    expect(tabbables().length).toBe(10);
    expect(withoutRing()).toEqual([]);
  });

  it("the dialogs' controls carry it too (checked with the dialog content in the DOM)", async () => {
    vi.stubGlobal("fetch", fakeMachineApi([]).fetchMock);
    render(<MachineScreen shop={demoShop} initial={initialPoll()} label="Lola" />);
    fireEvent.click(screen.getByRole("tab", { name: "Hoy" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Mover" })[0]);
    await waitFor(() => expect(document.querySelector("dialog")).not.toBeNull());
    const dialog = document.querySelector("dialog")!;
    const controls = [...dialog.querySelectorAll<HTMLElement>("button, select, input")];
    expect(controls.length).toBeGreaterThanOrEqual(3);
    expect(controls.filter((el) => !el.classList.contains("focus-ring")).map(nameOf)).toEqual([]);
  });
});
