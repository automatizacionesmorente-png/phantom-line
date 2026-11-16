import type { Urgency } from "@/lib/conversation/types";
import { urgencyLabel } from "@/lib/messages/tape";
import type { Lang } from "@/lib/sectors";

const STYLE: Record<Urgency, string> = {
  // 7.8: the urgent badge is --light-text with --card text (5.8:1).
  urgent: "bg-light-text text-card",
  normal: "border border-ink/30 bg-section text-ink",
  low: "border border-border bg-card text-muted",
};

/** The urgency as a text badge, never colour alone (owner-machine 7.8). */
export function UrgencyBadge({ urgency, lang }: { urgency: Urgency; lang: Lang }) {
  return (
    <span
      data-urgency={urgency}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-inter text-sm font-semibold ${STYLE[urgency]}`}
    >
      {urgencyLabel(urgency, lang)}
    </span>
  );
}
