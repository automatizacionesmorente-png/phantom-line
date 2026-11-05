import { describe, it, expect } from "vitest";
import { formatMessageCount } from "../lib/messages";
import fc from "fast-check";

describe("formatMessageCount (smoke test)", () => {
  it("returns 'no new messages' for zero", () => {
    expect(formatMessageCount(0)).toBe("no new messages");
  });

  it("returns singular form for one", () => {
    expect(formatMessageCount(1)).toBe("1 new message");
  });

  it("returns plural form for more than one", () => {
    expect(formatMessageCount(3)).toBe("3 new messages");
  });

  it("never shows a negative number in the output", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9999 }), (n) => {
        const result = formatMessageCount(n);
        expect(result).not.toMatch(/-\d+/);
      }),
    );
  });

  it("always contains the word 'message'", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9999 }), (n) => {
        expect(formatMessageCount(n)).toMatch(/message/);
      }),
    );
  });
});
