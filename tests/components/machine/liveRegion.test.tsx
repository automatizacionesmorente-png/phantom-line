// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MachineScreen } from "@/components/machine/MachineScreen";
import { lightAnnouncement } from "@/lib/messages/tape";
import { demoShop, fakeMachineApi, initialPoll, stubMatchMedia, TAPE, tapeItem, unchangedPoll } from "./machineFixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// owner-machine 11.8 (Requirement 13.2, 13.9): exactly one polite status region; a Poll with
// one more unheard Message changes it to the new lightAnnouncement; a Poll with the same
// counts leaves its text node untouched, so a screen reader hears nothing twice.
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  stubMatchMedia(false);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
});

const statuses = () => [...document.querySelectorAll('[role="status"]')];

async function nextPoll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
}

describe("the live region", () => {
  it("is exactly one polite role=status holding the light and the counter as text", () => {
    vi.stubGlobal("fetch", fakeMachineApi([]).fetchMock);
    render(<MachineScreen shop={demoShop} initial={initialPoll()} label="Lola" />);
    expect(statuses()).toHaveLength(1);
    expect(statuses()[0].getAttribute("aria-live")).toBe("polite");
    expect(statuses()[0].textContent).toBe("2 mensajes nuevos, 1 sin escuchar");
  });

  it("announces a new unheard Message once, and stays the same text node for a Poll with the same counts", async () => {
    const first = initialPoll();
    const more = initialPoll([tapeItem({ id: "m3", callerName: "Ana", createdAt: "2026-11-10T08:00:02Z" }), ...TAPE], 11);
    const api = fakeMachineApi([more, unchangedPoll(more), unchangedPoll(more)]);
    vi.stubGlobal("fetch", api.fetchMock);
    render(<MachineScreen shop={demoShop} initial={first} label="Lola" />);
    const region = statuses()[0];

    await nextPoll();
    expect(api.calls.at(-1)?.url).toBe("/api/machine/peluqueria-lola?since=10");
    const expected = lightAnnouncement({ new: 3, unheard: 2 }, "es");
    expect(expected).toBe("3 mensajes nuevos, 2 sin escuchar");
    expect(region.textContent).toBe(expected);
    const node = region.firstChild;

    await nextPoll();
    expect(api.calls.at(-1)?.url).toBe("/api/machine/peluqueria-lola?since=11");
    expect(region.textContent).toBe(expected);
    expect(region.firstChild).toBe(node);

    await nextPoll();
    expect(api.calls.filter((c) => c.url.includes("?since=")).length).toBe(3);
    expect(region.firstChild).toBe(node);
    expect(statuses()).toHaveLength(1);
  });

  it("the Counter and the light follow the same Poll", async () => {
    const more = initialPoll([tapeItem({ id: "m3", createdAt: "2026-11-10T08:00:02Z" }), ...TAPE], 11);
    vi.stubGlobal("fetch", fakeMachineApi([more]).fetchMock);
    render(<MachineScreen shop={demoShop} initial={initialPoll()} label="Lola" />);
    expect(document.querySelector("[data-counter]")?.textContent).toBe("2");
    await nextPoll();
    expect(document.querySelector("[data-counter]")?.textContent).toBe("3");
    expect(document.querySelector("[data-light]")?.getAttribute("data-light")).toBe("blinking");
  });
});
