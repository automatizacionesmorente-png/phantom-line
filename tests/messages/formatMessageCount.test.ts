import { describe, expect, it } from "vitest";
import { formatMessageCount } from "@/lib/messages";

describe("formatMessageCount with a language (owner-machine 6.3)", () => {
  it("Spanish, singular and plural", () => {
    expect(formatMessageCount(1, "es")).toBe("1 mensaje nuevo");
    expect(formatMessageCount(3, "es")).toBe("3 mensajes nuevos");
    expect(formatMessageCount(0, "es")).toBe("ningún mensaje nuevo");
  });

  it("English, and English is the default", () => {
    expect(formatMessageCount(3, "en")).toBe("3 new messages");
    expect(formatMessageCount(1, "en")).toBe("1 new message");
    expect(formatMessageCount(0, "en")).toBe(formatMessageCount(0));
  });
});
