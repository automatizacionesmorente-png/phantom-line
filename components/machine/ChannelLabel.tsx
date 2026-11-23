import { MessageCircle, MessagesSquare, PenLine, Phone } from "lucide-react";
import type { BookingChannel } from "@/lib/owner/agenda";

const ICON = { voice: Phone, whatsapp: MessageCircle, webchat: MessagesSquare, manual: PenLine } as const;

/** The Channel as a Lucide icon with a text label (owner-machine 7.9). The icon is decorative. */
export function ChannelLabel({ channel, labels }: { channel: BookingChannel; labels: Record<BookingChannel, string> }) {
  const Icon = ICON[channel];
  return (
    <span className="inline-flex items-center gap-1.5 font-inter text-sm text-muted">
      <Icon aria-hidden="true" size={16} className="shrink-0" />
      {labels[channel]}
    </span>
  );
}
