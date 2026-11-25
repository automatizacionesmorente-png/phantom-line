"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Receipt } from "lucide-react";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "@/lib/salon/month";
import { CONTROL_BUTTON, GOLD_GRADIENT, PRIMARY_BUTTON } from "../controlButton";
import { closeDialog, openDialog } from "../openDialog";
import { postExpense } from "../salonApi";
import { parseAmountCents, type BusinessCopy } from "./businessCopy";

/**
 * "+ Gasto" (salon spec 2.3, 9.5): concept, amount, date, category chips and "Se repite cada mes", in
 * one short native dialog. Category starts on "Otros" so a gasto can be saved with three fields.
 */
export function ExpenseDialog({
  shopId,
  copy,
  defaultDay,
  onClose,
  onSaved,
  onLocked,
}: {
  shopId: string;
  copy: BusinessCopy;
  defaultDay: string;
  onClose: () => void;
  onSaved: () => void;
  onLocked: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const t = copy.form;
  const [concept, setConcept] = useState("");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState(defaultDay);
  const [category, setCategory] = useState<ExpenseCategory>("other");
  const [recurring, setRecurring] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ref.current) openDialog(ref.current);
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const cents = parseAmountCents(amount);
    if (concept.trim() === "") return setError(t.errors.concept);
    if (cents === null) return setError(t.errors.amount);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return setError(t.errors.day);
    setBusy(true);
    setError("");
    const a = await postExpense(shopId, { concept: concept.trim(), amountCents: cents, category, day, ...(recurring ? { recurring: true } : {}) });
    setBusy(false);
    if (a.ok) {
      onSaved();
      onClose();
      return closeDialog(ref.current);
    }
    if (a.status === 401) return onLocked();
    setError(a.body?.error === "invalid_request" ? t.errors.day : t.errors.failed);
  }

  const field = "focus-ring min-h-11 rounded-2xl border border-border bg-card px-3 font-inter text-base text-text";
  const label = "font-inter text-base font-semibold text-ink";
  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      onClose={onClose}
      className="m-auto w-[min(100%-1.5rem,30rem)] rounded-[24px] border border-gold-dot bg-card p-0 text-text shadow-[0_24px_60px_rgb(36_29_20/0.25)] backdrop:bg-espresso/30"
    >
      <form onSubmit={submit} className="flex flex-col gap-4 p-5" noValidate>
        <h2 id={`${id}-title`} className="flex items-center gap-2 font-newsreader text-2xl font-medium text-ink">
          <Receipt aria-hidden="true" size={22} className="text-gold-text" />
          {t.title}
        </h2>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-concept`} className={label}>
            {t.concept}
          </label>
          <input id={`${id}-concept`} value={concept} maxLength={80} onChange={(e) => setConcept(e.target.value)} className={field} autoComplete="off" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-amount`} className={label}>
              {t.amount}
            </label>
            <input
              id={`${id}-amount`}
              value={amount}
              inputMode="decimal"
              aria-describedby={`${id}-amount-hint`}
              onChange={(e) => setAmount(e.target.value)}
              className={field}
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-day`} className={label}>
              {t.day}
            </label>
            <input id={`${id}-day`} type="date" value={day} onChange={(e) => setDay(e.target.value)} className={field} />
          </div>
        </div>
        <p id={`${id}-amount-hint`} className="-mt-2 font-inter text-sm text-muted">
          {t.amountHint}
        </p>
        <div role="radiogroup" aria-label={t.category} className="flex flex-wrap gap-2">
          {EXPENSE_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={category === c}
              onClick={() => setCategory(c)}
              className={`${CONTROL_BUTTON} normal-case tracking-normal ${category === c ? "bg-section ring-2 ring-gold-text" : ""}`}
            >
              {copy.categories[c]}
            </button>
          ))}
        </div>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 font-inter text-base text-ink">
          <input
            type="checkbox"
            aria-labelledby={`${id}-rec`}
            aria-describedby={`${id}-rec-hint`}
            checked={recurring} onChange={(e) => setRecurring(e.target.checked)}
            className="focus-ring mt-1 h-5 w-5 accent-[var(--gold-text)]"
          />
          <span className="flex flex-col">
            <span id={`${id}-rec`} className="font-semibold">
              {t.recurring}
            </span>
            <span id={`${id}-rec-hint`} className="text-sm text-muted">
              {t.recurringHint}
            </span>
          </span>
        </label>
        {error && (
          <p role="alert" className="m-0 font-inter text-base font-semibold text-light-text">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => closeDialog(ref.current)} className={CONTROL_BUTTON}>
            {t.cancel}
          </button>
          <button type="submit" disabled={busy} className={PRIMARY_BUTTON} style={GOLD_GRADIENT}>
            {busy ? t.saving : t.save}
          </button>
        </div>
      </form>
    </dialog>
  );
}
