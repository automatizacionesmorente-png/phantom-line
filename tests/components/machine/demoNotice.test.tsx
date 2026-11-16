// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallScreen } from "@/components/call/CallScreen";
import { MachineScreen } from "@/components/machine/MachineScreen";
import { PinGate } from "@/components/machine/PinGate";
import { demoNotice } from "@/lib/owner/demo";
import { toPublicShop } from "@/lib/voice/publicShop";
import { lolaProfile } from "../../fixtures/lola";
import {
  demoGate,
  demoShop,
  fakeMachineApi,
  initialPoll,
  realGate,
  realShop,
  stubMatchMedia,
  TAPE,
} from "./machineFixtures";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

// owner-machine 11.10 (Requirement 1.2, 3.3, 13.6): the Demo_Notice shows for the Demo_Shop on
// the PIN_Gate, the machine and the Call_Page before the Call, and never for a Real_Shop; the
// PIN_Gate shows no Counter, light state or Message data. jsdom 29 has no showModal() (task
// 1.4), so the dialog focus checks are in the manual checklist (task 12.4), not here.
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  router.refresh.mockReset();
});
beforeEach(() => {
  stubMatchMedia(false);
  vi.stubGlobal("fetch", fakeMachineApi([]).fetchMock);
  // jsdom has no layout, so no scrollIntoView; the Call_Page's Transcript calls it on mount.
  Element.prototype.scrollIntoView = () => {};
});

const notices = () => [...document.querySelectorAll("[data-demo-notice]")];

describe("Demo_Notice", () => {
  it("on the Demo_Shop's PIN_Gate, in the gate's language", () => {
    render(<PinGate shop={demoGate} />);
    expect(notices()).toHaveLength(1);
    expect(notices()[0].textContent).toBe(demoNotice("es"));
    expect(notices()[0].getAttribute("lang")).toBe("es");
  });

  it("on the Demo_Shop's machine, following the label language", () => {
    render(<MachineScreen shop={demoShop} initial={initialPoll()} label="Lola" />);
    expect(notices()).toHaveLength(1);
    expect(notices()[0].textContent).toBe("Demo: no dejes datos personales reales");
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(notices()[0].textContent).toBe("Demo: do not leave real personal data");
  });

  it("on the Demo_Shop's Call_Page before the Call starts", () => {
    render(<CallScreen shop={toPublicShop(lolaProfile)} demo />);
    expect(screen.getByRole("button", { name: /llamar|call/i })).toBeTruthy();
    expect(notices()).toHaveLength(1);
  });

  it("never for a Real_Shop: PIN_Gate, machine, Call_Page", () => {
    render(<PinGate shop={realGate} />);
    expect(notices()).toHaveLength(0);
    cleanup();
    render(<MachineScreen shop={realShop} initial={initialPoll()} label="Paco" />);
    expect(notices()).toHaveLength(0);
    cleanup();
    render(<CallScreen shop={toPublicShop({ ...lolaProfile, id: "barberia-paco" })} />);
    expect(notices()).toHaveLength(0);
  });
});

describe("the PIN_Gate shows nothing about the Shop's calls (1.2)", () => {
  it("no Counter, no light, no live region, no Message or Booking data", () => {
    render(<PinGate shop={demoGate} />);
    expect(document.querySelector("[data-counter]")).toBeNull();
    expect(document.querySelector("[data-light]")).toBeNull();
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(document.querySelector("[data-tape-card], [data-booking]")).toBeNull();
    const text = document.body.textContent ?? "";
    for (const t of TAPE) {
      expect(text).not.toContain(t.callerName!);
      expect(text).not.toContain(t.reason);
    }
    expect(text).not.toMatch(/mensaje|message/i);
    expect(text).toContain("Peluquería Lola");
  });

  it("a wrong PIN keeps the name, clears the PIN and says so (1.5); a right one refreshes into the machine (1.4)", async () => {
    let status = 401;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(status === 204 ? null : JSON.stringify({ error: "wrong_pin" }), { status })),
    );
    render(<PinGate shop={demoGate} />);
    const pin = screen.getByLabelText("PIN de 6 cifras") as HTMLInputElement;
    const name = screen.getByLabelText("Tu nombre (opcional)") as HTMLInputElement;
    fireEvent.change(pin, { target: { value: "123456" } });
    fireEvent.change(name, { target: { value: "Lola" } });
    fireEvent.click(screen.getByRole("button", { name: "Abrir el contestador" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Ese PIN no abre este contestador."));
    expect(pin.value).toBe("");
    expect(name.value).toBe("Lola");
    expect(router.refresh).not.toHaveBeenCalled();

    status = 204;
    fireEvent.change(pin, { target: { value: "198000" } });
    fireEvent.click(screen.getByRole("button", { name: "Abrir el contestador" }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
  });
});
