// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallScreen } from "@/components/call/CallScreen";
import { PinGate } from "@/components/machine/PinGate";
import { toGateShop } from "@/lib/owner/machineShop";
import { toPublicShop } from "@/lib/voice/publicShop";
import { lolaProfile } from "../fixtures/lola";
import { stubMatchMedia } from "./machine/machineFixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const trialProfile = { ...lolaProfile, id: "barberia-paco", name: "Barbería Paco" };
beforeEach(() => {
  stubMatchMedia(false);
  Element.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);

describe("the Prueba badge on a trial shop's pages", () => {
  it("shows on the call page of a trial shop and not on another shop", () => {
    const { container } = render(<CallScreen shop={{ ...toPublicShop(trialProfile), trial: true }} />);
    expect(container.querySelector("[data-trial]")?.textContent).toBe("Prueba");
    cleanup();
    expect(render(<CallScreen shop={toPublicShop(trialProfile)} />).container.querySelector("[data-trial]")).toBeNull();
  });

  it("shows on the machine's PIN gate of a trial shop and not on another shop", () => {
    expect(render(<PinGate shop={toGateShop(trialProfile, true)} />).container.querySelector("[data-trial]")?.textContent).toBe("Prueba");
    cleanup();
    expect(render(<PinGate shop={toGateShop(trialProfile)} />).container.querySelector("[data-trial]")).toBeNull();
  });
});
