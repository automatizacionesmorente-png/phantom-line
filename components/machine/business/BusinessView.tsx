"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Download, Printer } from "lucide-react";
import { Temporal } from "temporal-polyfill";
import { resourceName, serviceName, type MachineShop } from "@/lib/owner/machineShop";
import type { ExpensesResponse, MonthResponse } from "@/lib/salon/api";
import { addMonths, monthOf } from "@/lib/salon/month";
import type { Lang } from "@/lib/sectors";
import { CONTROL_BUTTON, GOLD_GRADIENT, PRIMARY_BUTTON } from "../controlButton";
import { deleteExpense, exportUrl, getExpenses, getMonth } from "../salonApi";
import { formatDuration, formatRevenue } from "../weekCopy";
import { Bars } from "./Bars";
import { BUSINESS_COPY, monthLabel, weekRangeLabel, type BusinessCopy } from "./businessCopy";
import { ExpenseDialog } from "./ExpenseDialog";
import { ExpensesList } from "./ExpensesList";
import { MonthHeader } from "./MonthHeader";

const RETRY_MS = 20_000;
const MONTHS_BACK = 24;
const MONTHS_AHEAD = 1;

type Tone = "good" | "bad";

function Big({
  id,
  label,
  cents,
  pct,
  upIs,
  lang,
  copy,
  formula,
}: {
  id: "taken" | "expenses" | "left";
  label: string;
  cents: number;
  pct: number | null | undefined;
  /** Whether a rise is good news (takings, what is left) or bad (expenses). */
  upIs: Tone;
  lang: Lang;
  copy: BusinessCopy;
  formula: string;
}) {
  let delta: { arrow: string; text: string; cls: string } | null = null;
  if (typeof pct === "number") {
    const up = pct > 0;
    const good = pct === 0 ? null : up === (upIs === "good");
    delta = {
      arrow: pct === 0 ? "=" : up ? "▲" : "▼",
      text: pct === 0 ? copy.same : up ? copy.moreThan(pct) : copy.lessThan(Math.abs(pct)),
      cls: good === null ? "text-muted" : good ? "text-gold-text" : "text-light-text",
    };
  }
  return (
    <div data-testid={`big-${id}`} title={formula} className="flex min-w-0 flex-col gap-1 rounded-2xl border border-border bg-card px-3 py-3">
      <span className="font-inter text-sm text-muted">{label}</span>
      <span className="font-newsreader text-3xl leading-none text-ink">{formatRevenue(cents, lang)}</span>
      {delta && (
        <span className={`font-inter text-xs font-semibold leading-snug ${delta.cls}`}>
          <span aria-hidden="true">{delta.arrow} </span>
          {delta.text}
        </span>
      )}
    </div>
  );
}

function Stat({ label, value, formula, testId }: { label: string; value: string; formula: string; testId?: string }) {
  return (
    <div data-testid={testId} title={formula} className="pl-card flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
      <dt className="font-inter text-xs text-muted">{label}</dt>
      <dd className="m-0 font-newsreader pl-num text-2xl font-medium tracking-tight text-ink">{value}</dd>
    </div>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section aria-label={title} className="flex flex-col gap-2">
    <h3 className="pl-heading m-0 font-newsreader text-xl font-medium tracking-tight text-ink">{title}</h3>
    {children}
  </section>
);

/**
 * "My business" (salon spec 2.3): the month's three numbers against the last month, what the
 * receptionist did (only real, attributable figures; gaps refilled only above 0), takings by week,
 * by worker, top services, no-shows, the expenses with "+ Gasto", and "Para la gestoría" (CSV
 * download and a printable page). Money comes in cents and leaves as euros.
 */
export function BusinessView({
  shop,
  lang,
  active,
  now,
  refreshKey,
  onLocked,
}: {
  shop: MachineShop;
  lang: Lang;
  active: boolean;
  now: string;
  /** Changes when the machine's data changed (the Poll's version): the month is read again. */
  refreshKey: number;
  onLocked: () => void;
}) {
  const copy = BUSINESS_COPY[lang];
  const headingId = useId();
  const nowInstant = Temporal.Instant.from(now);
  const current = monthOf(nowInstant, shop.timeZone);
  const today = nowInstant.toZonedDateTimeISO(shop.timeZone).toPlainDate().toString();
  const [picked, setPicked] = useState<string | null>(null);
  const month = picked ?? current;
  const [report, setReport] = useState<MonthResponse | null>(null);
  const [expenses, setExpenses] = useState<ExpensesResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [adding, setAdding] = useState(false);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!active) return;
    let live = true;
    let retry: number | undefined;
    void Promise.all([getMonth(shop.id, month), getExpenses(shop.id, month)]).then(([m, e]) => {
      if (!live) return;
      if (m.status === 401 || e.status === 401) return onLocked();
      if (!m.ok || !e.ok) {
        setFailed(true);
        retry = window.setTimeout(reload, RETRY_MS);
        return;
      }
      setFailed(false);
      setReport(m.body);
      setExpenses(e.body);
    });
    return () => {
      live = false;
      window.clearTimeout(retry);
    };
  }, [active, shop.id, month, refreshKey, tick, onLocked, reload]);

  async function remove(id: string): Promise<boolean> {
    const a = await deleteExpense(shop.id, id);
    if (a.status === 401) onLocked();
    if (a.ok) reload();
    return a.ok;
  }

  function print() {
    const done = () => {
      delete document.body.dataset.print;
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    document.body.dataset.print = "business";
    window.print();
  }

  const ready = report !== null && report.month === month && expenses !== null && expenses.month === month;
  const r = report?.receptionist;
  const empty = ready && report.takenCents === 0 && report.expensesCents === 0;

  return (
    <section aria-labelledby={headingId} data-print-area="" className="flex flex-col gap-4">
      <h2 id={headingId} className="font-newsreader text-2xl text-ink print:hidden">
        {copy.title}
      </h2>
      <p className="m-0 hidden font-newsreader text-2xl text-ink print:block">{copy.accountant.printTitle(shop.name, monthLabel(month, lang))}</p>
      <MonthHeader
        month={month}
        lang={lang}
        copy={copy}
        canPrev={month > addMonths(current, -MONTHS_BACK)}
        canNext={month < addMonths(current, MONTHS_AHEAD)}
        onPrev={() => setPicked(addMonths(month, -1))}
        onNext={() => setPicked(addMonths(month, 1))}
      />

      {failed && <p className="m-0 font-inter text-sm font-semibold text-muted">{copy.failed}</p>}
      {!ready && !failed && <p className="m-0 font-inter text-sm text-muted">{copy.loading}</p>}

      {ready && report && r && expenses && (
        <>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <Big id="taken" label={copy.big.taken} cents={report.takenCents} pct={report.deltaPct?.taken} upIs="good" lang={lang} copy={copy} formula={copy.takenFormula} />
            <Big id="expenses" label={copy.big.expenses} cents={report.expensesCents} pct={report.deltaPct?.expenses} upIs="bad" lang={lang} copy={copy} formula={copy.expensesFormula} />
            <Big id="left" label={copy.big.left} cents={report.leftCents} pct={report.deltaPct?.left} upIs="good" lang={lang} copy={copy} formula={copy.leftFormula} />
          </div>
          {empty && <p className="m-0 font-inter text-sm text-muted">{copy.empty}</p>}

          <section aria-labelledby={`${headingId}-rec`} className="flex flex-col gap-2 rounded-2xl border border-gold-dot bg-section px-3 py-3">
            <h3 id={`${headingId}-rec`} className="m-0 font-newsreader text-xl font-medium tracking-tight text-ink">
              {copy.receptionist.title}
            </h3>
            <dl className="m-0 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label={copy.receptionist.calls} value={String(r.calls)} formula={copy.receptionist.callsFormula} />
              <Stat label={copy.receptionist.booked} value={String(r.booked)} formula={copy.receptionist.bookedFormula} />
              <Stat label={copy.receptionist.value} value={formatRevenue(r.bookedValueCents, lang)} formula={copy.receptionist.valueFormula} />
              {r.phoneSeconds > 0 && (
                <Stat
                  label={copy.receptionist.phone}
                  value={formatDuration(r.phoneSeconds, lang)}
                  formula={copy.receptionist.phoneFormula(r.calls, formatDuration(r.phoneSeconds, lang))}
                />
              )}
              {r.gapsRefilled > 0 && (
                <Stat testId="gaps-refilled" label={copy.receptionist.gaps} value={String(r.gapsRefilled)} formula={copy.receptionist.gapsFormula} />
              )}
            </dl>
          </section>

          <Section title={copy.weeks}>
            <Bars
              label={copy.weeks}
              title={copy.weeksFormula}
              items={report.weeks.map((w) => ({ key: w.label, label: weekRangeLabel(w.label, month, lang), cents: w.takenCents, valueText: formatRevenue(w.takenCents, lang) }))}
            />
          </Section>

          {report.byWorker.length > 0 && (
            <Section title={copy.workers}>
              <Bars
                label={copy.workers}
                items={report.byWorker.map((w) => ({
                  key: w.resourceId,
                  label: resourceName(shop, w.resourceId, lang),
                  cents: w.takenCents,
                  valueText: formatRevenue(w.takenCents, lang),
                }))}
              />
            </Section>
          )}

          {report.topServices.length > 0 && (
            <Section title={copy.services}>
              <Bars
                label={copy.services}
                items={report.topServices.map((s) => ({
                  key: s.serviceId,
                  label: serviceName(shop, s.serviceId, lang),
                  cents: s.takenCents,
                  valueText: formatRevenue(s.takenCents, lang),
                  note: copy.servicesCount(s.count),
                }))}
              />
            </Section>
          )}

          <p title={copy.noShowsFormula} className="m-0 font-inter text-base font-semibold text-ink">
            {copy.noShows(report.noShows)}
          </p>

          <Section title={copy.expenses.title}>
            <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
              <p className="m-0 font-inter text-sm text-muted">{copy.expenses.total(formatRevenue(expenses.totalCents, lang))}</p>
              <button type="button" onClick={() => setAdding(true)} className={PRIMARY_BUTTON} style={GOLD_GRADIENT}>
                {copy.expenses.add}
              </button>
            </div>
            <ExpensesList items={expenses.items} lang={lang} copy={copy} onDelete={remove} />
          </Section>

          <div className="flex flex-col gap-2 print:hidden">
            <div className="flex flex-wrap gap-2">
              <a href={exportUrl(shop.id, month, lang)} download className={CONTROL_BUTTON}>
                <Download aria-hidden="true" size={18} />
                {copy.accountant.download}
              </a>
              <button type="button" onClick={print} className={CONTROL_BUTTON}>
                <Printer aria-hidden="true" size={18} />
                {copy.accountant.print}
              </button>
            </div>
            <p className="m-0 font-inter text-sm text-muted">{copy.accountant.hint}</p>
          </div>
        </>
      )}

      {adding && (
        <ExpenseDialog
          shopId={shop.id}
          copy={copy}
          defaultDay={today.startsWith(month) ? today : `${month}-01`}
          onClose={() => setAdding(false)}
          onSaved={reload}
          onLocked={onLocked}
        />
      )}
    </section>
  );
}
