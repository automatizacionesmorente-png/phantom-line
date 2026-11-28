// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessageCounter } from "@/components/machine/MessageCounter";
import { MACHINE_COPY } from "@/components/machine/machineCopy";
import { TapeReels } from "@/components/machine/TapeReels";
import { isSlimView, MACHINE_VIEWS } from "@/components/machine/ViewTabs";

describe("slim machine header", () => {
  it("only Clients, My business and Settings are slim", () => {
    expect(MACHINE_VIEWS.filter(isSlimView)).toEqual(["clients", "business", "settings"]);
  });
  it("the slim counter is one heading line with the count", () => {
    render(<MessageCounter count={3} lang="es" copy={MACHINE_COPY.es} slim />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("3 mensajes nuevos");
  });
  it("small reels stay decorative and still", () => {
    const { container } = render(<TapeReels spinning={false} small />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("aria-hidden")).toBe("true");
    expect(root.getAttribute("data-reels")).toBe("still");
    expect(container.querySelector("svg")?.getAttribute("width")).toBe("28");
  });
});
