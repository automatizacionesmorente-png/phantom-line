import { scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PIN_PATTERN, hashPin, verifyPin } from "@/lib/owner/pin";

describe("PIN_PATTERN", () => {
  it("accepts exactly 6 digits", () => {
    expect(PIN_PATTERN.test("042517")).toBe(true);
    for (const bad of ["", "12345", "1234567", "12345a", " 123456", "123456\n", "１２３４５６"]) {
      expect(PIN_PATTERN.test(bad)).toBe(false);
    }
  });
});

describe("hashPin and verifyPin", () => {
  it("round trip: the hash verifies its own PIN, in the documented format", async () => {
    const stored = await hashPin("042517");
    expect(stored).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(stored).not.toContain("042517");
    await expect(verifyPin("042517", stored)).resolves.toBe(true);
  });

  it("a wrong PIN does not verify", async () => {
    const stored = await hashPin("042517");
    for (const wrong of ["042518", "000000", "42517", "", "0425170"]) {
      await expect(verifyPin(wrong, stored)).resolves.toBe(false);
    }
  });

  it("two hashes of one PIN differ (random salt), and both verify", async () => {
    const a = await hashPin("111111");
    const b = await hashPin("111111");
    expect(a).not.toBe(b);
    expect(a.split("$")[4]).not.toBe(b.split("$")[4]);
    await expect(verifyPin("111111", a)).resolves.toBe(true);
    await expect(verifyPin("111111", b)).resolves.toBe(true);
  });

  it("a malformed stored hash returns false without throwing", async () => {
    const good = await hashPin("123456");
    const [, n, r, p, salt, key] = good.split("$");
    const malformed: unknown[] = [
      "",
      "123456",
      "scrypt",
      `bcrypt$${n}$${r}$${p}$${salt}$${key}`,
      `scrypt$${n}$${r}$${p}$${salt}`,
      `scrypt$${n}$${r}$${p}$${salt}$${key}$extra`,
      `scrypt$abc$${r}$${p}$${salt}$${key}`,
      `scrypt$16383$${r}$${p}$${salt}$${key}`, // N not a power of two
      `scrypt$1073741824$${r}$${p}$${salt}$${key}`, // N far too large
      `scrypt$0${n}$${r}$${p}$${salt}$${key}`, // leading zero
      `scrypt$${n}$0$${p}$${salt}$${key}`,
      `scrypt$${n}$${r}$-1$${salt}$${key}`,
      `scrypt$${n}$${r}$${p}$not+base64/$${key}`,
      `scrypt$${n}$${r}$${p}$${salt}$`,
      `scrypt$${n}$${r}$${p}$AAAA$${key}`, // salt too short
      `scrypt$${n}$${r}$${p}$${salt}$AAAA`, // key too short
      null,
      undefined,
      42,
    ];
    for (const stored of malformed) {
      await expect(verifyPin("123456", stored as string)).resolves.toBe(false);
    }
  });

  it("recomputes with the stored parameters, also above Node's default 32 MiB maxmem", async () => {
    // N = 32768, r = 8 needs 32 MiB: Node 20 throws ERR_CRYPTO_INVALID_SCRYPT_PARAMS without an explicit maxmem.
    const salt = Buffer.alloc(16, 7);
    const key = scryptSync("654321", salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const stored = `scrypt$32768$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`;
    await expect(verifyPin("654321", stored)).resolves.toBe(true);
    await expect(verifyPin("654320", stored)).resolves.toBe(false);
  });

  it("a changed hash byte does not verify", async () => {
    const stored = await hashPin("123456");
    const last = stored.at(-2) === "A" ? "B" : "A";
    const tampered = stored.slice(0, -2) + last + stored.at(-1);
    await expect(verifyPin("123456", tampered)).resolves.toBe(false);
  });
});
