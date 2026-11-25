"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Wallet } from "lucide-react";
import type { AgendaItem, MachineErrorBody } from "@/lib/owner/api";
import { serviceName, type MachineShop } from "@/lib/owner/machineShop";
import type { Lang } from "@/lib/sectors";
import { CONTROL_BUTTON, GOLD_GRADIENT, PRIMARY_BUTTON } from "../controlButton";
import { closeDialog, openDialog } from "../openDialog";
import { postPay } from "../salonApi";
import { formatRevenue } from "../weekCopy";
import type { AddCopy, PayMethod } from "./addCopy";
import { eurosText, parseEuros } from "./addHelpers";

const METHODS: PayMethod[] = ["cash", "card", "bizum", "voucher"];
const MAX_CENTS = 1_000_000;

function refusal(copy: AddCopy, body: MachineErrorBody | null): string {
  const e = copy.pay.errors;
  switch (body?.error) {
    case "already_paid":
      return e.already_paid;
    case "cancelled":
      return e.cancelled;
    case "not_yet":
      return e.not_yet;
    case "booking_not_found":
      return e.booking_not_found;
    case "invalid_request":
      return e.invalid_request;
    default:
      return copy.common.failed;
  }
}

/**
 * Cobrar (salon spec 2.5): the amount pre-filled from the price and editable, the method as four
 * big buttons, and an optional product line (label and amount) that adds to the total. The
 * server refuses a paid, cancelled or far-off booking; the dialog says which. Mount it with a
 * `key` per booking: it opens itself as a modal.
 */
export function PayDialog({
  item,
  shop,
  lang,
  copy,
  onClose,
  onPaid,
  onChanged,
  onLocked,
}: {
  item: AgendaItem;
  shop: MachineShop;
  lang: Lang;
  copy: AddCopy;
  onClose: () => void;
  /** The booking as it is now that it is paid. */
  onPaid: (booking: AgendaItem) => void;
  onChanged: () => void;
  onLocked: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const t = copy.pay;
  const [amount, setAmount] = useState(item.priceCents !== null ? eurosText(item.priceCents, lang) : "");
  const [method, setMethod] = useState<PayMethod | null>(null);
  const [product, setProduct] = useState(false);
  const [label, setLabel] = useState("");
  const [productAmount, setProductAmount] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(onLocked);

  useEffect(() => {
    locked.current = onLocked;
  }, [onLocked]);

  useEffect(() => {
    if (ref.current) openDialog(ref.current);
  }, []);

  const serviceCents = parseEuros(amount);
  const productCents = product && productAmount.trim() !== "" ? parseEuros(productAmount) : 0;
  const total = serviceCents !== null && productCents !== null ? serviceCents + productCents : null;
  const totalText = total === null ? "" : formatRevenue(total, lang);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    if (total === null || serviceCents === null || productCents === null || total > MAX_CENTS) return setError(t.errors.bad_amount);
    if (method === null) return setError(t.errors.no_method);
    setBusy(true);
    setError("");
    const a = await postPay(shop.id, item.id, {
      amountCents: total,
      method,
      ...(productCents > 0 ? { productCents } : {}),
      ...(productCents > 0 && label.trim() !== "" ? { productLabel: label.trim() } : {}),
    });
    setBusy(false);
    if (a.ok) {
      if (a.body.booking) onPaid(a.body.booking);
      onChanged();
      onClose();
      return closeDialog(ref.current);
    }
    if (a.status === 401) return locked.current();
    setError(refusal(copy, a.body));
    // Paid or cancelled elsewhere in the meantime: show the current state behind the dialog.
    if (a.body?.error === "already_paid" || a.body?.error === "cancelled") onChanged();
  }

  const field = "focus-ring min-h-11 rounded-2xl border border-border bg-card px-3 font-inter text-base text-text";
  const labelCls = "font-inter text-base font-semibold text-ink";

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      onClose={onClose}
      className="m-auto w-[min(100%-1.5rem,30rem)] rounded-[24px] border border-gold-dot bg-card p-0 text-text shadow-[0_24px_60px_rgb(36_29_20/0.25)] backdrop:bg-espresso/30"
    >
      <form onSubmit={submit} className="flex flex-col gap-4 p-5" lang={lang}>
        <h2 id={`${id}-title`} className="flex items-center gap-2 font-newsreader text-2xl font-medium text-ink">
          <Wallet aria-hidden="true" size={22} className="text-gold-text" />
          {t.title(item.customerName)}
        </h2>
        <p className="font-inter text-base text-muted">{serviceName(shop, item.serviceId, lang)}</p>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-amount`} className={labelCls}>
            {t.amount}
          </label>
          <input
            id={`${id}-amount`}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-describedby={`${id}-amount-hint`}
            className={field}
          />
          <p id={`${id}-amount-hint`} className="font-inter text-sm text-muted">
            {t.amountHint}
          </p>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className={`${labelCls} mb-1.5`}>{t.method}</legend>
          <div className="grid grid-cols-2 gap-2">
            {METHODS.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={method === m}
                onClick={() => setMethod(m)}
                className={`focus-ring flex min-h-14 items-center justify-center rounded-2xl border-2 border-ink px-3 font-inter text-lg font-semibold ${
                  method === m ? "bg-espresso text-card" : "bg-card text-ink hover:bg-section"
                }`}
              >
                {t.methods[m]}
              </button>
            ))}
          </div>
        </fieldset>

        {product ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-section p-3.5">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-plabel`} className={labelCls}>
                {t.productLabel}
              </label>
              <input id={`${id}-plabel`} type="text" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} className={field} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-pamount`} className={labelCls}>
                {t.productAmount}
              </label>
              <input
                id={`${id}-pamount`}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={productAmount}
                onChange={(e) => setProductAmount(e.target.value)}
                className={field}
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setProduct(false);
                setLabel("");
                setProductAmount("");
              }}
              className={`${CONTROL_BUTTON} self-start normal-case`}
            >
              {t.removeProduct}
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setProduct(true)} className={`${CONTROL_BUTTON} self-start normal-case`}>
            {t.addProduct}
          </button>
        )}

        {total !== null && <p className="font-inter text-lg font-semibold text-gold-text">{t.total(totalText)}</p>}

        <p role="alert" className="min-h-6 font-inter text-base font-semibold text-light-text">
          {error}
        </p>

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => closeDialog(ref.current)} className={CONTROL_BUTTON}>
            {copy.common.close}
          </button>
          <button type="submit" disabled={busy} className={PRIMARY_BUTTON} style={GOLD_GRADIENT}>
            {busy ? t.working : t.submit(totalText)}
          </button>
        </div>
      </form>
    </dialog>
  );
}
