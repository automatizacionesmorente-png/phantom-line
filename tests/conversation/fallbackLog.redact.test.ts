import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { redactCredentials, summarizeError } from "@/lib/conversation/fallbackLog";

// Production, 2026-11-16: the Neon driver quoted the whole connection string in its error message,
// and the turn_fallback line printed it to the Vercel log with the password.
const conn = (pass: string) => `postgresql://neondb_owner:${pass}@ep-x.eu-central-1.aws.neon.tech/neondb?sslmode=require`;

describe("redactCredentials", () => {
  it("removes the user and password of a connection string quoted by the Neon driver", () => {
    const err = new Error(`Database connection string provided to neon() is not a valid URL (connection string: "${conn("npg_Secret123")}")`);
    const out = summarizeError(err).message ?? "";
    expect(out).not.toContain("npg_Secret123");
    expect(out).not.toContain("neondb_owner");
    expect(out).toContain("postgresql://***@ep-x");
  });

  it("never leaves a password of any shape in the message", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z0-9_.~-]{6,40}$/), fc.string(), (pass, around) => {
        const out = redactCredentials(`${around} ${conn(pass)} ${around}`);
        return !out.includes(`:${pass}@`);
      }),
    );
  });

  it("removes bare Neon passwords and Google API keys", () => {
    expect(redactCredentials("password npg_AbC123xyz failed")).toBe("password npg_*** failed");
    expect(redactCredentials("key AIzaSyA1234567890abcdefghijk bad")).toBe("key AIza*** bad");
  });
});
