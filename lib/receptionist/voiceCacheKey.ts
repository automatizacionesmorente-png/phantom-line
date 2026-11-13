import { createHash } from "node:crypto";
import type { VoiceProfile } from "@/lib/sectors/types";

/**
 * The key of one stored line of Neural_Voice audio (natural-voice design.md, "The voice cache").
 * Pure and server-side (it uses node:crypto, which is deterministic). Content-addressed: the same
 * model, voice, style, language and text always give the same key, and changing any one of them
 * gives a new key, so a stale recording is never played for a new text or voice (Requirement 2.4).
 * The playback rate is not an input: it changes how the audio is played, not the audio.
 */

/** 32 lowercase hex characters: the first 128 bits of a SHA-256. */
export const CACHE_KEY_PATTERN = /^[0-9a-f]{32}$/;

export const isCacheKey = (s: string): boolean => CACHE_KEY_PATTERN.test(s);

/**
 * sha256 over the five inputs as a JSON array (not joined with "|"), so a "|" inside a style or a
 * text cannot move a field boundary and make two different inputs collide.
 */
export function cacheKey(model: string, voiceUsed: string, style: string, languageCode: string, text: string): string {
  return createHash("sha256")
    .update(JSON.stringify([model, voiceUsed, style, languageCode, text]), "utf8")
    .digest("hex")
    .slice(0, 32);
}

/** Which voice a model is sent for a profile (the TTS client's `voiceFor`). */
export type VoiceFor = (model: string, profile: VoiceProfile) => string;

/**
 * The models, in the configured order, that speak with the profile's primary `voice`. Only audio
 * made with that voice is stored or served, so a Call never switches between the chosen voice on
 * a cached line and the classic fallback voice on the next.
 */
export function primaryVoiceModels(models: readonly string[], profile: VoiceProfile, voiceFor: VoiceFor): string[] {
  return models.filter((m) => voiceFor(m, profile) === profile.voice);
}

/** The keys a line could be stored under, one per primary-voice model, in model order. */
export function lineKeys(
  text: string,
  profile: VoiceProfile,
  models: readonly string[],
  voiceFor: VoiceFor,
): { model: string; key: string }[] {
  return primaryVoiceModels(models, profile, voiceFor).map((model) => ({
    model,
    key: cacheKey(model, profile.voice, profile.style, profile.languageCode, text),
  }));
}
