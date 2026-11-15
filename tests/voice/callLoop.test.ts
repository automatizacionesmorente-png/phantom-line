import { describe, expect, it } from "vitest";
import { callLoop, canType, canTypeInstead, initialCallLoop, type CallEffect } from "@/lib/voice/callLoop";
import { createFakeSpeechPort, createTypedOnlyPort } from "@/lib/voice/speechPort";
import { CALL_ID, createHarness, effectsOf, reply, scriptedServer } from "./harness";

const GREETING =
  "¡Hola! Estás llamando a Peluquería Lola, soy su asistente virtual. ¿En qué te puedo ayudar?";
const final = (text: string) => ({ type: "final" as const, text });

describe("callLoop: a complete voice call", () => {
  it("greets, listens only after each reply is spoken, sends every line with its context, and ends on complete", async () => {
    const port = createFakeSpeechPort({
      listens: [
        final("quiero cortarme el pelo mañana a las nueve de la noche"),
        final("vale, a las siete y media"),
        final("Ana"),
        final("612 345 678"),
        final("sí"),
      ],
    });
    const server = scriptedServer([
      reply(GREETING),
      reply("A las 21:00 no es posible. Tengo libre a las 19:30, 19:15 o 19:00."),
      reply("Perfecto. ¿A nombre de quién?"),
      reply("Gracias, Ana. ¿Me dices tu teléfono?"),
      reply("Te leo la cita: corte el jueves 12 a las 19:30. ¿Te la confirmo?"),
      reply("Te queda la cita de corte el jueves 12 a las 19:30. Lola verá tu mensaje y te confirma.", { complete: true }),
    ]);
    const h = createHarness({ port, server });

    expect(h.state.phase).toBe("idle");
    h.dispatch({ type: "PRESS_CALL" });
    expect(h.state.phase).toBe("starting");
    await h.settle();

    expect(h.state.phase).toBe("ended");
    expect(h.state.endReason).toBe("complete");
    expect(h.state.outcome).toBe("booked");
    expect(server.bodies.map((b) => b.kind)).toEqual(["start", "say", "say", "say", "say", "say"]);

    // Every reply was spoken in Spanish, the goodbye included.
    expect(port.spoken.map((s) => s.text)).toEqual([GREETING, ...h.state.conversation.map((l) => l.receptionist)]);
    expect(port.spoken.every((s) => s.lang === "es")).toBe(true);

    // Recognition starts only after speaking ends (2.9): speak and listen alternate, and nothing listens after the goodbye.
    const voice = h.log.filter((l) => l.effect.type === "speak" || l.effect.type === "listen").map((l) => l.effect.type);
    expect(voice).toEqual(["speak", "listen", "speak", "listen", "speak", "listen", "speak", "listen", "speak", "listen", "speak"]);
    for (const l of h.log.filter((x) => x.effect.type === "listen")) {
      expect(h.events[l.step - 1].type).toBe("SPOKEN");
    }

    // The conversation sent as context grows by one completed Turn each time.
    const says = server.bodies.filter((b) => b.kind === "say");
    expect(says.map((b) => b.conversation.length)).toEqual([0, 1, 2, 3, 4]);
    expect(says[1].conversation[0]).toEqual({
      caller: "quiero cortarme el pelo mañana a las nueve de la noche",
      receptionist: "A las 21:00 no es posible. Tengo libre a las 19:30, 19:15 o 19:00.",
    });
    expect(says.every((b) => b.callId === CALL_ID && b.language === "es")).toBe(true);

    // Transcript: greeting, then each caller line followed by its reply (1.5).
    expect(h.state.transcript.slice(0, 3)).toEqual([
      { who: "receptionist", text: GREETING },
      { who: "caller", text: "quiero cortarme el pelo mañana a las nueve de la noche" },
      { who: "receptionist", text: "A las 21:00 no es posible. Tengo libre a las 19:30, 19:15 o 19:00." },
    ]);
    expect(h.beacons).toEqual([]);
  });
});

describe("callLoop: speech failures never end the Call (2.8, 2.12)", () => {
  it("not-allowed mid-call switches to Typed_Mode in the same Call, and the booking finishes by typing", async () => {
    const port = createFakeSpeechPort({ listens: [final("quiero un corte"), { type: "error", kind: "not-allowed" }] });
    const server = scriptedServer([
      reply(GREETING),
      reply("¿Qué día y a qué hora te viene bien?"),
      reply("Te queda la cita. Lola verá tu mensaje y te confirma.", { complete: true }),
    ]);
    const h = createHarness({ port, server });
    h.dispatch({ type: "PRESS_CALL" });
    await h.settle();

    expect(h.state.phase).toBe("typing");
    expect(h.state.typed).toBe(true);
    expect(h.state.recognition).toBe(false);
    expect(h.state.callId).toBe(CALL_ID);
    expect(h.state.transcript.at(-1)).toEqual({ who: "notice", key: "typeInstead" });
    expect(canType(h.state)).toBe(true);
    expect(effectsOf(h, "focusInput")).toHaveLength(1);

    h.dispatch({ type: "TYPED", text: "  el jueves a las 19:30  " });
    expect(h.state.phase).toBe("thinking");
    await h.settle();

    const last = server.bodies.at(-1)!;
    expect(last).toMatchObject({ kind: "say", callId: CALL_ID, utterance: "el jueves a las 19:30" });
    expect(h.state.phase).toBe("ended");
    expect(h.state.endReason).toBe("complete");
    // Replies are still spoken in Typed_Mode while synthesis works; recognition never restarts.
    expect(port.spoken).toHaveLength(3);
    expect(port.listened).toHaveLength(2);
    expect(h.beacons).toEqual([]);
  });

  it.each(["service-not-allowed", "audio-capture", "network", "language-not-supported", "unavailable"] as const)(
    "%s while listening also switches to Typed_Mode without ending",
    (kind) => {
      const s0 = { ...initialCallLoop({ shopId: "s", lang: "es", recognition: true, synthesis: true }), phase: "listening" as const, callId: CALL_ID };
      const [s1, fx] = callLoop(s0, { type: "SPEECH_ERROR", kind });
      expect(s1.phase).toBe("typing");
      expect(s1.typed).toBe(true);
      expect(fx).toEqual([{ type: "focusInput" }]);
    },
  );

  it("no recognition from the start: Typed_Mode from the first reply, the greeting still spoken, never listens", async () => {
    const port = createFakeSpeechPort({ supports: { recognition: false, synthesis: true } });
    const server = scriptedServer([reply(GREETING), reply("¿Qué día te viene bien?")]);
    const h = createHarness({ port, server });
    expect(h.state.typed).toBe(true);
    expect(canTypeInstead(h.state)).toBe(true);

    h.dispatch({ type: "PRESS_CALL" });
    await h.settle();
    expect(h.state.phase).toBe("typing");
    expect(port.spoken.map((s) => s.text)).toEqual([GREETING]);

    h.dispatch({ type: "TYPED", text: "quiero un corte" });
    await h.settle();
    expect(h.state.phase).toBe("typing");
    expect(port.listened).toEqual([]);
    expect(effectsOf(h, "listen")).toEqual([]);
    // No notice: nothing failed, the caller simply types.
    expect(h.state.transcript.some((e) => e.who === "notice")).toBe(false);
  });

  it("the typed-only port (no Web Speech at all): replies are shown only and the Call goes on", async () => {
    const port = createTypedOnlyPort();
    const server = scriptedServer([reply(GREETING), reply("¿Qué día te viene bien?")]);
    const h = createHarness({ port, server });
    h.dispatch({ type: "PRESS_CALL" });
    await h.settle();
    expect(h.state.phase).toBe("typing");
    expect(effectsOf(h, "speak")).toEqual([]);
    expect(h.state.transcript).toEqual([{ who: "receptionist", text: GREETING }]);
    h.dispatch({ type: "TYPED", text: "un corte" });
    await h.settle();
    expect(h.state.phase).toBe("typing");
    expect(h.state.transcript.at(-1)).toEqual({ who: "receptionist", text: "¿Qué día te viene bien?" });
  });

  it("no synthesis voice: the reply is shown only, then listening starts again; later replies in that language are not spoken", async () => {
    const port = createFakeSpeechPort({
      speaks: [{ type: "error", kind: "synthesis-unavailable" }],
      listens: [final("quiero un corte")],
    });
    const server = scriptedServer([reply(GREETING), reply("¿Qué día te viene bien?")]);
    const h = createHarness({ port, server });
    h.dispatch({ type: "PRESS_CALL" });
    await h.settle();

    expect(port.spoken).toHaveLength(1); // only the attempt for the greeting
    expect(h.state.mutedLangs).toEqual(["es"]);
    expect(h.state.transcript.map((e) => (e.who === "notice" ? e.key : e.text))).toEqual([
      GREETING,
      "quiero un corte",
      "¿Qué día te viene bien?",
    ]);
    // After each shown-only reply, recognition restarted at once.
    expect(port.listened).toEqual(["es", "es"]);
    expect(h.state.phase).toBe("listening");
  });

  it("two no-speech errors in a row show the hint to type and keep listening; a recognized line resets it", async () => {
    const port = createFakeSpeechPort({
      listens: [{ type: "error", kind: "no-speech" }, { type: "error", kind: "no-speech" }],
    });
    const server = scriptedServer([reply(GREETING)]);
    const h = createHarness({ port, server });
    h.dispatch({ type: "PRESS_CALL" });
    await h.settle();

    expect(h.state.phase).toBe("listening");
    expect(h.state.noSpeechStreak).toBe(2);
    expect(h.state.showTypeHint).toBe(true);
    expect(h.state.typed).toBe(false);
    expect(port.listened).toEqual(["es", "es", "es"]);

    const s0 = { ...h.state, noSpeechStreak: 0, showTypeHint: false };
    const [s1] = callLoop(s0, { type: "SPEECH_ERROR", kind: "no-speech" });
    expect(s1.showTypeHint).toBe(false);
    const [s2] = callLoop(s1, { type: "RECOGNIZED", text: "hola" });
    expect(s2.noSpeechStreak).toBe(0);
  });

  it("aborted (our own stop) is ignored", () => {
    const s0 = { ...initialCallLoop({ shopId: "s", lang: "es", recognition: true, synthesis: true }), phase: "listening" as const, callId: CALL_ID };
    expect(callLoop(s0, { type: "SPEECH_ERROR", kind: "aborted" })).toEqual([s0, []]);
  });
});

describe("callLoop: language switch (2.7)", () => {
  it("switching while listening restarts recognition in the new language; the next Turn is sent in it", async () => {
    const port = createFakeSpeechPort({ listens: [{ type: "error", kind: "aborted" }] });
    const server = scriptedServer([reply(GREETING), reply("Sure, what would you like?", { language: "en" })]);
    const h = createHarness({ port, server });
    h.dispatch({ type: "PRESS_CALL" });
    await h.settle();
    expect(h.state.phase).toBe("listening");

    h.dispatch({ type: "SWITCH_LANG", lang: "en" });
    expect(h.state.lang).toBe("en");
    expect(h.log.at(-1)!.effect).toEqual({ type: "listen", lang: "en" });
    expect(port.listened).toEqual(["es", "en"]);

    h.dispatch({ type: "RECOGNIZED", text: "I'd like a haircut" });
    await h.settle();
    expect(server.bodies.at(-1)).toMatchObject({ kind: "say", language: "en" });
    expect(port.spoken.at(-1)).toEqual({ text: "Sure, what would you like?", lang: "en" });
    expect(port.listened.at(-1)).toBe("en");
  });

  it("a reply in the other language (the caller asked the receptionist) moves the switch and the next listen", async () => {
    const port = createFakeSpeechPort({ listens: [final("can we speak English?")] });
    const server = scriptedServer([reply(GREETING), reply("Of course. How can I help?", { language: "en" })]);
    const h = createHarness({ port, server });
    h.dispatch({ type: "PRESS_CALL" });
    await h.settle();
    expect(h.state.lang).toBe("en");
    expect(port.spoken.at(-1)!.lang).toBe("en");
    expect(port.listened).toEqual(["es", "en"]);
  });

  it("switching while speaking or thinking does not start recognition early", () => {
    const base = { ...initialCallLoop({ shopId: "s", lang: "es", recognition: true, synthesis: true }), callId: CALL_ID };
    for (const phase of ["speaking", "thinking", "starting", "idle"] as const) {
      const [s, fx] = callLoop({ ...base, phase }, { type: "SWITCH_LANG", lang: "en" });
      expect(s.lang).toBe("en");
      expect(s.phase).toBe(phase);
      expect(fx).toEqual([]);
    }
  });
});

describe("callLoop: type instead (2.11)", () => {
  it("while listening, stops recognition and opens the text field without ending the Call", () => {
    const s0 = { ...initialCallLoop({ shopId: "s", lang: "es", recognition: true, synthesis: true }), phase: "listening" as const, callId: CALL_ID };
    const [s1, fx] = callLoop(s0, { type: "TYPE_INSTEAD" });
    expect(s1.phase).toBe("typing");
    expect(s1.typed).toBe(true);
    expect(fx).toEqual<CallEffect[]>([{ type: "stopSpeech" }, { type: "focusInput" }]);
  });

  it("while the receptionist speaks, the reply finishes and then the text field opens instead of the microphone", () => {
    const s0 = { ...initialCallLoop({ shopId: "s", lang: "es", recognition: true, synthesis: true }), phase: "speaking" as const, callId: CALL_ID };
    const [s1, fx1] = callLoop(s0, { type: "TYPE_INSTEAD" });
    expect(s1.phase).toBe("speaking");
    expect(fx1).toEqual([]);
    const [s2, fx2] = callLoop(s1, { type: "SPOKEN" });
    expect(s2.phase).toBe("typing");
    expect(fx2).toEqual([{ type: "focusInput" }]);
  });
});

describe("callLoop: the client timeout (2.10) and hang-ups", () => {
  it("a Turn that takes longer than 15 s ends the Call with the line-cut notice and sends the hang-up beacon", async () => {
    const port = createFakeSpeechPort({ listens: [final("quiero un corte")] });
    const server = scriptedServer([reply(GREETING), "timeout"]);
    const h = createHarness({ port, server });
    h.dispatch({ type: "PRESS_CALL" });
    await h.settle();

    expect(h.state.phase).toBe("ended");
    expect(h.state.endReason).toBe("timeout");
    expect(h.state.transcript.at(-1)).toEqual({ who: "notice", key: "lineCut" });
    expect(h.beacons).toEqual([{ kind: "hangup", shopId: "peluqueria-lola", callId: CALL_ID }]);
    expect(port.stops).toBe(1);
    // Nothing restarts after the end.
    expect(port.listened).toEqual(["es"]);
    expect(canTypeInstead(h.state)).toBe(false);
    expect(callLoop(h.state, { type: "RECOGNIZED", text: "¿hola?" })).toEqual([h.state, []]);
  });

  it("a timeout on start has no callId to send; the late reply then gets its beacon", () => {
    const s0 = initialCallLoop({ shopId: "peluqueria-lola", lang: "es", recognition: true, synthesis: true });
    const [s1] = callLoop(s0, { type: "PRESS_CALL" });
    const [s2, fx2] = callLoop(s1, { type: "CLIENT_TIMEOUT" });
    expect(s2.phase).toBe("ended");
    expect(fx2).toEqual([{ type: "stopSpeech" }]);
    const [s3, fx3] = callLoop(s2, { type: "REPLY", out: reply(GREETING) });
    expect(s3.phase).toBe("ended");
    expect(fx3).toEqual([{ type: "beaconHangup", body: { kind: "hangup", shopId: "peluqueria-lola", callId: CALL_ID } }]);
    // A second late event sends nothing more.
    expect(callLoop(s3, { type: "REPLY", out: reply(GREETING) })[1]).toEqual([]);
  });

  it("a stale timer while listening is ignored", () => {
    const s0 = { ...initialCallLoop({ shopId: "s", lang: "es", recognition: true, synthesis: true }), phase: "listening" as const, callId: CALL_ID };
    expect(callLoop(s0, { type: "CLIENT_TIMEOUT" })).toEqual([s0, []]);
  });

  it("the hang-up button mid-call stops speech and sends the beacon once", async () => {
    const port = createFakeSpeechPort();
    const server = scriptedServer([reply(GREETING)]);
    const h = createHarness({ port, server });
    h.dispatch({ type: "PRESS_CALL" });
    await h.settle();
    expect(h.state.phase).toBe("listening");
    h.dispatch({ type: "HANG_UP" });
    h.dispatch({ type: "HANG_UP" });
    expect(h.state.phase).toBe("ended");
    expect(h.state.endReason).toBe("hangup");
    expect(h.beacons).toHaveLength(1);
    expect(port.stops).toBe(1);
  });

  it("a rate-limited start (complete on the first reply) ends without a beacon", async () => {
    const port = createFakeSpeechPort();
    const server = scriptedServer([reply("Ahora mismo hay muchas llamadas, vuelve a intentarlo en unos minutos.", { complete: true, outcome: "fallback" })]);
    const h = createHarness({ port, server });
    h.dispatch({ type: "PRESS_CALL" });
    await h.settle();
    expect(h.state.phase).toBe("ended");
    expect(h.state.endReason).toBe("complete");
    expect(h.beacons).toEqual([]);
    expect(port.listened).toEqual([]);
  });
});

describe("callLoop: the speech hint (natural-voice 10.6)", () => {
  const live = { kind: "live" as const, token: "exp.flag.mac-of-the-reply", rate: 1.1 };
  const cached = { kind: "cached" as const, url: "/api/voice/0123456789abcdef0123456789abcdef", rate: 1.1 };

  it("the speak effect carries the reply's hint with its rate, and the transcript has the reply in the same step", () => {
    const s0 = initialCallLoop({ shopId: "peluqueria-lola", lang: "es", recognition: true, synthesis: true });
    const [s1] = callLoop(s0, { type: "PRESS_CALL" });
    const [s2, effects] = callLoop(s1, { type: "REPLY", out: { ...reply(GREETING), speech: cached } });
    expect(effects).toEqual([{ type: "speak", text: GREETING, lang: "es", speech: cached }]);
    expect(s2.phase).toBe("speaking");
    expect(s2.transcript).toEqual([{ who: "receptionist", text: GREETING }]);

    const [s3] = callLoop(s2, { type: "SPOKEN" });
    const [s4] = callLoop(s3, { type: "RECOGNIZED", text: "quiero un corte" });
    const [, more] = callLoop(s4, { type: "REPLY", out: { ...reply("¿Para qué día?"), speech: live } });
    expect(more).toEqual([{ type: "speak", text: "¿Para qué día?", lang: "es", speech: live }]);
  });

  it("a reply without a hint asks for speech without one (the browser voice speaks)", () => {
    const s0 = initialCallLoop({ shopId: "peluqueria-lola", lang: "es", recognition: true, synthesis: true });
    const [s1] = callLoop(s0, { type: "PRESS_CALL" });
    const [, effects] = callLoop(s1, { type: "REPLY", out: reply(GREETING) });
    expect(effects).toEqual([{ type: "speak", text: GREETING, lang: "es" }]);
    expect("speech" in effects[0]).toBe(false);
  });

  it("the port receives the hint, and listening starts only after it resolves", async () => {
    const port = createFakeSpeechPort();
    const h = createHarness({ port, server: scriptedServer([{ ...reply(GREETING), speech: cached }]) });
    h.dispatch({ type: "PRESS_CALL" });
    await h.settle();
    expect(port.spoken).toEqual([{ text: GREETING, lang: "es", hint: cached }]);
    const kinds = h.log.map((l) => l.effect.type);
    expect(kinds.indexOf("listen")).toBeGreaterThan(kinds.indexOf("speak"));
  });

  it("in Typed_Mode with synthesis, the hint is still passed: the neural voice reads the reply aloud", () => {
    const s0 = initialCallLoop({ shopId: "peluqueria-lola", lang: "es", recognition: false, synthesis: true });
    const [s1] = callLoop(s0, { type: "PRESS_CALL" });
    const [, effects] = callLoop(s1, { type: "REPLY", out: { ...reply(GREETING), speech: live } });
    expect(effects[0]).toEqual({ type: "speak", text: GREETING, lang: "es", speech: live });
  });
});
