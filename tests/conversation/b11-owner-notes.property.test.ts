import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import { MAX_OWNER_NOTES, type OwnerNote } from "@/lib/conversation/types";
import { lolaSeedProfile } from "@/lib/db/seed";
import { phrases } from "@/lib/receptionist/phrases";
import { spokenTemplate } from "@/lib/receptionist/speech";
import { getSectorPack, type Lang } from "@/lib/sectors";
import { arbShop, arbUtterance } from "./brain/arbShops";
import { SAT_1930 } from "./brainCall";
import { CoreCaller, coreHarness, FAILING_KINDS, switchModel } from "./coreCall";

/**
 * B11. Owner requests and unanswered questions keep the Call alive and reach the Owner
 * (front-desk-brain 10.1–10.6). Brain-only Calls (the model fails every Turn) on the Rich_Profile
 * and random shops, with 1–3 Owner_Requests, off-profile questions or Sensitive_Hits at random
 * places among everyday lines, ended by a goodbye:
 *  - each such Turn returns `complete: false` with its Keep_Alive_Line;
 *  - the Call records one Owner_Note of the matching kind per such Turn, in order (at most 5);
 *  - the Message's outcome is `message` unless a booking, reschedule or cancel was confirmed;
 *  - its reason lists the notes after the main reason, in order (cut at 160 characters, 10.7).
 * The everyday lines leave out the pool's own owner request, off-profile question and gibberish,
 * so every note comes from a line the property placed.
 */
const pack = getSectorPack("hair-salon");

type Special = "owner_request" | "unanswered" | "sensitive";
const SPECIAL: Record<Special, readonly string[]> = {
  owner_request: ["quiero hablar con la dueña", "¿puedo hablar con una persona?", "que me llame la dueña, por favor"],
  unanswered: ["¿Y qué tal es Lola cortando?", "Oye, ¿y Lola es simpática?", "¿tenéis descuento para estudiantes?"],
  sensitive: ["me ha dado alergia el tinte", "me pica muchísimo la cabeza desde ayer"],
};
const NOT_PLACED = new Set(["quiero hablar con la dueña", "¿y qué tal corta?", "patata frita", "¿hay parking?"]);

const arbCase = fc.oneof(fc.constant(lolaSeedProfile), arbShop).chain((shop: ShopProfile) =>
  fc.record({
    shop: fc.constant(shop),
    everyday: fc.array(arbUtterance(shop).filter((u) => !NOT_PLACED.has(u)), { minLength: 0, maxLength: 6 }),
    specials: fc.array(
      fc.constantFrom<Special>("owner_request", "unanswered", "sensitive").chain((kind) => fc.constantFrom(...SPECIAL[kind]).map((text) => ({ kind, text }))),
      { minLength: 1, maxLength: 3 },
    ),
    places: fc.array(fc.nat(), { minLength: 3, maxLength: 3 }),
    failure: fc.constantFrom(...FAILING_KINDS),
  }),
);

function keepAliveLines(shop: ShopProfile, callId: string, kind: Special, lang: Lang): string[] {
  const out = new Set<string>();
  for (let turn = 0; turn <= 12; turn++) {
    const p = phrases(lang, pack, shop, { callId, turn }, SAT_1930);
    const line = kind === "owner_request" ? p.ownerNoted : kind === "sensitive" ? p.sensitiveNoted : p.unknownKeepAlive;
    for (const c of [false, true]) out.add(spokenTemplate(line(c).text, lang));
  }
  return [...out];
}

/** The notes follow the main reason: the reason, cut at 160 characters, ends with them from a ". " boundary. */
function notesFollow(reason: string, notesText: string): boolean {
  const truncated = reason.endsWith("…");
  const cut = truncated ? reason.slice(0, -1) : reason;
  for (let p = 0; p <= cut.length; p++) {
    if (p > 0 && cut.slice(p - 2, p) !== ". ") continue;
    const tail = cut.slice(p);
    if (truncated ? notesText.startsWith(tail) : tail === notesText) return true;
  }
  return truncated;
}

describe("B11: owner requests and unanswered questions keep the Call alive and reach the Owner", () => {
  it("each gets its Keep_Alive_Line and its Owner_Note, and the Message lists them", { timeout: 300_000 }, async () => {
    const reached = { owner_request: 0, unanswered: 0, sensitive: 0, message: 0, booked: 0, truncated: 0, withEveryday: 0 };
    await fc.assert(
      fc.asyncProperty(arbCase, async ({ shop, everyday, specials, places, failure }) => {
        const lines: { text: string; kind: Special | null }[] = everyday.map((text) => ({ text, kind: null }));
        specials.forEach((s, k) => lines.splice(places[k] % (lines.length + 1), 0, s));
        if (everyday.length > 0) reached.withEveryday++;

        const h = coreHarness({ shops: [shop], now: SAT_1930, model: switchModel({ kind: failure }) });
        const c = new CoreCaller(h.deps, shop, "es");
        await c.start();
        const expectedNotes: OwnerNote["kind"][] = [];
        let ended: string | undefined;
        for (const line of lines) {
          const out = await c.say(line.text);
          if (line.kind) {
            expect(out.complete, line.text).toBe(false);
            // A line before may have switched the Call to English ("¿habláis inglés?"): the reply's language decides.
            const keepAlive = keepAliveLines(shop, c.callId, line.kind, out.language);
            expect(keepAlive.some((k) => out.reply.includes(k)), `${line.text} → ${out.reply}`).toBe(true);
            expectedNotes.push(line.kind);
            reached[line.kind]++;
          }
          if (out.complete) {
            ended = out.outcome;
            break;
          }
        }
        const notes = h.repo.calls()[0].state.notes ?? [];
        expect(notes.map((n) => n.kind)).toEqual(expectedNotes.slice(0, MAX_OWNER_NOTES));

        if (ended === undefined) {
          // Notes promise a call back: with no phone, the first goodbye asks for the contact (backlog 20).
          let bye = await c.say("Adiós, gracias");
          if (!bye.complete) bye = await c.say("Adiós, gracias");
          expect(bye.complete).toBe(true);
          ended = bye.outcome;
        }
        const messages = h.repo.messages();
        expect(messages).toHaveLength(1);
        const m = messages[0];
        if (ended === "booked" || ended === "rescheduled" || ended === "cancelled") {
          reached.booked++;
          expect(m.outcome).toBe(ended);
        } else {
          reached.message++;
          expect(m.outcome).toBe("message");
        }
        // The Owner reads the reason in the shop's first language, whatever language the Call ended in (backlog 21).
        const notesText = notes.map((n) => phrases(shop.languages[0], pack, shop).owner.note(n)).join(". ");
        expect(notesFollow(m.reason, notesText), `${m.reason} | ${notesText}`).toBe(true);
        if (m.reason.endsWith("…")) reached.truncated++;
      }),
      { numRuns: 100 },
    );
    for (const k of ["owner_request", "unanswered", "sensitive", "message", "withEveryday"] as const) expect(reached[k], k).toBeGreaterThan(0);
  });
});
