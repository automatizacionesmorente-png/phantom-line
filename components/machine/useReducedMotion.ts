"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

const getSnapshot = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;
/** On the server, motion is assumed allowed; the global CSS rule still stops every animation (13.4). */
const getServerSnapshot = () => false;

/**
 * Whether the Owner asked for reduced motion (13.4). The light, the reels and the Transcript
 * read it so that no blink class, spin class, hidden line or reveal timer exists at all,
 * not only that their animations are stopped by CSS.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
