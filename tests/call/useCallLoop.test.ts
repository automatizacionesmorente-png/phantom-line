import { describe, expect, it, vi } from "vitest";
import { createCallSession, TURN_ENDPOINT, type CallSessionOptions } from "@/components/call/callSession";
import type { TurnOutput } from "@/lib/conversation/types";
import { createFakeSpeechPort, type FakeSpeechScript } from "@/lib/voice/speechPort";
import { TurnRequestSchema, type TurnRequest } from "@/lib/voice/turnRequest";

/**
 * `useCallLoop` is a thin React wrapper (useSyncExternalStore + one effect)
 * around `createCallSession`, which runs the reducer, the speech port and
 * fetch. These tests drive that session exactly as the hook does: created
 * with the shop, attached with a port and `window` (here the fake port and a
 * plain EventTarget), and dispatched to by the buttons.
 */
const CALL_ID = "4f9c2b1e-8a3d-4c6e-9b7a-1d2e3f4a5b6c";
const SHOP = "peluqueria-lola";

function out(reply: string, opts: { complete?: boolean } = {}): TurnOutput {
  const complete = opts.complete ?? false;
  return {
    callId: CALL_ID,
    reply,
    language: "es",
    state: { intent: "booking", fields: { name: null, phone: null, service: null, requestedTime: null }, complete },
    complete,
    ...(complete ? { outcome: "booked" as const } : {}),
  };
}

type Answer = TurnOutput | { status: number; body: unknown } | "hang";
interface Sent {
  body: TurnRequest;
  init: RequestInit;
  url: string;
}

/** A mocked `fetch` that answers Turn requests from a queue and records every call. */
function mockFetch(answers: Answer[]) {
  const queue = [...answers];
  const sent: Sent[] = [];
  const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as TurnRequest;
    // Every body the page sends must pass the server's strict schema.
    expect(TurnRequestSchema.safeParse(body).success).toBe(true);
    sent.push({ body, init: init ?? {}, url: String(url) });
    if (body.kind === "hangup") return Response.json(out("", { complete: true }));
    const next = queue.shift() ?? "hang";
    if (next === "hang") {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    }
    if ("status" in next) return Response.json(next.body, { status: next.status });
    return Response.json(next);
  });
  return { fn: fn as unknown as typeof fetch, sent };
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

function setup(answers: Answer[], script: FakeSpeechScript = {}, extra: Partial<CallSessionOptions> = {}) {
  const net = mockFetch(answers);
  const timeouts: { ms: number; controller: AbortController }[] = [];
  const session = createCallSession({
    shopId: SHOP,
    lang: "es",
    fetch: net.fn,
    timeoutSignal: (ms) => {
      const controller = new AbortController();
      timeouts.push({ ms, controller });
      return controller.signal;
    },
    ...extra,
  });
  const port = createFakeSpeechPort(script);
  const target = new EventTarget();
  const detach = session.attach({ port, target, lang: "es" });
  return { session, port, target, detach, net, timeouts };
}

const hangups = (sent: Sent[]) => sent.filter((s) => s.body.kind === "hangup");

describe("useCallLoop (call session)", () => {
  it("a pagehide during a Call sends `hangup` with keepalive", async () => {
    const { session, target, net } = setup([out("Hola, has llamado a Peluquería Lola. ¿En qué te ayudo?")]);
    session.dispatch({ type: "PRESS_CALL" });
    await settle();
    expect(session.getSnapshot().loop.phase).toBe("listening");

    target.dispatchEvent(new Event("pagehide"));
    await settle();

    const h = hangups(net.sent);
    expect(h).toHaveLength(1);
    expect(h[0].url).toBe(TURN_ENDPOINT);
    expect(h[0].init.method).toBe("POST");
    expect(h[0].init.keepalive).toBe(true);
    expect(h[0].body).toEqual({ kind: "hangup", shopId: SHOP, callId: CALL_ID });
    expect(session.getSnapshot().loop.phase).toBe("ended");
    expect(session.getSnapshot().loop.endReason).toBe("hangup");
  });

  it("the hang-up button sends `hangup` with keepalive and stops speech", async () => {
    const { session, port, net } = setup([out("Hola, ¿en qué te ayudo?")]);
    session.dispatch({ type: "PRESS_CALL" });
    await settle();
    const stopsBefore = port.stops;

    session.dispatch({ type: "HANG_UP" }); // what the "Colgar" button calls
    await settle();

    const h = hangups(net.sent);
    expect(h).toHaveLength(1);
    expect(h[0].init.keepalive).toBe(true);
    expect(h[0].body).toEqual({ kind: "hangup", shopId: SHOP, callId: CALL_ID });
    expect(port.stops).toBeGreaterThan(stopsBefore);
    // A second pagehide after the end sends nothing more.
    session.dispatch({ type: "HANG_UP" });
    await settle();
    expect(hangups(net.sent)).toHaveLength(1);
  });

  it("Turn requests are normal POSTs bounded by the 15-second signal, not keepalive", async () => {
    const { session, net, timeouts } = setup(
      [out("Hola, ¿en qué te ayudo?"), out("¿Para qué día?")],
      { listens: [{ type: "final", text: "Quiero cortarme el pelo" }] },
    );
    session.dispatch({ type: "PRESS_CALL" });
    await settle();

    const turns = net.sent.filter((s) => s.body.kind !== "hangup");
    expect(turns.map((s) => s.body.kind)).toEqual(["start", "say"]);
    for (const t of turns) {
      expect(t.init.keepalive).toBeUndefined();
      expect(t.init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(timeouts.map((t) => t.ms)).toEqual([15_000, 15_000]);
    expect(turns[1].body).toMatchObject({
      kind: "say",
      callId: CALL_ID,
      utterance: "Quiero cortarme el pelo",
      conversation: [],
    });
    const { loop } = session.getSnapshot();
    expect(loop.transcript.map((e) => (e.who === "notice" ? e.key : e.text))).toEqual([
      "Hola, ¿en qué te ayudo?",
      "Quiero cortarme el pelo",
      "¿Para qué día?",
    ]);
    expect(loop.conversation).toEqual([{ caller: "Quiero cortarme el pelo", receptionist: "¿Para qué día?" }]);
  });

  it("the 15-second timeout ends the Call with the line-cut notice and a keepalive `hangup`", async () => {
    const { session, net, timeouts } = setup(
      [out("Hola, ¿en qué te ayudo?"), "hang"],
      { listens: [{ type: "final", text: "Quiero una cita" }] },
    );
    session.dispatch({ type: "PRESS_CALL" });
    await settle();
    expect(session.getSnapshot().loop.phase).toBe("thinking");

    timeouts[1].controller.abort(new DOMException("timed out", "TimeoutError"));
    await settle();

    const { loop } = session.getSnapshot();
    expect(loop.phase).toBe("ended");
    expect(loop.endReason).toBe("timeout");
    expect(loop.transcript.at(-1)).toEqual({ who: "notice", key: "lineCut" });
    const h = hangups(net.sent);
    expect(h).toHaveLength(1);
    expect(h[0].init.keepalive).toBe(true);
  });

  it("an error status from the Turn_API stops the Call without an error screen", async () => {
    const { session, net } = setup(
      [out("Hola, ¿en qué te ayudo?"), { status: 503, body: { error: "unavailable", reply: "Perdona…" } }],
      { listens: [{ type: "final", text: "Hola" }] },
    );
    session.dispatch({ type: "PRESS_CALL" });
    await settle();
    expect(session.getSnapshot().loop.phase).toBe("ended");
    expect(hangups(net.sent)).toHaveLength(1);
  });

  it("a hang-up before `start` answers closes that Call with a keepalive `hangup` once it arrives", async () => {
    let answerStart: (r: Response) => void = () => {};
    const sent: { body: TurnRequest; init: RequestInit }[] = [];
    const fetchFn = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as TurnRequest;
      sent.push({ body, init: init ?? {} });
      if (body.kind === "start") return new Promise<Response>((resolve) => (answerStart = resolve));
      return Promise.resolve(Response.json(out("", { complete: true })));
    }) as unknown as typeof fetch;
    const { session, target } = setup([], {}, { fetch: fetchFn });

    session.dispatch({ type: "PRESS_CALL" });
    target.dispatchEvent(new Event("pagehide"));
    await settle();
    expect(sent.filter((s) => s.body.kind === "hangup")).toHaveLength(0); // no callId yet

    answerStart(Response.json(out("Hola")));
    await settle();
    const h = sent.filter((s) => s.body.kind === "hangup");
    expect(h).toHaveLength(1);
    expect(h[0].init.keepalive).toBe(true);
    expect(h[0].body).toEqual({ kind: "hangup", shopId: SHOP, callId: CALL_ID });
  });

  it("a pagehide before any Call sends nothing, and after detach the listener is gone", async () => {
    const { target, net, detach } = setup([out("Hola")]);
    target.dispatchEvent(new Event("pagehide"));
    await settle();
    expect(net.sent).toHaveLength(0);

    detach();
    target.dispatchEvent(new Event("pagehide"));
    await settle();
    expect(net.sent).toHaveLength(0);
  });

  it("unmounting during a Call (detach) hangs up with keepalive like closing the tab", async () => {
    const { session, net, detach } = setup([out("Hola, ¿en qué te ayudo?")]);
    session.dispatch({ type: "PRESS_CALL" });
    await settle();
    detach();
    await settle();
    const h = hangups(net.sent);
    expect(h).toHaveLength(1);
    expect(h[0].init.keepalive).toBe(true);
  });

  it("attach applies the browser language and the port's capabilities while idle", () => {
    const session = createCallSession({ shopId: SHOP, lang: "es", fetch: mockFetch([]).fn });
    // Before attach (server render and hydration): voice assumed, first shop language.
    expect(session.getSnapshot().loop).toMatchObject({ lang: "es", typed: false });
    session.attach({
      port: createFakeSpeechPort({ supports: { recognition: false, synthesis: true } }),
      target: new EventTarget(),
      lang: "en",
    });
    expect(session.getSnapshot().loop).toMatchObject({ lang: "en", typed: true, recognition: false, synthesis: true });
  });

  it("interim text is shown while listening and cleared when the line is final", async () => {
    let finish: (text: string) => void = () => {};
    const port = {
      ...createFakeSpeechPort(),
      listen: vi.fn((o: { onInterim?: (t: string) => void }) => {
        o.onInterim?.("quiero cor");
        return new Promise<{ type: "final"; text: string }>((resolve) => (finish = (text) => resolve({ type: "final", text })));
      }),
    };
    const net = mockFetch([out("Hola"), "hang"]);
    const session = createCallSession({ shopId: SHOP, lang: "es", fetch: net.fn, timeoutSignal: () => new AbortController().signal });
    session.attach({ port, target: new EventTarget(), lang: "es" });
    session.dispatch({ type: "PRESS_CALL" });
    await settle();
    expect(session.getSnapshot().interim).toBe("quiero cor");
    finish("quiero cortarme el pelo");
    await settle();
    expect(session.getSnapshot().interim).toBe("");
    expect(session.getSnapshot().loop.pending).toBe("quiero cortarme el pelo");
  });

  it("call again starts a fresh Call after the end", async () => {
    const { session } = setup([out("Hola"), out("Adiós", { complete: true })], {
      listens: [{ type: "final", text: "Nada más, gracias" }],
    });
    session.dispatch({ type: "PRESS_CALL" });
    await settle();
    expect(session.getSnapshot().loop.phase).toBe("ended");
    session.reset();
    expect(session.getSnapshot().loop).toMatchObject({ phase: "idle", callId: null, transcript: [] });
  });
});
