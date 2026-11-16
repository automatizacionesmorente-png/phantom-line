import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { SESSION_HOURS, normalizeLabel, signSession, verifySession, type SessionPayload } from "@/lib/owner/session";
import { checkPinAttempts, pinCounterKeys, type PinLimitConfig } from "@/lib/owner/limits";
import { NUM_RUNS } from "../booking/arbitraries";

/** Secrets as an operator makes them (e.g. `openssl rand -base64 48`). */
const arbSecret = fc.string({
  unit: fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="),
  minLength: 32,
  maxLength: 64,
});

/** Epoch seconds between 2020 and 2040. */
const arbIat = fc.integer({ min: 1_577_836_800, max: 2_208_988_800 });

const arbCase = fc
  .record({
    shopId: fc.string({ unit: "grapheme", minLength: 1, maxLength: 20 }),
    otherShop: fc.string({ unit: "grapheme", minLength: 1, maxLength: 20 }),
    sameShop: fc.boolean(),
    sid: fc.uint8Array({ minLength: 16, maxLength: 16 }).map((b) => Buffer.from(b).toString("base64url")),
    rawLabel: fc.option(fc.string({ unit: "binary", maxLength: 50 }), { nil: undefined }),
    lang: fc.constantFrom("es" as const, "en" as const),
    iat: arbIat,
    // How far `now` is from `exp`, in ms: often right at the boundary.
    nowFromExpMs: fc.oneof(
      fc.constantFrom(-1, 0, 1, -1000, 999),
      fc.integer({ min: -SESSION_HOURS * 3_600_000 - 10_000, max: 3_600_000 }),
    ),
    pvSec: fc.integer({ min: 1_500_000_000, max: 2_200_000_000 }),
    pinMs: fc.integer({ min: 0, max: 999 }),
    pin: fc.constantFrom("same", "other", "null" as const),
    pinShiftSec: fc.integer({ min: -100_000, max: 100_000 }).filter((d) => d !== 0),
    secret: arbSecret,
    otherSecret: arbSecret,
  })
  .map((c) => {
    const p: SessionPayload = {
      v: 1,
      shopId: c.shopId,
      sid: c.sid,
      label: normalizeLabel(c.rawLabel, c.lang),
      iat: c.iat,
      exp: c.iat + SESSION_HOURS * 3600,
      pv: c.pvSec,
    };
    const pinSetAt =
      c.pin === "null"
        ? null
        : Temporal.Instant.fromEpochMilliseconds((c.pvSec + (c.pin === "same" ? 0 : c.pinShiftSec)) * 1000 + c.pinMs);
    const expect = {
      shopId: c.sameShop ? c.shopId : c.otherShop,
      now: Temporal.Instant.fromEpochMilliseconds(p.exp * 1000 + c.nowFromExpMs),
      pinSetAt,
    };
    return { p, expect, secret: c.secret, otherSecret: c.otherSecret };
  });

/** Every printable ASCII character plus a few non-ASCII ones, as replacements for one token character. */
const REPLACEMENTS = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).concat(["ñ", "€", "\u0000"]);

// M12. Session tokens. Validates 1.8.
describe("M12: session tokens verify exactly when shop, expiry and PIN version match", () => {
  it("verify(sign(p, s), s, expect) is ok iff shop, expiry and pv match", () => {
    const seen = { ok: 0, other_shop: 0, expired: 0, pin_changed: 0 } as Record<string, number>;
    fc.assert(
      fc.property(arbCase, ({ p, expect: ex, secret }) => {
        const result = verifySession(signSession(p, secret), secret, ex);
        // Oracle written from the property text, not from the code's order of checks.
        const shopOk = p.shopId === ex.shopId;
        const timeOk = ex.now.epochMilliseconds < p.exp * 1000;
        const pvOk = ex.pinSetAt !== null && p.pv === Math.floor(ex.pinSetAt.epochMilliseconds / 1000);
        const shouldPass = shopOk && timeOk && pvOk;
        expect(result.ok).toBe(shouldPass);
        if (result.ok) {
          expect(result.session).toEqual(p);
          seen.ok++;
        } else {
          expect(["other_shop", "expired", "pin_changed"]).toContain(result.reason);
          seen[result.reason]++;
        }
      }),
      { numRuns: NUM_RUNS },
    );
    // Every outcome must be reached, or the property tests less than it claims.
    for (const k of Object.keys(seen)) expect(seen[k], k).toBeGreaterThan(0);
  });

  it("changing any one character of a valid token, or another secret, gives ok: false", () => {
    const valid = arbCase.map((c) => ({
      ...c,
      expect: {
        shopId: c.p.shopId,
        now: Temporal.Instant.fromEpochMilliseconds(c.p.iat * 1000),
        pinSetAt: Temporal.Instant.fromEpochMilliseconds(c.p.pv * 1000),
      },
    }));
    fc.assert(
      fc.property(
        valid,
        fc.nat(),
        fc.constantFrom(...REPLACEMENTS),
        ({ p, expect: ex, secret, otherSecret }, rawIndex, replacement) => {
          const token = signSession(p, secret);
          expect(verifySession(token, secret, ex).ok).toBe(true);

          const i = rawIndex % token.length;
          fc.pre(token[i] !== replacement);
          const tampered = token.slice(0, i) + replacement + token.slice(i + 1);
          expect(verifySession(tampered, secret, ex).ok).toBe(false);

          if (otherSecret !== secret) {
            expect(verifySession(token, otherSecret, ex)).toEqual({ ok: false, reason: "bad_signature" });
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("changing the last MAC character never passes, although base64url decoding ignores its spare bits", () => {
    fc.assert(
      fc.property(arbCase, fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"), (c, ch) => {
        const token = signSession(c.p, c.secret);
        fc.pre(token.at(-1) !== ch);
        const ex = { shopId: c.p.shopId, now: Temporal.Instant.fromEpochMilliseconds(c.p.iat * 1000), pinSetAt: Temporal.Instant.fromEpochMilliseconds(c.p.pv * 1000) };
        expect(verifySession(token.slice(0, -1) + ch, c.secret, ex)).toEqual({ ok: false, reason: "bad_signature" });
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

const arbCfg: fc.Arbitrary<PinLimitConfig> = fc.record({
  perVisitorPer15Min: fc.integer({ min: 1, max: 50 }),
  perShopPerHour: fc.integer({ min: 1, max: 200 }),
});

// M13. PIN attempt limits. Validates 2.2, 2.3.
describe("M13: PIN attempt limits", () => {
  it("blocks exactly at the configured limits, visitor first; the Demo_Shop ignores any shop count", () => {
    const seen = { allowed: 0, visitor: 0, shop: 0, demoIgnoredShop: 0 };
    fc.assert(
      fc.property(
        arbCfg,
        fc.boolean(),
        // Counts near each limit as often as far from it.
        fc.integer({ min: -3, max: 3 }),
        fc.integer({ min: 1, max: 300 }),
        fc.integer({ min: -3, max: 3 }),
        fc.integer({ min: 1, max: 300 }),
        fc.boolean(),
        (cfg, demo, dv, freeV, ds, freeS, nearLimit) => {
          const visitor = Math.max(1, nearLimit ? cfg.perVisitorPer15Min + dv : freeV);
          const shopCount = Math.max(1, nearLimit ? cfg.perShopPerHour + ds : freeS);
          const result = checkPinAttempts({ visitor, shop: demo ? null : shopCount }, cfg);

          const visitorOver = visitor > cfg.perVisitorPer15Min;
          const shopOver = !demo && shopCount > cfg.perShopPerHour;
          if (visitorOver) {
            expect(result).toEqual({ blocked: true, limit: "visitor" });
            seen.visitor++;
          } else if (shopOver) {
            expect(result).toEqual({ blocked: true, limit: "shop" });
            seen.shop++;
          } else {
            expect(result).toEqual({ blocked: false });
            seen.allowed++;
          }
          if (demo) {
            // Whatever the shop count would have been, only the visitor count decides.
            const visitorOnly = checkPinAttempts({ visitor, shop: null }, { ...cfg, perShopPerHour: 1 });
            expect(result).toEqual(visitorOnly);
            if (!visitorOver && shopCount > cfg.perShopPerHour) seen.demoIgnoredShop++;
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
    for (const [k, v] of Object.entries(seen)) expect(v, k).toBeGreaterThan(0);
  });

  it("pinCounterKeys: only the visitor key for the Demo_Shop, visitor then shop otherwise, on aligned UTC windows", () => {
    fc.assert(
      fc.property(
        fc.string({ unit: "grapheme", minLength: 1, maxLength: 20 }),
        fc.string({ unit: "binary", minLength: 1, maxLength: 64 }),
        fc.integer({ min: 0, max: 4_102_444_800_000 }),
        fc.boolean(),
        (shopId, visitorKey, ms, demo) => {
          const keys = pinCounterKeys(shopId, visitorKey, Temporal.Instant.fromEpochMilliseconds(ms), demo);
          expect(keys.length).toBe(demo ? 1 : 2);
          expect(keys[0].key).toBe(`pin:v:${shopId}:${visitorKey}`);
          const v = keys[0].windowStart.epochMilliseconds;
          expect(v % 900_000).toBe(0);
          expect(v <= ms && ms < v + 900_000).toBe(true);
          if (!demo) {
            expect(keys[1].key).toBe(`pin:s:${shopId}`);
            const s = keys[1].windowStart.epochMilliseconds;
            expect(s % 3_600_000).toBe(0);
            expect(s <= ms && ms < s + 3_600_000).toBe(true);
          }
          expect(keys.some((k) => k.key.startsWith("pin:s:"))).toBe(!demo);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
