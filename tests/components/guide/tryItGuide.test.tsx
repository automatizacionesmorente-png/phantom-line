// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallScreen } from "@/components/call/CallScreen";
import { GUIDE_STORAGE_KEY } from "@/components/guide/guideCopy";
import { TryItGuide } from "@/components/guide/TryItGuide";
import { PinGate } from "@/components/machine/PinGate";
import Home from "@/app/page";
import { toPublicShop } from "@/lib/voice/publicShop";
import { lolaProfile } from "../../fixtures/lola";
import { demoGate, realGate, stubMatchMedia } from "../machine/machineFixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// BACKLOG 2: "Try it in 30 seconds", a small dismissible strip, ES and EN, remembered.
const guide = () => document.querySelector("[data-try-it-guide]");

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});
beforeEach(() => {
  stubMatchMedia(false);
  localStorage.clear(); // stubMatchMedia pre-dismisses it for the other suites
  Element.prototype.scrollIntoView = () => {};
});

describe("TryItGuide", () => {
  it("shows the three steps in Spanish, then in English, and marks the current step", () => {
    render(<TryItGuide current={2} lang="es" />);
    expect(screen.getByText("Pruébalo en 30 segundos")).toBeTruthy();
    expect(screen.getByText("Abre el contestador con el PIN 198000")).toBeTruthy();
    expect(document.querySelectorAll("li")).toHaveLength(3);
    expect(document.querySelector("[aria-current='step']")?.textContent).toContain("PIN 198000");
    cleanup();
    render(<TryItGuide current={1} lang="en" />);
    expect(screen.getByText("Try it in 30 seconds")).toBeTruthy();
    expect(document.querySelector("[aria-current='step']")?.textContent).toContain("Call and book");
  });

  it("without a lang it follows the browser language", () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("en-GB");
    render(<TryItGuide />);
    expect(screen.getByText("Watch it blink with your message")).toBeTruthy();
    expect(document.querySelector("[aria-current]")).toBeNull();
  });

  it("is a labelled landmark and the close button is a real, named button", () => {
    render(<TryItGuide lang="en" />);
    expect(screen.getByRole("complementary", { name: "Try it in 30 seconds" })).toBeTruthy();
    const close = screen.getByRole("button", { name: "Close the guide" });
    close.focus();
    expect(document.activeElement).toBe(close);
  });

  it("closing it removes it, remembers it, and a new page view does not bring it back", () => {
    render(<TryItGuide lang="es" />);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar la guía" }));
    expect(guide()).toBeNull();
    expect(localStorage.getItem(GUIDE_STORAGE_KEY)).toBe("1");
    cleanup();
    render(<TryItGuide lang="es" />);
    expect(guide()).toBeNull();
  });

  it("closing it on one page removes every copy on screen", () => {
    render(
      <>
        <TryItGuide lang="es" />
        <TryItGuide lang="en" />
      </>,
    );
    expect(document.querySelectorAll("[data-try-it-guide]")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: /Cerrar|Close/ })[0]);
    expect(guide()).toBeNull();
  });
});

describe("where it appears", () => {
  it("landing, Demo_Shop call page and Demo_Shop PIN gate; never for a real shop", () => {
    render(<Home />);
    expect(guide()).not.toBeNull();
    cleanup();
    render(<CallScreen shop={toPublicShop(lolaProfile)} demo />);
    expect(guide()).not.toBeNull();
    expect(document.querySelector("[aria-current='step']")?.textContent).toContain("Llama");
    cleanup();
    render(<PinGate shop={demoGate} />);
    expect(guide()).not.toBeNull();
    cleanup();
    render(<PinGate shop={realGate} />);
    expect(guide()).toBeNull();
    cleanup();
    render(<CallScreen shop={toPublicShop({ ...lolaProfile, id: "barberia-paco" })} />);
    expect(guide()).toBeNull();
  });
});
