// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

// Testing Library only cleans up on its own when `afterEach` is a global,
// and this config does not enable Vitest globals.
afterEach(cleanup);

describe("DOM test setup", () => {
  it("renders a button and finds it by role", () => {
    render(<button type="button">Play</button>);
    expect(screen.getByRole("button", { name: "Play" }).tagName).toBe("BUTTON");
  });

  it("runs in jsdom 29, which has no HTMLDialogElement.showModal", () => {
    expect(typeof window).toBe("object");
    // Measured in task 1.4 and recorded in design.md (open question 3): the move and
    // cancel dialog focus checks stay in the manual checklist. If a jsdom upgrade adds
    // showModal, this fails on purpose: add the dialog DOM tests of task 11.10 then.
    expect(typeof HTMLDialogElement.prototype.showModal).toBe("undefined");
  });
});
