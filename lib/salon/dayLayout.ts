/**
 * The booking book's geometry for one local day (salon spec 2.1): per worker, the bookings, the
 * blocks and the free gaps as stacked boxes in percent of the day, and where "now" is. Pure.
 * Minutes are real minutes since local midnight, so a DST day is not forced to 24 hours.
 * Bookings win over blocks, and a booking over a booking: the later one is trimmed, so the
 * entries of a column never overlap whatever the data says.
 */
import { Temporal } from "temporal-polyfill";

export interface LayoutSession {
  open: string;
  close: string;
}
/** ISO weekday (1 Monday … 7 Sunday) to that day's sessions. */
export type LayoutHours = Readonly<Partial<Record<number, readonly LayoutSession[]>>>;

export interface LayoutItem {
  id: string;
  resourceId: string;
  start: string;
  end: string;
}
export interface LayoutBlock {
  id: string;
  /** null: the whole shop. */
  resourceId: string | null;
  start: string;
  end: string;
}

export interface LayoutInput<I extends LayoutItem = LayoutItem, B extends LayoutBlock = LayoutBlock> {
  /** Local date "YYYY-MM-DD". */
  date: string;
  tz: string;
  hours: LayoutHours;
  slotStepMin: number;
  resources: readonly { id: string }[];
  /** Active bookings only (the caller drops the cancelled ones). */
  items: readonly I[];
  blocks: readonly B[];
  /** ISO instant. */
  now: string;
}

export interface LayoutEntry<I, B> {
  kind: "booking" | "block" | "free";
  /** ISO instants of the (clipped) box. */
  start: string;
  end: string;
  startMin: number;
  endMin: number;
  topPct: number;
  heightPct: number;
  item?: I;
  block?: B;
}

export interface DayLayout<I, B> {
  startMin: number;
  endMin: number;
  columns: { resourceId: string; entries: LayoutEntry<I, B>[] }[];
  nowPct: number | null;
}

type Span = [number, number];

export function dayLayout<I extends LayoutItem, B extends LayoutBlock>(input: LayoutInput<I, B>): DayLayout<I, B> {
  const { tz, slotStepMin } = input;
  const date = Temporal.PlainDate.from(input.date);
  const midnight = date.toZonedDateTime(tz);
  const minOf = (iso: string) => midnight.until(Temporal.Instant.from(iso).toZonedDateTimeISO(tz), { largestUnit: "minutes" }).total("minutes");
  const isoAt = (min: number) => midnight.add({ seconds: Math.round(min * 60) }).toInstant().toString();
  const sessionMin = (hhmm: string) => minOf(date.toZonedDateTime({ timeZone: tz, plainTime: Temporal.PlainTime.from(hhmm) }).toInstant().toString());

  const sessions: Span[] = (input.hours[date.dayOfWeek] ?? [])
    .map((s): Span => [sessionMin(s.open), sessionMin(s.close)])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);

  const dayEnd = minOf(midnight.add({ days: 1 }).toInstant().toString());
  const clip = (a: number, b: number): Span => [Math.max(a, 0), Math.min(b, dayEnd)];

  // The range: the opening hours, widened to the whole hour around anything outside them.
  const spans: Span[] = [
    ...sessions,
    ...input.items.map((i) => clip(minOf(i.start), minOf(i.end))),
    ...input.blocks.map((b) => clip(minOf(b.start), minOf(b.end))),
  ].filter(([a, b]) => b > a);
  let startMin: number;
  let endMin: number;
  if (spans.length === 0) {
    startMin = 9 * 60;
    endMin = 18 * 60;
  } else {
    const lo = Math.min(...spans.map((s) => s[0]));
    const hi = Math.max(...spans.map((s) => s[1]));
    startMin = sessions.length > 0 && lo >= sessions[0][0] ? lo : Math.floor(lo / 60) * 60;
    endMin = sessions.length > 0 && hi <= sessions[sessions.length - 1][1] ? hi : Math.ceil(hi / 60) * 60;
  }
  if (endMin <= startMin) endMin = startMin + 60;
  const total = endMin - startMin;
  const pct = (m: number) => ((m - startMin) / total) * 100;

  const columns = input.resources.map((r) => {
    const entries: LayoutEntry<I, B>[] = [];
    const taken: Span[] = [];
    const place = (kind: "booking" | "block", a: number, b: number, extra: { item?: I; block?: B }) => {
      // Cut [a, b) by what is already placed; every remaining piece is an entry.
      let pieces: Span[] = [[Math.max(a, startMin), Math.min(b, endMin)]];
      for (const [ta, tb] of taken) {
        pieces = pieces.flatMap(([pa, pb]): Span[] =>
          tb <= pa || ta >= pb ? [[pa, pb]] : ([[pa, Math.min(pb, ta)], [Math.max(pa, tb), pb]] as Span[]).filter(([x, y]) => y > x),
        );
      }
      for (const [pa, pb] of pieces) {
        if (pb - pa <= 0) continue;
        taken.push([pa, pb]);
        entries.push({ kind, start: isoAt(pa), end: isoAt(pb), startMin: pa, endMin: pb, topPct: pct(pa), heightPct: pct(pb) - pct(pa), ...extra });
      }
    };
    for (const i of input.items.filter((x) => x.resourceId === r.id).sort((x, y) => x.start.localeCompare(y.start))) {
      place("booking", minOf(i.start), minOf(i.end), { item: i });
    }
    for (const b of input.blocks.filter((x) => x.resourceId === null || x.resourceId === r.id)) {
      place("block", minOf(b.start), minOf(b.end), { block: b });
    }
    // Free: what is left of each session, when at least one step long.
    for (const [sa, sb] of sessions) {
      let gaps: Span[] = [[Math.max(sa, startMin), Math.min(sb, endMin)]];
      for (const [ta, tb] of taken) {
        gaps = gaps.flatMap(([pa, pb]): Span[] =>
          tb <= pa || ta >= pb ? [[pa, pb]] : ([[pa, Math.min(pb, ta)], [Math.max(pa, tb), pb]] as Span[]).filter(([x, y]) => y > x),
        );
      }
      for (const [pa, pb] of gaps) {
        if (pb - pa < slotStepMin) continue;
        entries.push({ kind: "free", start: isoAt(pa), end: isoAt(pb), startMin: pa, endMin: pb, topPct: pct(pa), heightPct: pct(pb) - pct(pa) });
      }
    }
    entries.sort((x, y) => x.startMin - y.startMin);
    return { resourceId: r.id, entries };
  });

  const nowZ = Temporal.Instant.from(input.now).toZonedDateTimeISO(tz);
  const nowM = nowZ.toPlainDate().equals(date) ? minOf(input.now) : null;
  const nowPct = nowM !== null && nowM >= startMin && nowM <= endMin ? pct(nowM) : null;
  return { startMin, endMin, columns, nowPct };
}

/** How many whole steps still fit in the free gaps of a layout from `now` on (the "free slots" number). */
export function freeSlotCount<I, B>(layout: DayLayout<I, B>, now: string, slotStepMin: number): number {
  const nowMs = Temporal.Instant.from(now).epochMilliseconds;
  let n = 0;
  for (const col of layout.columns) {
    for (const e of col.entries) {
      if (e.kind !== "free") continue;
      const from = Math.max(Temporal.Instant.from(e.start).epochMilliseconds, nowMs);
      const mins = (Temporal.Instant.from(e.end).epochMilliseconds - from) / 60000;
      if (mins >= slotStepMin) n += Math.floor(mins / slotStepMin);
    }
  }
  return n;
}
