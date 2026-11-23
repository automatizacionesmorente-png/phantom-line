// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MachineScreen } from "@/components/machine/MachineScreen";
import { PinGate } from "@/components/machine/PinGate";
import { demoGate, demoShop, fakeMachineApi, initialPoll, stubMatchMedia } from "./machineFixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// BACKLOG 26: the PIN_Gate and the machine start in the browser's language when the shop
// speaks it, and the gate has the ES / EN switch.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  stubMatchMedia(false);
  vi.stubGlobal("fetch", fakeMachineApi([]).fetchMock);
});
const browser = (language: string) => vi.spyOn(navigator, "language", "get").mockReturnValue(language);

describe("browser language", () => {
  it("PIN_Gate starts in English for an English browser when the shop speaks it", () => {
    browser("en-US");
    render(<PinGate shop={demoGate} />);
    expect(screen.getByText("6-digit PIN")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open the machine" })).toBeTruthy();
  });

  it("PIN_Gate stays in the shop's first language for a browser the shop does not speak", () => {
    browser("fr-FR");
    render(<PinGate shop={demoGate} />);
    expect(screen.getByText("PIN de 6 cifras")).toBeTruthy();
    cleanup();
    browser("en-US");
    render(<PinGate shop={{ ...demoGate, languages: ["es"] }} />);
    expect(screen.getByText("PIN de 6 cifras")).toBeTruthy();
  });

  it("PIN_Gate has the ES / EN switch, and a click changes the language", () => {
    browser("es-ES");
    render(<PinGate shop={demoGate} />);
    const en = screen.getByRole("button", { name: "English" });
    expect(screen.getByRole("button", { name: "Español" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(en);
    expect(screen.getByText("6-digit PIN")).toBeTruthy();
    expect(en.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector("section")?.getAttribute("lang")).toBe("en");
  });

  it("the machine starts in English for an English browser, and the switch still wins", () => {
    browser("en-US");
    render(<MachineScreen shop={demoShop} initial={initialPoll()} label="Lola" />);
    expect(screen.getByRole("button", { name: "English" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Español" }));
    expect(screen.getByRole("button", { name: "Español" }).getAttribute("aria-pressed")).toBe("true");
  });
});
