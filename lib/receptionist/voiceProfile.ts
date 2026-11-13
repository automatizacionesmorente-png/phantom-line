import type { ShopProfile } from "@/lib/conversation/shopProfile";
import { VoiceProfileSchema, type Lang, type SectorPack, type VoiceProfile } from "@/lib/sectors/types";

export { VoiceProfileSchema, type VoiceProfile };

/**
 * The Voice_Profile for one language: the pack's, with the shop's override on top, field by
 * field (Requirement 3.2). The language code always comes from the pack. The result is
 * validated again, so a broken override never reaches the TTS model (Requirement 3.3).
 */
export function resolveVoiceProfile(pack: SectorPack, shop: Pick<ShopProfile, "voice">, lang: Lang): VoiceProfile {
  const base = pack.voice[lang];
  const override = shop.voice?.[lang];
  return VoiceProfileSchema.parse({
    voice: override?.voice ?? base.voice,
    classicVoice: override?.classicVoice ?? base.classicVoice,
    languageCode: base.languageCode,
    style: override?.style ?? base.style,
  });
}
