import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import {
  SESSION_COOKIE,
  SESSION_HOURS,
  normalizeLabel,
  pinVersionOf,
  signSession,
  verifySession,
  type SessionPayload,
} from "@/lib/owner/session";

const SECRET = "s".repeat(32) + "-test-only-not-a-real-secret";
const PIN_SET_AT = Temporal.Instant.from("2026-11-01T09:00:00.750Z");
const IAT = Temporal.Instant.from("2026-11-16T08:00:00Z");

const payload = (over: Partial<SessionPayload> = {}): SessionPayload => ({
  v: 1,
  shopId: "peluqueria-lola",
  sid: "AAAAAAAAAAAAAAAAAAAAAA",
  label: "Lola",
  iat: IAT.epochMilliseconds / 1000,
  exp: IAT.epochMilliseconds / 1000 + SESSION_HOURS * 3600,
  pv: pinVersionOf(PIN_SET_AT),
  ...over,
});

const expectOk = { shopId: "peluqueria-lola", now: IAT.add({ hours: 1 }), pinSetAt: PIN_SET_AT };

/** A token signed correctly over an arbitrary body, to reach the checks behind the signature. */
const signRaw = (json: string, secret = SECRET) => {
  const signed = `v1.${Buffer.from(json, "utf8").toString("base64url")}`;
  return `${signed}.${createHmac("sha256", secret).update(signed).digest("base64url")}`;
};

describe("constants", () => {
  it("cookie name uses the __Host- prefix; sessions last 12 hours", () => {
    expect(SESSION_COOKIE).toBe("__Host-pl_owner");
    expect(SESSION_HOURS).toBe(12);
  });
});

describe("signSession / verifySession", () => {
  it("a fresh token verifies and returns the payload", () => {
    const token = signSession(payload(), SECRET);
    expect(token).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    expect(verifySession(token, SECRET, expectOk)).toEqual({ ok: true, session: payload() });
  });

  it("missing: no cookie or an empty one", () => {
    expect(verifySession(undefined, SECRET, expectOk)).toEqual({ ok: false, reason: "missing" });
    expect(verifySession("", SECRET, expectOk)).toEqual({ ok: false, reason: "missing" });
  });

  it("malformed: wrong shape, wrong prefix, bad characters, or a signed body that is not a payload", () => {
    const token = signSession(payload(), SECRET);
    const [, body, sig] = token.split(".");
    for (const bad of ["garbage", `v2.${body}.${sig}`, `v1.${body}`, `v1.${body}.${sig}.x`, `v1..${sig}`, `v1.${body}.`, `v1.${body}+.${sig}`]) {
      expect(verifySession(bad, SECRET, expectOk)).toEqual({ ok: false, reason: "malformed" });
    }
    expect(verifySession(signRaw("not json"), SECRET, expectOk)).toEqual({ ok: false, reason: "malformed" });
    expect(verifySession(signRaw(JSON.stringify({ ...payload(), v: 2 })), SECRET, expectOk)).toEqual({ ok: false, reason: "malformed" });
    expect(verifySession(signRaw(JSON.stringify({ ...payload(), admin: true })), SECRET, expectOk)).toEqual({ ok: false, reason: "malformed" });
    expect(verifySession(signRaw(JSON.stringify({ ...payload(), exp: "never" })), SECRET, expectOk)).toEqual({ ok: false, reason: "malformed" });
  });

  it("bad_signature: another secret, a changed body, a changed MAC, or an unusable secret", () => {
    const token = signSession(payload(), SECRET);
    const [, body, sig] = token.split(".");
    expect(verifySession(token, SECRET + "x", expectOk)).toEqual({ ok: false, reason: "bad_signature" });
    const forged = Buffer.from(JSON.stringify(payload({ shopId: "other" }))).toString("base64url");
    expect(verifySession(`v1.${forged}.${sig}`, SECRET, expectOk)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifySession(`v1.${body}.${sig.slice(0, -1)}${sig.at(-1) === "A" ? "B" : "A"}`, SECRET, expectOk)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    expect(verifySession(token, "", expectOk)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifySession(token, "short", expectOk)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("signSession refuses a missing or short secret", () => {
    expect(() => signSession(payload(), "")).toThrow();
    expect(() => signSession(payload(), "x".repeat(31))).toThrow();
  });

  it("expired: at exp and after, valid one second before", () => {
    const token = signSession(payload(), SECRET);
    const exp = Temporal.Instant.fromEpochMilliseconds(payload().exp * 1000);
    expect(verifySession(token, SECRET, { ...expectOk, now: exp.subtract({ seconds: 1 }) }).ok).toBe(true);
    expect(verifySession(token, SECRET, { ...expectOk, now: exp })).toEqual({ ok: false, reason: "expired" });
    expect(verifySession(token, SECRET, { ...expectOk, now: exp.add({ hours: 3 }) })).toEqual({ ok: false, reason: "expired" });
  });

  it("other_shop: a session for one Shop does not open another", () => {
    const token = signSession(payload(), SECRET);
    expect(verifySession(token, SECRET, { ...expectOk, shopId: "panaderia-sol" })).toEqual({ ok: false, reason: "other_shop" });
  });

  it("pin_changed: a PIN change (to the second) or a Shop with no PIN revokes the session", () => {
    const token = signSession(payload(), SECRET);
    // Same second, other milliseconds: still the same PIN version.
    expect(verifySession(token, SECRET, { ...expectOk, pinSetAt: Temporal.Instant.from("2026-11-01T09:00:00.001Z") }).ok).toBe(true);
    expect(verifySession(token, SECRET, { ...expectOk, pinSetAt: PIN_SET_AT.add({ seconds: 1 }) })).toEqual({ ok: false, reason: "pin_changed" });
    expect(verifySession(token, SECRET, { ...expectOk, pinSetAt: null })).toEqual({ ok: false, reason: "pin_changed" });
  });
});

describe("normalizeLabel", () => {
  it("removes control characters and collapses runs of spaces", () => {
    expect(normalizeLabel("  Lo\u0000la\u0007  \t\n  Pérez\u200B\u202E  ", "es")).toBe("Lola Pérez");
    expect(normalizeLabel("Ana\r\nMaría", "en")).toBe("Ana María");
    expect(normalizeLabel("a\u2028b", "en")).toBe("ab");
  });

  it("the empty label defaults to Dueño / Owner, also when only spaces or controls remain", () => {
    expect(normalizeLabel(undefined, "es")).toBe("Dueño");
    expect(normalizeLabel("", "en")).toBe("Owner");
    expect(normalizeLabel("   \t ", "es")).toBe("Dueño");
    expect(normalizeLabel("\u0000\u001F\u007F", "en")).toBe("Owner");
  });

  it("keeps at most 30 characters, never splitting a surrogate pair, with no trailing space", () => {
    expect(normalizeLabel("x".repeat(40), "es")).toBe("x".repeat(30));
    expect(Array.from(normalizeLabel("😀".repeat(40), "es"))).toHaveLength(30);
    expect(normalizeLabel("x".repeat(29) + " yz", "en")).toBe("x".repeat(29));
  });

  it("a normalized label round-trips through a session", () => {
    const label = normalizeLabel("😀".repeat(40), "es");
    const token = signSession(payload({ label }), SECRET);
    expect(verifySession(token, SECRET, expectOk)).toEqual({ ok: true, session: payload({ label }) });
  });
});
