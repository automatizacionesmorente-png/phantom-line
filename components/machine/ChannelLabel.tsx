import { MessageCircle, MessagesSquare, Phone } from "lucide-react";
import type { Channel } from "@/lib/conversation/types";

const ICON = { voice: Phone, whatsapp: MessageCircle, webchat: MessagesSquare } as const;

/** The Channel as a Lucide icon with a text label (owner-machine 7.9). The icon is decorative. */
export function ChannelLabel({ channel, labels }: { channel: Channel; labels: Record<Channel, string> }) {
  const Icon = ICON[channel];
  return (
    <span className="inline-flex items-center gap-1.5 font-inter text-sm text-muted">
      <Icon aria-hidden="true" size={16} className="shrink-0" />
      {labels[channel]}
    </span>
  );
}
