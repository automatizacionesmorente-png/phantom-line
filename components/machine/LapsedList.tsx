import type { ClientsResponse } from "@/lib/clients/api";
import { ROW_BUTTON } from "./controlButton";
import type { MachineCopy } from "./machineCopy";

/**
 * "Clientes que no han vuelto" (BACKLOG 15): the list the server decided, each with the suggested
 * text in the client's own language and a one-tap wa.me link. The page never decides who is listed.
 */
export function LapsedList({ lapsed, copy }: { lapsed: ClientsResponse["lapsed"]; copy: MachineCopy }) {
  const c = copy.clients;
  return (
    <section aria-labelledby="lapsed-heading" className="flex flex-col gap-3">
      <div>
        <h3 id="lapsed-heading" className="font-newsreader text-xl font-medium text-ink">
          {c.lapsedTitle}
        </h3>
        <p className="font-inter text-sm text-muted">{c.lapsedHint}</p>
      </div>
      {lapsed.length === 0 ? (
        <p className="font-inter text-base text-text">{c.lapsedNone}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {lapsed.map((l) => (
            <li key={l.clientId} data-lapsed={l.clientId} className="flex flex-col gap-2 rounded-[18px] border border-border bg-card p-3.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-inter text-base font-semibold text-ink break-words">{l.name}</span>
                <span className="font-inter text-sm text-muted">{c.lapsedLine(l.daysSince, l.thresholdDays)}</span>
              </div>
              <p className="font-inter text-xs uppercase tracking-[0.18em] text-muted">{c.suggested}</p>
              <p lang={l.language} className="font-caveat text-2xl leading-snug text-text">
                {l.text}
              </p>
              <a
                href={l.whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`${ROW_BUTTON} self-start`}
              >
                {c.whatsapp(l.name)}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
