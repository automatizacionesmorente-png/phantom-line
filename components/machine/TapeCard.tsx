import type { ReactNode } from "react";
import { Temporal } from "temporal-polyfill";
import { urgencyBasisText } from "@/lib/messages/tape";
import type { TapeItem } from "@/lib/owner/api";
import { formatClock, formatDayHeading } from "@/lib/owner/format";
import type { MachineShop } from "@/lib/owner/machineShop";
import type { Lang } from "@/lib/sectors";
import { ChannelLabel } from "./ChannelLabel";
import type { MachineCopy } from "./machineCopy";
import { SampleBadge } from "./SampleBadge";
import { UrgencyBadge } from "./UrgencyBadge";

/** The Agreed_Text in the label language, or the stored text in the language it was written in (4.7, 13.7). */
export function agreedOf(item: TapeItem, lang: Lang): { text: string; lang: Lang } {
  return "byLang" in item.agreed ? { text: item.agreed.byLang[lang], lang } : { text: item.agreed.stored, lang: item.ownerLang };
}

/** When the Message was left, in the shop's zone: "Lunes 9, 18:05". */
export function whenOf(iso: string, shop: Pick<MachineShop, "timeZone">, lang: Lang, copy: MachineCopy): string {
  const at = Temporal.Instant.from(iso);
  const day = at.toZonedDateTimeISO(shop.timeZone).toPlainDate();
  return copy.at(formatDayHeading(day, lang), formatClock(at, shop.timeZone, lang));
}

/**
 * One Message as a tape card (owner-machine 7.1, 7.2, 7.8, 7.9, 7.12): caller, Sample badge,
 * urgency as text with its basis, Channel, reason, Agreed_Text, and the Current_Reply in
 * Caveat. `expanded` is the Message on screen: it adds the phone and the Transcript.
 * Stored texts carry the language they were written in (13.7).
 */
export function TapeCard({
  item,
  shop,
  lang,
  copy,
  expanded = false,
  current = false,
  fadeIn = false,
  children,
}: {
  item: TapeItem;
  shop: MachineShop;
  lang: Lang;
  copy: MachineCopy;
  expanded?: boolean;
  current?: boolean;
  fadeIn?: boolean;
  children?: ReactNode;
}) {
  const headingId = `${expanded ? "playing" : "card"}-${item.id}`;
  const basis = urgencyBasisText(item, lang, shop).split(" · ")[1];
  const agreed = agreedOf(item, lang);
  return (
    <article
      aria-labelledby={headingId}
      aria-current={current ? "true" : undefined}
      tabIndex={expanded ? undefined : 0}
      data-tape-card={expanded ? undefined : item.id}
      className={`${expanded ? "" : "focus-ring"} flex flex-col gap-2.5 rounded-[20px] border bg-card p-4 shadow-[0_6px_18px_rgb(36_29_20/0.08)] ${
        current ? "border-gold-dot ring-2 ring-gold-dot/60" : "border-border"
      } ${fadeIn ? "ghost-in" : ""}`}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h3 id={headingId} className="font-newsreader text-xl font-medium text-ink break-words">
          {item.callerName ?? copy.fields.noName}
        </h3>
        {item.sample && <SampleBadge label={copy.sample} />}
        {!item.heard && (
          <span className="inline-flex items-center gap-1.5 font-inter text-sm font-semibold text-gold-text">
            <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-light" />
            {copy.unheard}
          </span>
        )}
        <span className="ml-auto font-inter text-sm text-muted">{whenOf(item.createdAt, shop, lang, copy)}</span>
      </header>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <UrgencyBadge urgency={item.urgency} lang={lang} />
        {basis !== undefined && <span className="font-inter text-sm text-text">{basis}</span>}
        <ChannelLabel channel={item.channel} labels={copy.channel} />
      </div>

      {expanded && (
        <p className="font-inter text-base text-text">
          <span className="font-semibold text-ink">{copy.fields.phone}: </span>
          {item.callerPhone ?? copy.fields.noPhone}
        </p>
      )}

      <dl className="grid gap-1.5 font-inter text-base text-text">
        <div>
          <dt className="inline font-semibold text-ink">{copy.fields.reason}: </dt>
          <dd className="inline" lang={item.ownerLang}>
            {item.reason}
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold text-ink">{copy.fields.agreed}: </dt>
          <dd className="inline" lang={agreed.lang}>
            {agreed.text}
          </dd>
        </div>
      </dl>

      {expanded && children}

      <div className="border-t border-dashed border-border pt-2">
        <p className="font-inter text-xs uppercase tracking-[0.18em] text-muted">{copy.fields.reply}</p>
        <p lang={item.replyLang} className="font-caveat text-2xl leading-snug text-text">
          {item.currentReply}
        </p>
      </div>
    </article>
  );
}
