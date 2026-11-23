import { vi } from "vitest";
import type { Line } from "@/lib/conversation/types";
import type { AgendaItem, PollChanged, PollUnchanged, TapeItem } from "@/lib/owner/api";
import { toGateShop, toMachineShop, type GateShop, type MachineShop } from "@/lib/owner/machineShop";
import { hairSalon } from "@/lib/sectors";
import { lolaProfile } from "../../fixtures/lola";

/** Tuesday 10 November 2026, 09:00 in Madrid. */
export const NOW = "2026-11-10T08:00:00Z";

export const demoShop: MachineShop = toMachineShop(lolaProfile, hairSalon);
export const realShop: MachineShop = { ...toMachineShop({ ...lolaProfile, id: "barberia-paco", name: "Barbería Paco" }, hairSalon) };
export const demoGate: GateShop = toGateShop(lolaProfile);
export const realGate: GateShop = toGateShop({ ...lolaProfile, id: "barberia-paco", name: "Barbería Paco" });

const chair = lolaProfile.resources[0].id;

export function tapeItem(over: Partial<TapeItem> & { id: string }): TapeItem {
  return {
    channel: "voice",
    createdAt: "2026-11-10T07:30:00Z",
    heard: false,
    callerName: "Marta",
    callerPhone: "+34600000001",
    reason: "Reacción al tinte",
    urgency: "urgent",
    urgencyBasis: { rule: "urgent_term", term: "reacción", lang: "es" },
    agreed: { stored: "Nada cerrado: reacción al tinte" },
    currentReply: "Hola Marta, soy Lola. Te llamo ahora mismo.",
    replyLang: "es",
    ownerLang: "es",
    outcome: "message",
    modelFailed: false,
    sample: null,
    ...over,
  };
}

export const TAPE: TapeItem[] = [
  tapeItem({ id: "m1" }),
  tapeItem({
    id: "m2",
    heard: true,
    callerName: "Luis (ejemplo)",
    callerPhone: "+34000000003",
    reason: "Pregunta si abrís el sábado",
    urgency: "low",
    urgencyBasis: { rule: "none" },
    agreed: { stored: "Nada cerrado: pregunta" },
    currentReply: "Hola Luis, sí abrimos el sábado.",
    outcome: "answered",
    sample: "question",
    createdAt: "2026-11-10T07:00:00Z",
  }),
];

export function agendaItem(over: Partial<AgendaItem> & { id: string; start: string }): AgendaItem {
  return {
    revision: 0,
    resourceId: chair,
    serviceId: "haircut",
    end: over.start,
    status: "booked",
    cancelledBy: null,
    customerName: "Ana",
    channel: "voice", source: "receptionist", state: "pending", paidCents: null, priceCents: null, visitNote: "",
    actions: ["confirm", "move", "cancel"],
    lastOwnerAction: null,
    ...over,
  };
}

const DAYS = ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17"];

export const initialPoll = (tape: TapeItem[] = TAPE, version = 10): PollChanged => ({
  changed: true,
  version,
  counts: { new: tape.length, unheard: tape.filter((t) => !t.heard).length },
  now: NOW,
  tape,
  agenda: DAYS.map((date) => ({
    date,
    items:
      date === "2026-11-10"
        ? [agendaItem({ id: "b1", start: "2026-11-10T15:00:00Z", end: "2026-11-10T15:30:00Z" })]
        : date === "2026-11-11"
          ? [
              agendaItem({
                id: "b2",
                start: "2026-11-11T10:00:00Z",
                end: "2026-11-11T10:30:00Z",
                customerName: "Pedro",
                status: "confirmed",
                actions: ["move", "cancel"],
              }),
            ]
          : [],
  })),
});

export const unchangedPoll = (p: PollChanged): PollUnchanged => ({ changed: false, version: p.version, counts: p.counts });

export const TRANSCRIPT: Line[] = [
  { caller: "", receptionist: "¡Hola! Estás llamando a Peluquería Lola, soy su asistente virtual." },
  { caller: "Me teñí ayer y tengo una reacción.", receptionist: "Eso no lo sé, pero se lo dejo apuntado a Lola." },
  { caller: "Marta.", receptionist: "¿Me das tu teléfono?" },
];

export type FetchRoute = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const WEEK = {
  from: "2026-11-03",
  to: "2026-11-10",
  callsAnswered: 9,
  bookings: 3,
  revenueCents: 7500,
  revenueFrom: false,
  lostCalls: 2,
  timeSavedSeconds: 1620,
  timedCalls: 9,
};

/**
 * A fake `fetch` for the Machine_API: Polls answer from `polls` in order (the last one
 * repeats), PLAY answers with TRANSCRIPT, ERASE with a version. Every call is recorded.
 */
export function fakeMachineApi(polls: (PollChanged | PollUnchanged)[] = []) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  let next = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    // "Últimos 7 días" reads its own route; it is not a Poll and is not recorded with them.
    if (method === "GET" && /^\/api\/machine\/[^/]+\/week$/.test(url)) return json(WEEK);
    calls.push({ url, method, body });
    if (method === "GET" && /^\/api\/machine\/[^/]+\?since=/.test(url)) {
      const p = polls[Math.min(next, polls.length - 1)];
      next += 1;
      return p ? json(p) : json({ error: "unavailable" }, 503);
    }
    if (method === "POST" && url.includes("/messages/")) {
      return body?.action === "play" ? json({ version: 11, transcript: TRANSCRIPT, lang: "es" }) : json({ version: 12 });
    }
    if (method === "GET" && url.includes("/slots")) return json({ slots: [] });
    if (method === "DELETE") return new Response(null, { status: 204 });
    return json({ error: "unavailable" }, 503);
  });
  return { fetchMock, calls };
}

/** A `matchMedia` stub that answers `(prefers-reduced-motion: reduce)` with `reduce`. */
export function stubMatchMedia(reduce: boolean): void {
  // The screens start in the browser language when the shop speaks it (BACKLOG 26): these suites assert the shop's first (Spanish).
  vi.spyOn(navigator, "language", "get").mockReturnValue("es-ES");
  // The "Try it in 30 seconds" strip is its own suite's business (tests/components/guide); here it is dismissed.
  localStorage.setItem("pl:guide-dismissed", "1");
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reduce : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/**
 * The tabbable elements in DOM order, which is the tab order because no `tabindex` is above
 * 0: buttons, links, form fields and `tabindex="0"`, not disabled, not `tabindex="-1"`, not
 * inside a hidden panel or a closed dialog. jsdom does not move focus on Tab, so the test
 * checks this contract and the real Tab pass is in the manual checklist.
 */
export function tabbables(root: ParentNode = document.body): HTMLElement[] {
  const all = [...root.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]")];
  return all.filter((el) => {
    if ((el as HTMLButtonElement).disabled) return false;
    const ti = el.getAttribute("tabindex");
    if (ti !== null && Number(ti) < 0) return false;
    if (el.closest("[hidden], dialog:not([open])")) return false;
    if (el instanceof HTMLInputElement && el.type === "hidden") return false;
    return true;
  });
}

/** A short name for a tabbable element, for readable order assertions. */
export function nameOf(el: HTMLElement): string {
  const card = el.getAttribute("data-tape-card");
  if (card) return `card:${card}`;
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    const label = el.labels?.[0];
    return `field:${label?.textContent?.trim() ?? el.name}`;
  }
  return (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();
}
