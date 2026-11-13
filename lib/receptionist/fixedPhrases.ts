import type { Temporal } from "temporal-polyfill";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import type { Lang, SectorPack } from "@/lib/sectors";
import { phrases, type PhraseSet, type Said } from "./phrases";
import { spokenTemplate } from "./speech";
import type { VariantSeed } from "./variants";

/**
 * The lines of a shop that never depend on the caller, in every Phrase_Variant (natural-voice
 * design.md, "The voice cache", tier 1): the greeting, the asks without caller data, the closings
 * and the fallbacks. Requirement 2's Fixed_Phrases (the greeting, the end and retry
 * Fallback_Messages, the Typed_Mode notice and the rate-limited-start line) are all here. Pure.
 */

/** A PhraseSet method that returns a spoken line. */
export type TemplateName = Exclude<keyof PhraseSet, "owner">;

/** Every way a template was rendered: the inputs `phrases()` got, and the text a Call will speak. */
export interface RenderedLine {
  template: TemplateName;
  text: string;
  inputs: { now: Temporal.Instant; seed: VariantSeed; args: readonly unknown[] };
}

/** The template methods that take no argument and say nothing about the caller. */
export const FIXED_TEMPLATES = [
  "greeting",
  "askDayAndTime",
  "askName",
  "askNameAgain",
  "askPhone",
  "dontKnow",
  "goodbye",
  "maxTurns",
  "fallbackEnd",
  "fallbackRetry",
  "rateLimitedStart",
  "lineCut",
  "typeInstead",
  "cancelled",
  "bookingNotFound",
] as const satisfies readonly TemplateName[];

/** Arguments for the fixed templates that take one: `askDayAndTime(null)` is the ask with no day. */
const FIXED_ARGS: Partial<Record<TemplateName, readonly unknown[]>> = { askDayAndTime: [null] };

/**
 * The Call id the plan renders with. Only the Variant_Seed's choice matters: the variant of a
 * template depends on the seed and the template, never on its arguments.
 */
export const PLAN_CALL_ID = "voice-cache-plan";
/** Seeds tried to find every variant of a template; the templates have 1 or 2. */
export const VARIANT_PROBES = 32;

type Render = (template: TemplateName, args: readonly unknown[], seed: VariantSeed) => Said;

/** Renders through the real `phrases()` and the same spoken pass as `handleTurn`. */
export function renderer(shop: ShopProfile, pack: SectorPack, lang: Lang, now: Temporal.Instant): Render {
  return (template, args, seed) => {
    const P = phrases(lang, pack, shop, seed, now);
    const fn = P[template] as (...a: readonly unknown[]) => Said;
    const said = fn(...args);
    return { text: spokenTemplate(said.text, lang), cacheable: said.cacheable };
  };
}

/**
 * Finds, once per template, a seed for each of its variants. A template's variant depends only on
 * the seed and the template's key, so the same seeds reach every variant for any arguments.
 */
export class VariantSeeds {
  private readonly found = new Map<TemplateName, VariantSeed[]>();

  seedsFor(template: TemplateName, probe: (seed: VariantSeed) => string): VariantSeed[] {
    const known = this.found.get(template);
    if (known) return known;
    const seen = new Set<string>();
    const seeds: VariantSeed[] = [];
    for (let turn = 0; turn < VARIANT_PROBES; turn++) {
      const seed = { callId: PLAN_CALL_ID, turn };
      const text = probe(seed);
      if (!seen.has(text)) {
        seen.add(text);
        seeds.push(seed);
      }
    }
    this.found.set(template, seeds);
    return seeds;
  }
}

/** Every variant of one template with these arguments; only cacheable lines. */
export function renderAllVariants(
  render: Render,
  seeds: VariantSeeds,
  now: Temporal.Instant,
  template: TemplateName,
  args: readonly unknown[],
): RenderedLine[] {
  const out: RenderedLine[] = [];
  for (const seed of seeds.seedsFor(template, (s) => render(template, args, s).text)) {
    const said = render(template, args, seed);
    if (said.cacheable) out.push({ template, text: said.text, inputs: { now, seed, args } });
  }
  return out;
}

/** The Fixed_Phrases of a shop in one language, every variant, in a stable order. */
export function fixedPhrases(
  shop: ShopProfile,
  pack: SectorPack,
  lang: Lang,
  now: Temporal.Instant,
  seeds = new VariantSeeds(),
): RenderedLine[] {
  const render = renderer(shop, pack, lang, now);
  return FIXED_TEMPLATES.flatMap((t) => renderAllVariants(render, seeds, now, t, FIXED_ARGS[t] ?? []));
}
