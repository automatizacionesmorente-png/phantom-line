import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { makeTurnHandler, type Issue } from "@/app/api/turn/handler";
import { TurnRequestSchema } from "@/lib/voice/turnRequest";

/**
 * S3 (Requirements 3.7, 3.11): for all JSON bodies with a key outside the
 * schema, TurnRequestSchema fails and the route answers 400 naming the key.
 * The route's deps throw if touched, so a forged body can never reach the
 * database, the model or the Conversation_Core.
 */
const ALLOWED = {
  start: ["kind", "shopId", "language"],
  say: ["kind", "shopId", "language", "callId", "utterance", "conversation"],
  hangup: ["kind", "shopId", "callId"],
} as const;

const arbLang = fc.constantFrom("es", "en");
const arbLine = fc.record({ caller: fc.string({ maxLength: 40 }), receptionist: fc.string({ maxLength: 40 }) });
const arbShopId = fc.string({ minLength: 1, maxLength: 100 });
const arbValidBody = fc.oneof(
  fc.record({ kind: fc.constant("start" as const), shopId: arbShopId, language: arbLang }),
  fc.record({
    kind: fc.constant("say" as const),
    shopId: arbShopId,
    language: arbLang,
    callId: fc.uuid({ version: 4 }),
    utterance: fc.string({ minLength: 1, maxLength: 80 }).filter((s) => s.trim().length > 0),
    conversation: fc.array(arbLine, { maxLength: 5 }),
  }),
  fc.record({ kind: fc.constant("hangup" as const), shopId: arbShopId, callId: fc.uuid({ version: 4 }) }),
);
/** The facts a tampered client would try to send, plus any other key, including other kinds' keys. */
const arbExtraKey = fc.oneof(
  fc.constantFrom(
    "fields",
    "accepted",
    "bookingId",
    "state",
    "stage",
    "pending",
    "serviceId",
    "start",
    "resourceId",
    "name",
    "phone",
    "complete",
    "callerConfirmed",
    "callId",
    "utterance",
    "conversation",
    "language",
    "__proto__",
    "constructor",
  ),
  fc.string({ minLength: 1, maxLength: 20 }),
);
const arbValue = fc.oneof(fc.boolean(), fc.string(), fc.integer(), fc.constant(null), fc.dictionary(fc.string(), fc.string()));

/** A valid body with one or more extra keys; built with fromEntries so "__proto__" is an own key. */
const arbForged = arbValidBody.chain((body) =>
  fc
    .uniqueArray(arbExtraKey.filter((k) => !(ALLOWED[body.kind] as readonly string[]).includes(k)), { minLength: 1, maxLength: 3 })
    .chain((keys) =>
      fc.tuple(...keys.map(() => arbValue)).map((values) => ({
        body,
        keys,
        json: JSON.stringify(Object.fromEntries([...Object.entries(body), ...keys.map((k, i) => [k, values[i]])])),
      })),
    ),
);

const untouchable = () => {
  throw new Error("deps must not be used for an invalid body");
};
const POST = makeTurnHandler({ deps: untouchable, schedule: untouchable, salt: () => "s" });

describe("S3: a body with a key outside the schema is rejected", () => {
  it("the unmodified valid bodies pass (so the property tests the extra key, not a broken generator)", () => {
    fc.assert(fc.property(arbValidBody, (body) => TurnRequestSchema.safeParse(body).success), { numRuns: 200 });
  });

  it("TurnRequestSchema fails and the route returns 400 listing every extra key", async () => {
    await fc.assert(
      fc.asyncProperty(arbForged, async ({ keys, json }) => {
        expect(TurnRequestSchema.safeParse(JSON.parse(json)).success).toBe(false);
        const res = await POST(
          new Request("http://localhost/api/turn", { method: "POST", headers: { "content-type": "application/json" }, body: json }),
        );
        expect(res.status).toBe(400);
        const out = (await res.json()) as { error: string; issues: Issue[] };
        expect(out.error).toBe("invalid_request");
        const listed = out.issues.flatMap((i) => i.keys ?? []);
        for (const k of keys) expect(listed).toContain(k);
      }),
      { numRuns: 200 },
    );
  });

  it("the forged body of the design, accepted: true, gets a 400 naming 'accepted'", async () => {
    const res = await POST(
      new Request("http://localhost/api/turn", {
        method: "POST",
        body: JSON.stringify({ kind: "start", shopId: "peluqueria-lola", language: "es", accepted: true }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "invalid_request",
      issues: [{ path: "", message: expect.any(String), keys: ["accepted"] }],
    });
  });
});
