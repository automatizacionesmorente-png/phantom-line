import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import type { TtsFallbackLogEvent } from "@/lib/conversation/fallbackLog";
import { scrubMessage } from "@/lib/conversation/fallbackLog";
import { DEFAULT_TTS_LIMITS, type TtsLimitStore } from "@/lib/conversation/ttsLimits";
import { speakPhone } from "@/lib/receptionist/spoken";
import { signSpeech } from "@/lib/receptionist/speechToken";
import { lolaProfile } from "../fixtures/lola";

// The real TTS client is used, with a fake SDK; `server-only` throws outside a React Server environment.
vi.mock("server-only", () => ({}));
const { createTtsClient } = await import("@/lib/receptionist/ttsClient");
const { makeSpeechHandler } = await import("@/app/api/speech/handler");
const { visitorKeyOf } = await import("@/app/api/turn/handler");
type TtsSdk = import("@/lib/receptionist/ttsClient").TtsSdk;

/**
 * N14. The `tts_fallback` log carries no personal data. For all texts, names, phones, tokens,
 * keys and visitor keys used in a failing request, the logged JSON contains none of them, and
 * the key appears only as `***`. Validates 4.5, 4.7.
 *
 * The failing request goes through the real route and the real TTS client; the fake SDK throws
 * an error (the SDK's own shape) whose message echoes everything it could have seen.
 */

const NOW = Temporal.Instant.from("2026-11-13T10:00:00Z");
const SECRET = "n14-secret";
const SALT = "n14-salt";

class BadRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`${status} ${message}`);
    this.name = "BadRequestError";
  }
}
class InternalServerError extends BadRequestError {}

const name = fc.oneof(
  fc.constantFrom("Ana", "Luis", "María del Carmen", "José Ángel", "Íñigo", "Li", "Bo"),
  fc.stringMatching(/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{1,11}( [A-ZÁÉÍÓÚÑ][a-záéíóúñ]{1,11})?$/),
);
const phone = fc.tuple(fc.constantFrom("6", "7"), fc.stringMatching(/^\d{8}$/)).map(([a, b]) => `+34${a}${b}`);
const apiKey = fc.stringMatching(/^AIza[0-9A-Za-z_-]{35}$/);
const ip = fc.tuple(fc.nat(255), fc.nat(255), fc.nat(255), fc.nat(255)).map((p) => p.join("."));
const failure = fc.constantFrom(
  { status: 400, Cls: BadRequestError },
  { status: 500, Cls: InternalServerError },
  { status: 503, Cls: InternalServerError },
  { status: 0, Cls: null }, // a streamed error event
);

const okLimits: TtsLimitStore = {
  hitSay: async () => ({ counts: { visitor: 1, hour: 1, day: 1 }, exhausted: [] }),
  hitReport: async () => 1,
  markExhausted: async () => undefined,
};

describe("N14: the tts_fallback log carries no personal data", () => {
  it("through the real route and TTS client, for any failing request", async () => {
    await fc.assert(
      fc.asyncProperty(name, phone, apiKey, ip, failure, fc.boolean(), async (who, tel, key, from, fail, cacheable) => {
        const text = `Te apunto un corte mañana a las cinco, a nombre de ${who}. Tu teléfono es el ${speakPhone(tel, "es")}, ¿vale?`;
        const token = signSpeech({ shopId: lolaProfile.id, language: "es", text, cacheable }, SECRET, NOW.epochMilliseconds);
        const visitorKey = visitorKeyOf(from, SALT);
        const echo = `request rejected key=${key} token=${token} visitor=${visitorKey} text="${text}" name=${who} phone=${speakPhone(tel, "es")}`;
        const sdk: TtsSdk = {
          interactions: {
            create: async () => {
              if (fail.Cls) throw new fail.Cls(fail.status, echo);
              return (async function* () {
                yield { event_type: "error", error: { code: "INVALID_ARGUMENT", message: echo } };
              })();
            },
          },
        };
        const logs: TtsFallbackLogEvent[] = [];
        const POST = makeSpeechHandler({
          deps: () => ({
            tts: createTtsClient({ apiKey: key, models: "gemini-3.8-flash-tts", sdk }),
            limits: okLimits,
            getShop: async () => lolaProfile,
            clock: () => NOW,
            config: DEFAULT_TTS_LIMITS,
            secret: SECRET,
            apiKey: key,
            exhausted: new Map(),
            log: (e) => logs.push(e),
          }),
          schedule: () => undefined,
          salt: () => SALT,
        });
        const res = await POST(
          new Request("http://localhost/api/speech", {
            method: "POST",
            headers: { "content-type": "application/json", "x-forwarded-for": from },
            body: JSON.stringify({ kind: "say", shopId: lolaProfile.id, language: "es", text, token }),
          }),
        );
        expect(res.status).toBe(503);
        expect(logs).toHaveLength(1);
        const line = JSON.stringify(logs[0]);
        for (const secret of [text, token, visitorKey, key, tel, tel.slice(3)]) expect(line).not.toContain(secret);
        const message = logs[0].message ?? "";
        expect(message).not.toContain(who);
        for (const word of who.split(" ")) expect(message).not.toContain(word);
        expect(message).not.toContain(speakPhone(tel, "es"));
        // The key shows only as *** (the client and the route both redact it).
        expect(message).toContain("key=***");
        // Every other field is a fixed value from the code, never something the caller said.
        const { message: _m, latencyMs, ...rest } = logs[0];
        void _m;
        expect(latencyMs).toBeGreaterThanOrEqual(0);
        expect(rest).toEqual({
          event: "tts_fallback",
          source: "server",
          reason: "unavailable",
          shopId: lolaProfile.id,
          language: "es",
          fixed: cacheable,
          model: "gemini-3.8-flash-tts",
          ...(fail.Cls ? { status: fail.status, errorClass: fail.Cls.name } : { status: 400, errorClass: "StreamErrorEvent" }),
        });
      }),
      { numRuns: 200 },
    );
  });

  it("scrubMessage: none of the secrets survive, whatever surrounds them, and the result is at most 300 characters", () => {
    fc.assert(
      fc.property(
        name,
        apiKey,
        fc.string({ maxLength: 40 }),
        fc.string({ maxLength: 40 }),
        fc.string({ maxLength: 400 }),
        (who, key, before, after, noise) => {
          const text = `A nombre de ${who}, ¿vale?`;
          const out = scrubMessage(`${before}${key}${noise}${who}${after}${text}`, { apiKey: key, text });
          expect(out.length).toBeLessThanOrEqual(300);
          expect(out).not.toContain(key);
          for (const word of who.split(" ")) expect(out).not.toContain(word);
        },
      ),
      { numRuns: 500 },
    );
  });
});
