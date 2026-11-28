"use client";

import { MessageCircle } from "lucide-react";
import { PROMO_KINDS } from "@/lib/salon/settings";
import type { OutboxItemDto } from "@/lib/salon/api";
import { CONTROL_BUTTON, GOLD_GRADIENT } from "../controlButton";
import type { SettingsCopy } from "./settingsCopy";

/** Only a wa.me link prepared by the server is ever put in an href. */
const safeWa = (u: string) => /^https:\/\/wa\.me\/[^\s]*$/.test(u);

/** The prepared messages: text, "Enviar por WhatsApp" (opens wa.me, then marks it sent) and "Descartar". */
export function OutboxList({
  items,
  copy,
  busyId,
  onSend,
  onDismiss,
}: {
  items: OutboxItemDto[];
  copy: SettingsCopy;
  busyId: string | null;
  onSend: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const t = copy.outbox;
  if (items.length === 0) return <p className="m-0 font-inter text-sm text-muted">{t.empty}</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {items.map((m) => (
        <li key={m.id} data-testid="outbox-item" className="flex flex-col gap-2 rounded-2xl border border-gold-dot bg-card px-3 py-3">
          <p className="m-0 font-inter text-sm font-semibold text-gold-text">
            {t.kind[m.kind]} · {m.clientFirstName ? t.toName(m.clientFirstName) : t.to(m.phone)}
          </p>
          <p className="m-0 whitespace-pre-wrap font-inter text-base text-ink">{m.body}</p>
          {PROMO_KINDS.includes(m.kind) && <p className="m-0 font-inter text-sm text-muted">{t.promoNote}</p>}
          <div className="flex flex-wrap gap-2">
            {safeWa(m.waUrl) && (
              <a
                href={m.waUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={busyId === m.id}
                onClick={() => onSend(m.id)}
                className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 font-inter text-base font-bold text-ink"
                style={GOLD_GRADIENT}
              >
                <MessageCircle aria-hidden="true" size={18} />
                {t.send}
              </a>
            )}
            <button type="button" disabled={busyId === m.id} onClick={() => onDismiss(m.id)} className={CONTROL_BUTTON}>
              {t.dismiss}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
