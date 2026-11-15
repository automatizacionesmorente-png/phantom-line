import { describe, expect, it } from "vitest";
import { pickVoice, voiceRank, type VoiceLike } from "@/lib/voice/speechPort";

/**
 * natural-voice 10.2 (Requirement 4.2). The lists below are the shape of `speechSynthesis.getVoices()`
 * in Chrome on each platform: names, locales and `localService` as Chrome reports them, in
 * Chrome's order (local system voices first, then Google's network voices). They were written
 * from the platforms' known voice sets, not captured from a device in this session; task 12.1
 * checks the pick on real devices.
 */
const v = (name: string, lang: string, localService = true): VoiceLike => ({ name, lang, localService });

const CHROME_MACOS: VoiceLike[] = [
  v("Eddy (español (España))", "es-ES"),
  v("Flo (español (España))", "es-ES"),
  v("Mónica", "es-ES"),
  v("Paulina", "es-MX"),
  v("Samantha", "en-US"),
  v("Fred", "en-US"),
  v("Daniel", "en-GB"),
  v("Google español", "es-ES", false),
  v("Google español de Estados Unidos", "es-US", false),
  v("Google US English", "en-US", false),
  v("Google UK English Female", "en-GB", false),
];

const CHROME_MACOS_ENHANCED: VoiceLike[] = [
  v("Eddy (español (España))", "es-ES"),
  v("Mónica (Enhanced)", "es-ES"),
  v("Samantha (Enhanced)", "en-US"),
  v("Google español", "es-ES", false),
  v("Google US English", "en-US", false),
];

const CHROME_WINDOWS: VoiceLike[] = [
  v("Microsoft Helena - Spanish (Spain)", "es-ES"),
  v("Microsoft Laura - Spanish (Spain)", "es-ES"),
  v("Microsoft Pablo - Spanish (Spain)", "es-ES"),
  v("Microsoft David - English (United States)", "en-US"),
  v("Microsoft Zira - English (United States)", "en-US"),
  v("Google español", "es-ES", false),
  v("Google US English", "en-US", false),
];

/** Edge on Windows lists Microsoft's online natural voices too; they beat Google's. */
const EDGE_WINDOWS: VoiceLike[] = [
  v("Microsoft Helena - Spanish (Spain)", "es-ES"),
  v("Microsoft Elvira Online (Natural) - Spanish (Spain)", "es-ES", false),
  v("Microsoft Aria Online (Natural) - English (United States)", "en-US", false),
];

/** Chrome on Android reports the Google speech engine's voices by id, local and network. */
const CHROME_ANDROID: VoiceLike[] = [
  v("es-es-x-eea-local", "es-ES"),
  v("es-es-x-eed-local", "es-ES"),
  v("es-es-x-eea-network", "es-ES", false),
  v("en-us-x-sfg-local", "en-US"),
  v("en-us-x-iol-network", "en-US", false),
  v("es-us-x-esc-network", "es-US", false),
];

describe("pickVoice ranks natural voices, then Google, then network, then the first", () => {
  it("Chrome on macOS: Google's network voice over the novelty voice Chrome lists first", () => {
    expect(pickVoice(CHROME_MACOS, "es")?.name).toBe("Google español");
    expect(pickVoice(CHROME_MACOS, "en")?.name).toBe("Google US English");
  });

  it("Chrome on macOS with downloaded enhanced voices: the enhanced voice wins", () => {
    expect(pickVoice(CHROME_MACOS_ENHANCED, "es")?.name).toBe("Mónica (Enhanced)");
    expect(pickVoice(CHROME_MACOS_ENHANCED, "en")?.name).toBe("Samantha (Enhanced)");
  });

  it("Chrome on Windows: Google's voice over Microsoft's local voices", () => {
    expect(pickVoice(CHROME_WINDOWS, "es")?.name).toBe("Google español");
    expect(pickVoice(CHROME_WINDOWS, "en")?.name).toBe("Google US English");
  });

  it("Edge on Windows: the online natural voice", () => {
    expect(pickVoice(EDGE_WINDOWS, "es")?.name).toBe("Microsoft Elvira Online (Natural) - Spanish (Spain)");
    expect(pickVoice(EDGE_WINDOWS, "en")?.name).toBe("Microsoft Aria Online (Natural) - English (United States)");
  });

  it("Chrome on Android: the network voice of the exact locale", () => {
    expect(pickVoice(CHROME_ANDROID, "es")?.name).toBe("es-es-x-eea-network");
    expect(pickVoice(CHROME_ANDROID, "en")?.name).toBe("en-us-x-iol-network");
  });

  it("the exact locale comes before a better voice of another locale", () => {
    expect(pickVoice([v("Mónica", "es-ES"), v("Google español de Estados Unidos", "es-US", false)], "es")?.name).toBe("Mónica");
  });

  it("with no marked voice, the first voice for the locale; with no voice for the locale, the best of the language", () => {
    expect(pickVoice([v("Mónica", "es-ES"), v("Jorge", "es-ES")], "es")?.name).toBe("Mónica");
    expect(pickVoice([v("Paulina", "es-MX"), v("Google español de Estados Unidos", "es_US", false)], "es")?.name).toBe(
      "Google español de Estados Unidos",
    );
    expect(pickVoice([v("Samantha", "en-US")], "es")).toBeNull();
  });

  it("voiceRank: natural 0, Google 1, network 2, other 3; a voice without localService is not taken for a network voice", () => {
    expect(voiceRank(v("Microsoft Elvira Online (Natural)", "es-ES", false))).toBe(0);
    expect(voiceRank(v("Siri Voice 2 (Premium)", "es-ES"))).toBe(0);
    expect(voiceRank(v("Google español", "es-ES", false))).toBe(1);
    expect(voiceRank(v("es-es-x-eea-network", "es-ES", false))).toBe(2);
    expect(voiceRank({ name: "Mónica", lang: "es-ES" })).toBe(3);
  });
});
