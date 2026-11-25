// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MachineScreen } from "@/components/machine/MachineScreen";
import { demoShop, fakeMachineApi, initialPoll, stubMatchMedia } from "./machineFixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// owner-machine 11.9 (Requirement 13.4, 13.9): with prefers-reduced-motion the light has no
// blink or flicker class, the reels never get the spin class, and every Transcript line is
// visible at once; with motion allowed the same render has them, so the test proves the
// switch and not only the absence. jsdom runs no animations: the classes are the contract.
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

const light = () => document.querySelector("[data-light]")!;
const lightClasses = () => [light(), ...light().querySelectorAll("*")].flatMap((el) => [...el.classList]);
const reelClasses = () => [...document.querySelectorAll("[data-reels] *")].flatMap((el) => [...el.classList]);
const lines = () => [...document.querySelectorAll<HTMLElement>("[data-line]")];

async function playFirst() {
  fireEvent.click(screen.getByRole("button", { name: /Mensajes nuevos/ }));
  fireEvent.click(screen.getByRole("button", { name: "Escuchar" }));
  await waitFor(() => expect(lines().length).toBe(5));
}

describe.each([
  { reduce: true, label: "reduced motion" },
  { reduce: false, label: "motion allowed" },
])("$label", ({ reduce }) => {
  it("the light blinks and flickers only when motion is allowed", () => {
    stubMatchMedia(reduce);
    vi.stubGlobal("fetch", fakeMachineApi([]).fetchMock);
    render(<MachineScreen shop={demoShop} initial={initialPoll()} label="Lola" />);
    expect(light().getAttribute("data-light")).toBe("blinking");
    expect(lightClasses().includes("light-blink")).toBe(!reduce);
    expect(lightClasses().includes("light-flicker")).toBe(!reduce);
  });

  it("the reels spin while playing only when motion is allowed, and the Transcript is revealed at once only with reduced motion", async () => {
    stubMatchMedia(reduce);
    vi.stubGlobal("fetch", fakeMachineApi([]).fetchMock);
    render(<MachineScreen shop={demoShop} initial={initialPoll()} label="Lola" />);
    expect(reelClasses().includes("reel-spin")).toBe(false);
    await playFirst();
    expect(reelClasses().includes("reel-spin")).toBe(!reduce);
    const hidden = lines().filter((l) => l.classList.contains("tape-line-hidden"));
    if (reduce) expect(hidden).toEqual([]);
    else expect(hidden.length).toBe(4);
    // Hidden only visually: every line is in the DOM as text from the start (7.3).
    expect(lines().map((l) => l.textContent)).toEqual([
      "Asistente:¡Hola! Estás llamando a Peluquería Lola, soy su asistente virtual.",
      "Cliente:Me teñí ayer y tengo una reacción.",
      "Asistente:Eso no lo sé, pero se lo dejo apuntado a Lola.",
      "Cliente:Marta.",
      "Asistente:¿Me das tu teléfono?",
    ]);
    for (const l of lines()) expect(l.getAttribute("aria-hidden")).toBeNull();
  });
});

describe("motion allowed: the tape reveal ends and the reels stop", () => {
  it("one more line every 900 ms, then the reels stop", async () => {
    stubMatchMedia(false);
    vi.stubGlobal("fetch", fakeMachineApi([]).fetchMock);
    render(<MachineScreen shop={demoShop} initial={initialPoll()} label="Lola" />);
    await playFirst();
    // 4 more lines at 900 ms each: real time, about 3.6 s.
    await waitFor(() => expect(lines().filter((l) => l.classList.contains("tape-line-hidden"))).toEqual([]), {
      timeout: 6000,
    });
    await waitFor(() => expect(reelClasses().includes("reel-spin")).toBe(false), { timeout: 3000 });
  }, 15000);
});
