"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Temporal } from "temporal-polyfill";
import type { ClientsResponse } from "@/lib/clients/api";
import type { OwnerBookingAction } from "@/lib/owner/agenda";
import type { AgendaDayDto, AgendaItem } from "@/lib/owner/api";
import { formatDayHeading } from "@/lib/owner/format";
import type { MachineShop } from "@/lib/owner/machineShop";
import type { BlockDto, PaymentsDayResponse } from "@/lib/salon/api";
import { dayLayout, freeSlotCount } from "@/lib/salon/dayLayout";
import type { Lang } from "@/lib/sectors";
import { postBookingAction } from "../bookingApi";
import { CancelDialog } from "../CancelDialog";
import { getClients, postClientAction } from "../clientApi";
import { ROW_BUTTON } from "../controlButton";
import type { MachineCopy } from "../machineCopy";
import { MoveDialog, type DialogOutcome } from "../MoveDialog";
import { formatRevenue } from "../weekCopy";
import { ADD_COPY } from "./addCopy";
import { AddButton } from "./AddButton";
import { BlockDialog } from "./BlockDialog";
import { BookingSheet, type BookingClient } from "./BookingSheet";
import { DayBook, type FreeGap } from "./DayBook";
import { KpiRow } from "./KpiRow";
import { NewBookingDialog } from "./NewBookingDialog";
import { PayDialog } from "./PayDialog";
import { getBlocks, getPaymentsDay } from "./todayApi";
import { TODAY_COPY } from "./todayCopy";
import { WeekStrip } from "./WeekStrip";

type Mode = "day" | "week";

function buildClients(book: ClientsResponse): Map<string, BookingClient> {
  const m = new Map<string, BookingClient>();
  for (const c of book.clients) {
    for (const h of c.history) {
      m.set(h.bookingId, { clientId: c.id, note: c.note, canMarkNoShow: h.canMarkNoShow, noShow: h.state === "no_show" });
    }
  }
  return m;
}

/**
 * Today, the booking book (salon spec 2.1): the four numbers, the day (one column per worker) or
 * the week, a sheet for each appointment and the cash strip. The agenda comes from the Poll;
 * blocks, the day's payments and the clients' notes are read from their own routes, again each
 * time `refreshKey` changes (the Poll's version). The big + button (new appointment, block time),
 * a tap on a free gap and Cobrar open their dialogs from here; whatever they change calls
 * `onRefresh`, which reads the agenda again, and the reads above run again too.
 */
export function TodayView({
  shop,
  lang,
  copy,
  agenda,
  now,
  newMessages,
  refreshKey,
  onOpenTape,
  onItem,
  onLocked,
  onRefresh,
  onOpenClient,
}: {
  shop: MachineShop;
  lang: Lang;
  copy: MachineCopy;
  agenda: readonly AgendaDayDto[];
  now: string;
  newMessages: number;
  refreshKey: number;
  onOpenTape: () => void;
  onItem: (item: AgendaItem) => void;
  onLocked: () => void;
  /** Read the agenda again now (a booking or a block was written, or a slot was found taken). */
  onRefresh: () => void;
  onOpenClient?: (clientId: string) => void;
}) {
  const t = TODAY_COPY[lang];
  const add = ADD_COPY[lang];
  const bookingWord = shop.vocabulary[lang].booking;
  const today = Temporal.Instant.from(now).toZonedDateTimeISO(shop.timeZone).toPlainDate().toString();
  const [picked, setPicked] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("day");
  const [blocks, setBlocks] = useState<BlockDto[]>([]);
  const [cash, setCash] = useState<PaymentsDayResponse | null>(null);
  const [cashFailed, setCashFailed] = useState(false);
  const [clients, setClients] = useState<Map<string, BookingClient>>(new Map());
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [moving, setMoving] = useState<AgendaItem | null>(null);
  const [cancelling, setCancelling] = useState<AgendaItem | null>(null);
  const [booking, setBooking] = useState<{ n: number; gap: FreeGap | null } | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [paying, setPaying] = useState<AgendaItem | null>(null);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const touch = useRef<number | null>(null);

  const dates = agenda.map((d) => d.date);
  const selected = picked !== null && dates.includes(picked) ? picked : today;
  const idx = dates.indexOf(selected);

  // Blocks of the window the Poll covers (today and the next 7 days).
  useEffect(() => {
    let live = true;
    const midnight = Temporal.PlainDate.from(today).toZonedDateTime(shop.timeZone);
    void getBlocks(shop.id, midnight.toInstant().toString(), midnight.add({ days: 8 }).toInstant().toString()).then((a) => {
      if (!live) return;
      if (a.ok) setBlocks(a.body.blocks);
      else if (a.status === 401) onLocked();
    });
    return () => {
      live = false;
    };
  }, [shop.id, shop.timeZone, today, refreshKey, tick, onLocked]);

  useEffect(() => {
    let live = true;
    void getPaymentsDay(shop.id, today).then((a) => {
      if (!live) return;
      if (a.ok) {
        setCash(a.body);
        setCashFailed(false);
      } else if (a.status === 401) onLocked();
      else setCashFailed(true);
    });
    return () => {
      live = false;
    };
  }, [shop.id, today, refreshKey, tick, onLocked]);

  useEffect(() => {
    let live = true;
    void getClients(shop.id).then((a) => {
      if (!live) return;
      if (a.ok) setClients(buildClients(a.body));
      else if (a.status === 401) onLocked();
    });
    return () => {
      live = false;
    };
  }, [shop.id, refreshKey, tick, onLocked]);

  const active = useCallback((d: AgendaDayDto | undefined) => (d?.items ?? []).filter((i) => i.status !== "cancelled"), []);

  const layoutFor = useCallback(
    (date: string) =>
      dayLayout<AgendaItem, BlockDto>({
        date,
        tz: shop.timeZone,
        hours: shop.hours,
        slotStepMin: shop.slotStepMin,
        resources: shop.resources,
        items: active(agenda.find((d) => d.date === date)),
        blocks,
        now,
      }),
    [agenda, active, blocks, now, shop.timeZone, shop.hours, shop.slotStepMin, shop.resources],
  );
  const layout = useMemo(() => layoutFor(selected), [layoutFor, selected]);
  const todayItems = active(agenda.find((d) => d.date === today));
  const freeSlots = freeSlotCount(layoutFor(today), now, shop.slotStepMin);
  const takings = todayItems.reduce((sum, i) => sum + (i.priceCents ?? 0), 0);
  const allergy = useMemo(() => {
    const out = new Set<string>();
    for (const [id, c] of clients) if (c.note.trim() !== "") out.add(id);
    return out;
  }, [clients]);

  const sheetItem = sheetId === null ? null : (agenda.flatMap((d) => d.items).find((i) => i.id === sheetId) ?? null);

  function outcomeFor(id: string) {
    return (o: DialogOutcome) => {
      if (o.kind === "locked") return onLocked();
      if (o.kind === "not_allowed") return setNotice(copy.errors.notAllowed);
      onItem(o.booking);
      setNotice(o.kind === "stale" ? copy.errors.stale : null);
      setSheetId(id);
    };
  }

  async function confirm(item: AgendaItem) {
    setBusy(true);
    setNotice(null);
    const a = await postBookingAction(shop.id, item.id, { action: "confirm", revision: item.revision });
    setBusy(false);
    if (a.ok) return onItem(a.body.booking);
    if (a.status === 401) return onLocked();
    if (a.body?.error === "stale") {
      onItem(a.body.booking);
      return setNotice(copy.errors.stale);
    }
    setNotice(a.body?.error === "not_allowed" ? copy.errors.notAllowed : copy.errors.failed);
  }

  function onAction(item: AgendaItem, action: OwnerBookingAction) {
    setNotice(null);
    if (action === "confirm") return void confirm(item);
    // The dialogs are modal: the sheet gives way to them and comes back with their outcome.
    setSheetId(null);
    if (action === "move") setMoving(item);
    else setCancelling(item);
  }

  async function onNoShow(item: AgendaItem, c: BookingClient, noShow: boolean) {
    setBusy(true);
    setNotice(null);
    const a = await postClientAction(shop.id, c.clientId, { action: "no_show", bookingId: item.id, noShow });
    setBusy(false);
    if (a.ok) return setClients(buildClients(a.body));
    if (a.status === 401) return onLocked();
    setNotice(copy.errors.failed);
  }

  /** Something was written: read the agenda, the blocks, the cash and the clients again. */
  const changed = useCallback(() => {
    setTick((n) => n + 1);
    onRefresh();
  }, [onRefresh]);

  function pay(item: AgendaItem) {
    setNotice(null);
    setSheetId(null);
    setPaying(item);
  }

  function openSheet(item: AgendaItem) {
    setNotice(null);
    setSheetId(item.id);
  }

  const go = (delta: number) => {
    const next = dates[idx + delta];
    if (next !== undefined) setPicked(next);
  };

  const methods = ["cash", "card", "bizum", "voucher"] as const;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="sr-only">{t.label}</h2>
      <KpiRow
        copy={t}
        lang={lang}
        bookingWord={bookingWord}
        appointments={todayItems.length}
        freeSlots={freeSlots}
        takingsCents={takings}
        newMessages={newMessages}
        onOpenTape={onOpenTape}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button type="button" aria-label={t.nav.prev} disabled={idx <= 0} onClick={() => go(-1)} className={ROW_BUTTON}>
            <ChevronLeft aria-hidden="true" size={18} />
          </button>
          <p aria-live="polite" className="min-w-[8.5rem] text-center font-newsreader text-xl text-ink">
            {selected === today ? `${t.nav.today} · ` : ""}
            {formatDayHeading(Temporal.PlainDate.from(selected), lang)}
          </p>
          <button type="button" aria-label={t.nav.next} disabled={idx < 0 || idx >= dates.length - 1} onClick={() => go(1)} className={ROW_BUTTON}>
            <ChevronRight aria-hidden="true" size={18} />
          </button>
        </div>
        <div role="group" aria-label={t.nav.mode} className="flex gap-1.5">
          {(["day", "week"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`${ROW_BUTTON} ${mode === m ? "!bg-espresso !text-card" : ""}`}
            >
              {t.nav[m]}
            </button>
          ))}
        </div>
      </div>

      {mode === "week" ? (
        <WeekStrip
          days={agenda}
          selected={selected}
          today={today}
          expanded
          shop={shop}
          lang={lang}
          copy={t}
          bookingWord={bookingWord}
          onSelect={(d) => {
            setPicked(d);
            setMode("day");
          }}
          onBooking={openSheet}
        />
      ) : (
        <>
          <WeekStrip
            days={agenda}
            selected={selected}
            today={today}
            expanded={false}
            shop={shop}
            lang={lang}
            copy={t}
            bookingWord={bookingWord}
            onSelect={setPicked}
            onBooking={openSheet}
          />
          <div
            onTouchStart={(e) => (touch.current = e.touches[0]?.clientX ?? null)}
            onTouchEnd={(e) => {
              const from = touch.current;
              touch.current = null;
              const to = e.changedTouches[0]?.clientX;
              if (from === null || to === undefined || Math.abs(to - from) < 70) return;
              go(to < from ? 1 : -1);
            }}
          >
            <DayBook layout={layout} shop={shop} lang={lang} copy={t} allergy={allergy} onBooking={openSheet} onFreeGap={(g) => setBooking({ n: Date.now(), gap: g })} />
          </div>
        </>
      )}

      <section data-cash-strip="" aria-label={t.cash.title} className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3.5">
        <h3 className="font-newsreader text-xl text-ink">{t.cash.title}</h3>
        {cash === null ? (
          cashFailed && <p className="font-inter text-sm text-muted">{t.cash.failed}</p>
        ) : cash.count === 0 ? (
          <p className="font-inter text-base text-muted">{t.cash.empty}</p>
        ) : (
          <dl className="flex flex-wrap gap-x-5 gap-y-1 font-inter text-base text-ink">
            {methods.map((m) => (
              <div key={m} className="flex gap-1.5">
                <dt className="text-muted">{t.cash.methods[m]}</dt>
                <dd className="font-semibold">{formatRevenue(cash.byMethod[m], lang)}</dd>
              </div>
            ))}
            <div className="flex gap-1.5">
              <dt className="text-muted">{t.cash.total}</dt>
              <dd className="font-semibold text-gold-text">{formatRevenue(cash.totalCents, lang)}</dd>
            </div>
          </dl>
        )}
      </section>

      {sheetItem && (
        <BookingSheet
          key={sheetItem.id}
          item={sheetItem}
          shop={shop}
          lang={lang}
          copy={copy}
          today={t}
          client={clients.get(sheetItem.id)}
          busy={busy}
          notice={notice}
          onClose={() => setSheetId(null)}
          onAction={onAction}
          onNoShow={(i, c, v) => void onNoShow(i, c, v)}
          onPay={pay}
          onOpenClient={onOpenClient}
          onLocked={onLocked}
        />
      )}
      <AddButton
        copy={add}
        bookingWord={bookingWord}
        onNewBooking={() => setBooking({ n: Date.now(), gap: null })}
        onBlock={() => setBlocking(true)}
      />
      {booking && (
        <NewBookingDialog
          key={booking.n}
          shop={shop}
          lang={lang}
          copy={add}
          bookingWord={bookingWord}
          now={now}
          initial={booking.gap ? { resourceId: booking.gap.resourceId, start: booking.gap.start } : null}
          onClose={() => setBooking(null)}
          onChanged={changed}
          onLocked={onLocked}
        />
      )}
      {blocking && (
        <BlockDialog
          shop={shop}
          lang={lang}
          copy={add}
          bookingWord={bookingWord}
          now={now}
          onClose={() => setBlocking(false)}
          onChanged={changed}
          onLocked={onLocked}
        />
      )}
      {paying && (
        <PayDialog
          key={`${paying.id}:${paying.revision}`}
          item={paying}
          shop={shop}
          lang={lang}
          copy={add}
          onClose={() => {
            setSheetId(paying.id);
            setPaying(null);
          }}
          onPaid={onItem}
          onChanged={changed}
          onLocked={onLocked}
        />
      )}
      {moving && (
        <MoveDialog
          key={`${moving.id}:${moving.revision}`}
          booking={moving}
          shop={shop}
          now={now}
          lang={lang}
          copy={copy}
          onClose={() => setMoving(null)}
          onOutcome={outcomeFor(moving.id)}
        />
      )}
      {cancelling && (
        <CancelDialog
          key={`${cancelling.id}:${cancelling.revision}`}
          booking={cancelling}
          shop={shop}
          lang={lang}
          copy={copy}
          onClose={() => setCancelling(null)}
          onOutcome={outcomeFor(cancelling.id)}
        />
      )}
    </div>
  );
}
