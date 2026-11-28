import type { BookingState } from "@/lib/salon/state";

/** Pixels per hour: a 30 minute booking is 44 px, the tap target minimum. */
export const PX_PER_HOUR = 88;

/** One service-category tint: a pale fill for the block and a saturated left bar. Text is always ink. */
export interface Tint {
  name: "terracotta" | "sage" | "gold" | "plum" | "blue" | "clay";
  fill: string;
  bar: string;
  /** Tailwind classes (static strings so the compiler sees them). */
  cls: string;
}

export const TINTS: readonly Tint[] = [
  { name: "terracotta", fill: "#f3d9cd", bar: "#b65f45", cls: "border-[#b65f45] bg-[#f3d9cd]" },
  { name: "sage", fill: "#dfe6d0", bar: "#6f7f4f", cls: "border-[#6f7f4f] bg-[#dfe6d0]" },
  { name: "gold", fill: "#f1e3bd", bar: "#9e711f", cls: "border-[#9e711f] bg-[#f1e3bd]" },
  { name: "plum", fill: "#e6d5df", bar: "#7b4a66", cls: "border-[#7b4a66] bg-[#e6d5df]" },
  { name: "blue", fill: "#d8e2ea", bar: "#4f6f8a", cls: "border-[#4f6f8a] bg-[#d8e2ea]" },
  { name: "clay", fill: "#ead9c8", bar: "#8a6046", cls: "border-[#8a6046] bg-[#ead9c8]" },
];

/** Fixed tints for the category ids the starters use, so a salon's colours never move around. */
const KNOWN: Record<string, number> = {
  cortes: 0, cut: 0, barberia: 0, consultas: 0, clases: 0,
  color: 3, colour: 3,
  tratamientos: 1, treatment: 1, masajes: 1, sesiones: 1, facial: 1,
  peinados: 4, styling: 4, tecnicas: 4, revisiones: 4, pruebas: 4,
  barba: 2, beard: 2, extras: 2, practicas: 2, mecanica: 2,
  nails: 5, unas: 5, depilacion: 5, examenes: 5, adultos: 5, primeras: 5,
};

export function tintFor(category: string | undefined): Tint {
  if (!category) return TINTS[0];
  const known = KNOWN[category];
  if (known !== undefined) return TINTS[known];
  let h = 0;
  for (const ch of category) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}

/** Below this height (px) a block shows name and time on one line only. */
export const COMPACT_PX = 46;

export function isCompact(startMin: number, endMin: number): boolean {
  return ((endMin - startMin) / 60) * PX_PER_HOUR < COMPACT_PX;
}

export interface StateStyle {
  /** null: no chip (a confirmed booking is the normal case). */
  chip: string | null;
  icon: "check" | null;
  strike: boolean;
}

const CHIP = "inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 text-[11px] font-semibold leading-4";

export const STATE_STYLE: Record<BookingState, StateStyle> = {
  pending: { chip: `${CHIP} border border-gold-text bg-card/70 text-gold-text`, icon: null, strike: false },
  confirmed: { chip: null, icon: null, strike: false },
  done: { chip: `${CHIP} bg-[#d9e8cf] text-[#2b4a22]`, icon: "check", strike: false },
  no_show: { chip: `${CHIP} bg-section text-muted`, icon: null, strike: true },
  to_collect: { chip: `${CHIP} border border-ink/40 bg-card/70 text-ink`, icon: null, strike: false },
  cancelled: { chip: `${CHIP} bg-section text-muted`, icon: null, strike: true },
};
