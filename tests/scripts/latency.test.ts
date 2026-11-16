import { describe, expect, it } from "vitest";
import { DEMO_SHOP_ID } from "@/lib/owner/demo";
import {
  DEFAULT_SHOP_ID,
  SCRIPTED_CALLS,
  formatSummary,
  outputName,
  parseOptions,
  parseServerTiming,
  percentile,
  plan,
  playback,
  runCall,
  summarize,
  summarizeGroups,
  wavDataOffset,
  type Fetch,
  type RunDeps,
  type ScriptedCall,
} from "../../scripts/lib/latency";

/** front-desk-brain task 15.1: the Latency_Script's logic, with a fake fetch and a fake clock. */

const CALL_ID = "8f0c2b1e-7a7e-4f4f-9a51-3c2a3a8d1e10";
const RATE = 24000;
/** 100 ms of 16-bit mono PCM at 24 kHz. */
const MS100 = (RATE * 2) / 10;

/**
 * A body whose chunks arrive `delay` ms apart on the fake clock. `highWaterMark: 0` makes the
 * stream pull only when the reader asks; with the default of 1 it pulls one chunk ahead, and the
 * fake clock would move before the script has read anything.
 */
function timedBody(clock: { t: number }, chunks: { delay: number; bytes: Uint8Array }[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (i >= chunks.length) return controller.close();
        clock.t += chunks[i].delay;
        controller.enqueue(chunks[i++].bytes);
      },
    },
    { highWaterMark: 0 },
  );
}
const text = (s: string) => new TextEncoder().encode(s);
const pcm = (bytes: number) => new Uint8Array(bytes);
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
};

/** A 16-bit mono WAV header (44 bytes) for `dataBytes` of PCM. */
function wavHeader(dataBytes: number, rate = RATE): Uint8Array {
  const b = new Uint8Array(44);
  const v = new DataView(b.buffer);
  b.set(text("RIFF"), 0);
  v.setUint32(4, 36 + dataBytes, true);
  b.set(text("WAVEfmt "), 8);
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  b.set(text("data"), 36);
  v.setUint32(40, dataBytes, true);
  return b;
}

interface Seen {
  url: string;
  body: Record<string, unknown> | null;
}

/** A fake app: `route` answers each request, after `latency` ms on the fake clock. */
function fakeApp(route: (url: URL, body: Record<string, unknown> | null, clock: { t: number }) => Response) {
  const clock = { t: 0 };
  const seen: Seen[] = [];
  const fetch: Fetch = async (input, init) => {
    const url = new URL(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    seen.push({ url: url.pathname, body });
    return route(url, body, clock);
  };
  const deps = (mode: RunDeps["mode"]): RunDeps => ({
    fetch,
    clock: () => clock.t,
    base: new URL("http://localhost:3000"),
    shopId: DEFAULT_SHOP_ID,
    mode,
    gapMs: 1000,
    sleep: async (ms) => {
      clock.t += ms;
    },
  });
  return { clock, seen, deps };
}

const FAQ: ScriptedCall = SCRIPTED_CALLS.es.find((c) => c.id === "faq")!;

describe("percentile", () => {
  it("is the nearest-rank value, whatever the input order", () => {
    const values = [10, 3, 7, 1, 9, 2, 8, 4, 6, 5];
    expect(percentile(values, 50)).toBe(5);
    expect(percentile(values, 90)).toBe(9);
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 90)).toBe(42);
    expect(percentile([1, 2], 90)).toBe(2);
    expect(values).toEqual([10, 3, 7, 1, 9, 2, 8, 4, 6, 5]);
  });
  it("is null with no values, never 0", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([], 90)).toBeNull();
  });
});

describe("parseServerTiming", () => {
  it("reads the four stages, a model stage of 0 included", () => {
    expect(parseServerTiming('brain;dur=1.5, db;dur=32;desc="x", model;dur=0, total;dur=40.2')).toEqual({
      brain: 1.5,
      db: 32,
      model: 0,
      total: 40.2,
    });
  });
  it("gives null for a missing header and for a stage it does not carry", () => {
    expect(parseServerTiming(null)).toBeNull();
    expect(parseServerTiming("total;dur=12, other;dur=3, brain")).toEqual({ brain: null, db: null, model: null, total: 12 });
  });
});

describe("options", () => {
  it("refuses a remote base without --allow-remote", () => {
    expect(() => parseOptions(["--base=https://phantom-line.vercel.app"])).toThrow(/--allow-remote/);
    expect(() => parseOptions(["--base=http://192.168.1.20:3000"])).toThrow(/refusing remote base/);
    expect(parseOptions(["--base=https://phantom-line.vercel.app", "--allow-remote", "--legacy"])).toMatchObject({
      allowRemote: true,
      mode: "legacy",
    });
  });
  it("takes localhost by default, and the other options", () => {
    const o = parseOptions([]);
    expect(o.base.origin).toBe("http://localhost:3000");
    expect(o).toMatchObject({ mode: "inline", langs: ["es", "en"], turns: 0, shopId: DEMO_SHOP_ID });
    expect(parseOptions(["--base=http://127.0.0.1:3001", "--lang=en", "--turns=20"])).toMatchObject({ langs: ["en"], turns: 20 });
    expect(() => parseOptions(["--lang=fr"])).toThrow(/--lang/);
    expect(() => parseOptions(["--turns=-1"])).toThrow(/--turns/);
    expect(() => parseOptions(["--bogus"])).toThrow(/unknown argument/);
  });
  it("uses the demo shop's id by default", () => {
    expect(DEFAULT_SHOP_ID).toBe(DEMO_SHOP_ID);
  });
});

describe("plan", () => {
  it("states Turns, model calls and TTS requests per mode", () => {
    // One pass per language: 4 Calls, 8 `say` Turns (5 + 1 + 1 + 1), one of them a free question.
    expect(plan({ langs: ["es", "en"], turns: 0, mode: "legacy" })).toEqual({
      calls: 8,
      turns: 24,
      sayTurns: 16,
      maxModelCalls: 16,
      maxTtsRequests: 24,
    });
    expect(plan({ langs: ["es", "en"], turns: 0, mode: "inline" }).maxModelCalls).toBe(2);
    // 20 Turns need 3 passes of 8.
    expect(plan({ langs: ["es"], turns: 20, mode: "inline" })).toMatchObject({ calls: 12, sayTurns: 24, maxModelCalls: 3 });
  });
});

describe("playback", () => {
  it("finds the first byte, 150 ms of audio and no underrun on a steady stream", () => {
    const r = playback(
      [
        { atMs: 300, bytes: MS100 },
        { atMs: 350, bytes: MS100 },
        { atMs: 400, bytes: MS100 },
      ],
      RATE,
      150,
    );
    expect(r).toEqual({ firstAudioByteMs: 300, audio150Ms: 350, underruns: 0 });
  });
  it("counts a chunk that arrives after the audio ran out", () => {
    // Starts at 350 with 200 ms buffered (until 550); the third chunk at 700 is late.
    const arrivals = [
      { atMs: 300, bytes: MS100 },
      { atMs: 350, bytes: MS100 },
      { atMs: 700, bytes: MS100 },
    ];
    expect(playback(arrivals, RATE, 150).underruns).toBe(1);
    // With the 300 ms buffer it starts only at 700, so nothing runs dry.
    expect(playback(arrivals, RATE, 300).underruns).toBe(0);
  });
  it("has no audio for no arrivals", () => {
    expect(playback([], RATE, 150)).toEqual({ firstAudioByteMs: null, audio150Ms: null, underruns: 0 });
  });
});

describe("wavDataOffset", () => {
  it("finds the data chunk after a 44-byte header, and nothing before it arrives", () => {
    expect(wavDataOffset(wavHeader(100))).toEqual({ offset: 44, sampleRate: RATE });
    expect(wavDataOffset(wavHeader(100).subarray(0, 30))).toBeNull();
  });
});

describe("runCall, legacy mode (JSON + /api/speech)", () => {
  it("measures a Call with a cached greeting and a live reply, with no Server-Timing as n/a", async () => {
    const app = fakeApp((url, body, clock) => {
      if (url.pathname === "/api/turn" && body?.kind === "start") {
        clock.t += 80;
        return Response.json({ callId: CALL_ID, reply: "Hola", complete: false, speech: { kind: "cached", url: "/api/voice/abc?r=2", rate: 1 } });
      }
      if (url.pathname === "/api/voice/abc") {
        clock.t += 20;
        return new Response(timedBody(clock, [{ delay: 10, bytes: concat(wavHeader(2 * MS100), pcm(MS100)) }, { delay: 10, bytes: pcm(MS100) }]), {
          headers: { "content-type": "audio/wav" },
        });
      }
      if (url.pathname === "/api/turn" && body?.kind === "say") {
        clock.t += 900;
        return Response.json({ callId: CALL_ID, reply: "Sí, hay un aparcamiento.", complete: false, speech: { kind: "live", token: "tok-123456789", rate: 1 } });
      }
      if (url.pathname === "/api/speech") {
        clock.t += 400;
        return new Response(
          timedBody(clock, [
            { delay: 300, bytes: pcm(MS100) },
            { delay: 50, bytes: pcm(MS100) },
            { delay: 50, bytes: pcm(MS100) },
          ]),
          { headers: { "content-type": "audio/L16; rate=24000; channels=1" } },
        );
      }
      if (url.pathname === "/api/turn" && body?.kind === "hangup") return Response.json({ callId: CALL_ID, reply: "", complete: true });
      throw new Error(`unexpected ${url.pathname}`);
    });

    const measures = await runCall(FAQ, app.deps("legacy"));

    expect(app.seen.map((s) => `${s.url}:${String(s.body?.kind ?? "get")}`)).toEqual([
      "/api/turn:start",
      "/api/voice/abc:get",
      "/api/turn:say",
      "/api/speech:say",
      "/api/turn:hangup",
    ]);
    const say = app.seen[2].body!;
    expect(say).toEqual({ kind: "say", shopId: DEMO_SHOP_ID, language: "es", callId: CALL_ID, utterance: FAQ.turns[0].utterance, conversation: [] });
    expect(say).not.toHaveProperty("audio");
    expect(app.seen[3].body).toEqual({ kind: "say", shopId: DEMO_SHOP_ID, language: "es", text: "Sí, hay un aparcamiento.", token: "tok-123456789" });

    expect(measures).toHaveLength(2);
    const [start, reply] = measures;
    expect(start).toMatchObject({ expect: "start", status: 200, server: null, replyMs: 80, audioHeaderMs: 100, firstAudioByteMs: 110, audio150Ms: 120, audio: "cached" });
    expect(reply).toMatchObject({
      expect: "sure",
      status: 200,
      server: null,
      replyMs: 900,
      audioHeaderMs: 1300,
      firstAudioByteMs: 1600,
      audio150Ms: 1650,
      audio: "live",
      underruns: 0,
    });

    // No header means "n/a" in the summary, never 0.
    const s = summarize(measures);
    expect(s.stages.brain).toEqual({ n: 0, na: 2, p50: null, p90: null });
    expect(s.stages.total.p50).toBeNull();
    expect(s.stages.replyMs).toMatchObject({ n: 2, na: 0, p50: 80, p90: 900 });
    const table = formatSummary(summarizeGroups(measures));
    expect(table).toMatch(/^brain\s+n\/a/m);
    expect(table).toMatch(/^total\s+n\/a/m);
    expect(table).not.toMatch(/^brain\s+0/m);

    // Durations only: no utterance or reply in what the script keeps.
    const kept = JSON.stringify(measures);
    expect(kept).not.toContain("aparcamiento");
    expect(kept).not.toContain("Hola");
  });

  it("records the speech fallback and carries the conversation from Turn to Turn", async () => {
    const regression = SCRIPTED_CALLS.es.find((c) => c.id === "regression")!;
    let says = 0;
    const app = fakeApp((url, body, clock) => {
      clock.t += 50;
      if (url.pathname === "/api/speech") return Response.json({ fallback: "quota" }, { status: 429 });
      if (body?.kind === "start") return Response.json({ callId: CALL_ID, reply: "Hola", complete: false });
      says++;
      return Response.json(
        { callId: CALL_ID, reply: `r${says}`, complete: says === regression.turns.length, speech: { kind: "live", token: "tok-123456789", rate: 1 } },
        { headers: { "server-timing": "brain;dur=2, db;dur=30, model;dur=0, total;dur=35" } },
      );
    });
    const measures = await runCall(regression, app.deps("legacy"));
    expect(measures).toHaveLength(6);
    expect(measures[0]).toMatchObject({ audio: "none", fallback: "no_hint" });
    expect(measures[1]).toMatchObject({ audio: "none", fallback: "quota", server: { brain: 2, db: 30, model: 0, total: 35 } });
    const lastSay = app.seen.filter((s) => s.body?.kind === "say" && s.url === "/api/turn").at(-1)!.body!;
    expect(lastSay.conversation).toEqual(regression.turns.slice(0, 4).map((t, i) => ({ caller: t.utterance, receptionist: `r${i + 1}` })));
    // The Call ended by itself (booked), so no hang-up.
    expect(app.seen.some((s) => s.body?.kind === "hangup")).toBe(false);
    expect(summarize(measures).stages.model).toMatchObject({ n: 5, na: 1, p50: 0, p90: 0 });
    // Turns are spaced by the gap (1000 ms in this fake).
    expect(app.clock.t).toBeGreaterThanOrEqual(5 * 1000);
  });
});

describe("runCall, inline mode (the Inline_Audio stream)", () => {
  it("asks for audio inline and splits lines across chunks", async () => {
    const turnLine = `${JSON.stringify({ kind: "turn", callId: CALL_ID, reply: "Sí, hay un aparcamiento.", complete: false })}\n`;
    const audioLine = `${JSON.stringify({ kind: "audio", audio: "pcm", sampleRate: RATE })}\n`;
    const app = fakeApp((url, body, clock) => {
      if (body?.kind === "start") {
        clock.t += 60;
        return Response.json({ callId: CALL_ID, reply: "Hola", complete: false });
      }
      if (body?.kind === "say") {
        clock.t += 30;
        const split = turnLine.length + 10;
        const all = text(turnLine + audioLine);
        return new Response(
          timedBody(clock, [
            { delay: 200, bytes: all.subarray(0, split) },
            { delay: 300, bytes: concat(all.subarray(split), pcm(MS100)) },
            { delay: 40, bytes: pcm(MS100) },
            { delay: 400, bytes: pcm(MS100) },
          ]),
          { headers: { "content-type": "application/x-phantom-turn", "server-timing": "brain;dur=3, db;dur=25, model;dur=0, total;dur=31" } },
        );
      }
      return Response.json({ callId: CALL_ID, reply: "", complete: true });
    });
    const measures = await runCall(FAQ, app.deps("inline"));
    const say = app.seen.find((s) => s.body?.kind === "say")!.body!;
    expect(say.audio).toBe("inline");
    // `start` stays JSON.
    expect(app.seen[0].body).not.toHaveProperty("audio");
    expect(measures[1]).toMatchObject({
      status: 200,
      server: { brain: 3, db: 25, model: 0, total: 31 },
      replyMs: 230,
      audioHeaderMs: 530,
      firstAudioByteMs: 530,
      audio150Ms: 570,
      audio: "live",
      // Playback starts at 570 with 200 ms (until 770); the third chunk comes at 970.
      underruns: 1,
      startBufferMs: 150,
    });
  });

  it("reads a cached header and a fallback header", async () => {
    let n = 0;
    const app = fakeApp((url, body, clock) => {
      clock.t += 10;
      if (body?.kind === "start") return Response.json({ callId: CALL_ID, reply: "Hola", complete: false });
      if (url.pathname === "/api/voice/k") return new Response(concat(wavHeader(MS100), pcm(MS100)), { headers: { "content-type": "audio/wav" } });
      if (body?.kind === "hangup") return Response.json({ callId: CALL_ID, reply: "", complete: true });
      n++;
      const head = n === 1 ? { kind: "audio", audio: "cached", url: "/api/voice/k?r=2" } : { kind: "audio", audio: "none", fallback: "quota" };
      return new Response(text(`${JSON.stringify({ kind: "turn", callId: CALL_ID, reply: "x", complete: false })}\n${JSON.stringify(head)}\n`), {
        headers: { "content-type": "application/x-phantom-turn" },
      });
    });
    const call: ScriptedCall = { id: "price", lang: "en", turns: [{ utterance: "a", expect: "sure" }, { utterance: "b", expect: "sure" }] };
    const measures = await runCall(call, app.deps("inline"));
    expect(measures[1]).toMatchObject({ audio: "cached", firstAudioByteMs: expect.any(Number), server: null });
    expect(measures[2]).toMatchObject({ audio: "none", fallback: "quota", firstAudioByteMs: null, audio150Ms: null });
  });

  it("says to use --legacy when the server refuses the inline key", async () => {
    const app = fakeApp((_url, body) =>
      body?.kind === "start" ? Response.json({ callId: CALL_ID, reply: "Hola", complete: false }) : Response.json({ error: "invalid_request" }, { status: 400 }),
    );
    const measures = await runCall(FAQ, app.deps("inline"));
    expect(measures[1]).toMatchObject({ status: 400, error: expect.stringContaining("--legacy") });
    expect(summarize(measures).errors).toBe(1);
  });
});

describe("outputName", () => {
  it("labels legacy runs before and inline runs after, and never overwrites", () => {
    expect(outputName("2026-11-16", "legacy", () => false)).toBe("2026-11-16-before.json");
    expect(outputName("2026-11-16", "inline", () => false)).toBe("2026-11-16-after.json");
    const taken = new Set(["2026-11-16-before.json", "2026-11-16-before-2.json"]);
    expect(outputName("2026-11-16", "legacy", (n) => taken.has(n))).toBe("2026-11-16-before-3.json");
  });
});
