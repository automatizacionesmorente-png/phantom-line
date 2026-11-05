/**
 * Format a count of new messages for display.
 *
 * @example formatMessageCount(3) → "3 new messages"
 * @example formatMessageCount(1) → "1 new message"
 * @example formatMessageCount(0) → "no new messages"
 */
export function formatMessageCount(count: number): string {
  if (count <= 0) return "no new messages";
  if (count === 1) return "1 new message";
  return `${count} new messages`;
}
