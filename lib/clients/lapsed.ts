/**
 * "Clientes que no han vuelto" (BACKLOG 15): the code decides who is listed, never the model.
 * A client is lapsed when the days since the last visit exceed 1.5 times their own usual interval
 * (the median gap between visits; never less than 21 days, so a weekly client is not "lost" after
 * one missed week), or 60 days when there are too few visits to have one. Never a
 * client with an unfinished confirmed booking, and never one who has not visited at all.
 * Ordered by days overdue, most overdue first. Pure.
 */
import { Temporal } from "temporal-polyfill";
import { DEFAULT_LAPSE_DAYS, type ClientSummary } from "./summary";

/** A weekly client is not lost after one missed week. */
export const MIN_LAPSE_DAYS = 21;

const MS_DAY = 86_400_000;

export interface LapsedInput {
  id: string;
  name: string;
  summary: Pick<ClientSummary, "lastVisit" | "upcoming" | "intervalDays">;
}

export interface Lapsed {
  id: string;
  /** Whole days since the last visit. */
  daysSince: number;
  /** The interval it is measured against: the client's own, or 60. */
  thresholdDays: number;
  /** `daysSince - thresholdDays`, always positive. */
  overdueDays: number;
}

export function lapsedClients(clients: readonly LapsedInput[], now: Temporal.Instant): Lapsed[] {
  const out: Lapsed[] = [];
  const names = new Map(clients.map((c) => [c.id, c.name]));
  for (const c of clients) {
    const { lastVisit, upcoming, intervalDays } = c.summary;
    if (lastVisit === null || upcoming !== null) continue;
    const daysSince = Math.floor((now.epochMilliseconds - lastVisit.epochMilliseconds) / MS_DAY);
    const thresholdDays = lapseThresholdDays(intervalDays);
    const overdueDays = daysSince - thresholdDays;
    if (overdueDays <= 0) continue;
    out.push({ id: c.id, daysSince, thresholdDays, overdueDays });
  }
  const nameOf = (id: string) => names.get(id) ?? "";
  return out.sort((a, b) => b.overdueDays - a.overdueDays || nameOf(a.id).localeCompare(nameOf(b.id)) || a.id.localeCompare(b.id));
}

/** Days without a visit before a client counts as lapsed: 1.5 × their interval, at least 21; 60 with no interval. */
export function lapseThresholdDays(intervalDays: number | null | undefined): number {
  if (intervalDays === null || intervalDays === undefined) return DEFAULT_LAPSE_DAYS;
  return Math.max(MIN_LAPSE_DAYS, Math.round(intervalDays * 1.5));
}
