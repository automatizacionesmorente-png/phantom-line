import type { Service } from "./types";

/** Joins the parts of a Combo_Id: `corte-hombre+degradado`. */
export const COMBO_SEPARATOR = "+";
/** A Service_Combo has 2 or 3 parts (Requirement 7.3). */
export const MAX_COMBO_PARTS = 3;
/** A Service_Combo's summed duration may not exceed this (Requirement 7.3). */
export const MAX_COMBO_MIN = 480;

/**
 * The catalog services a service id or a Combo_Id stands for, in catalog order. Pure.
 *
 * A plain catalog id gives that one service. A Combo_Id is valid only when it has 2 or 3
 * parts, every part is a catalog id, no part repeats, the parts are in catalog order (so
 * each Service_Combo has exactly one id), and their durations sum to at most
 * `MAX_COMBO_MIN`. Anything else is null, which the Booking_Rules reject as
 * `unknown_service`.
 */
export function resolveParts(id: string, services: readonly Service[]): Service[] | null {
  const exact = services.find((s) => s.id === id);
  if (exact) return [exact];
  if (!id.includes(COMBO_SEPARATOR)) return null;

  const parts = id.split(COMBO_SEPARATOR);
  if (parts.length < 2 || parts.length > MAX_COMBO_PARTS) return null;
  const out: Service[] = [];
  let lastIndex = -1;
  let total = 0;
  for (const part of parts) {
    const index = services.findIndex((s) => s.id === part);
    // Unknown (including an empty part from "a+" or "+a"), repeated, or out of catalog order.
    if (index < 0 || index <= lastIndex) return null;
    lastIndex = index;
    total += services[index].durationMin;
    out.push(services[index]);
  }
  if (total > MAX_COMBO_MIN) return null;
  return out;
}

/**
 * A service id or a Combo_Id as one Service: the catalog service itself, or a Service with
 * the Combo_Id and the summed duration. Null if it is not valid (see `resolveParts`). Pure.
 */
export function resolveService(id: string, services: readonly Service[]): Service | null {
  const parts = resolveParts(id, services);
  if (!parts) return null;
  if (parts.length === 1) return parts[0];
  return { id, durationMin: parts.reduce((sum, s) => sum + s.durationMin, 0) };
}

/**
 * The canonical id of 1–3 different catalog ids, in any order: one id as it is, or the
 * parts in catalog order joined with `COMBO_SEPARATOR`. Null for no ids, more than
 * `MAX_COMBO_PARTS`, an unknown or repeated id, or a sum over `MAX_COMBO_MIN`. Pure.
 */
export function comboId(ids: readonly string[], services: readonly Service[]): string | null {
  if (ids.length === 0 || ids.length > MAX_COMBO_PARTS) return null;
  if (new Set(ids).size !== ids.length) return null;
  const indexes: number[] = [];
  for (const id of ids) {
    const index = services.findIndex((s) => s.id === id);
    if (index < 0) return null;
    indexes.push(index);
  }
  indexes.sort((a, b) => a - b);
  const id = indexes.map((k) => services[k].id).join(COMBO_SEPARATOR);
  return resolveParts(id, services) ? id : null;
}
