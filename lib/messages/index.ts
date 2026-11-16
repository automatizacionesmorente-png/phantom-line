import type { Lang } from "@/lib/sectors";

export * from "./agreedText";
export * from "./currentReply";
export * from "./tape";
export * from "./terms";
export * from "./urgency";

/**
 * Format a count of new messages for display, in English by default.
 *
 * @example formatMessageCount(3) → "3 new messages"
 * @example formatMessageCount(1) → "1 new message"
 * @example formatMessageCount(0) → "no new messages"
 * @example formatMessageCount(1, "es") → "1 mensaje nuevo"
 * @example formatMessageCount(3, "es") → "3 mensajes nuevos"
 */
export function formatMessageCount(count: number, lang: Lang = "en"): string {
  if (lang === "es") {
    if (count <= 0) return "ningún mensaje nuevo";
    if (count === 1) return "1 mensaje nuevo";
    return `${count} mensajes nuevos`;
  }
  if (count <= 0) return "no new messages";
  if (count === 1) return "1 new message";
  return `${count} new messages`;
}
