"use client";

import { useEffect, useMemo, useState } from "react";
import type { ClientsResponse } from "@/lib/clients/api";
import type { MachineShop } from "@/lib/owner/machineShop";
import type { Lang } from "@/lib/sectors";
import { ClientCard } from "./ClientCard";
import { getClients } from "./clientApi";
import { LapsedList } from "./LapsedList";
import type { MachineCopy } from "./machineCopy";

/**
 * The Clientes tab (BACKLOG 14, 15): the customer book and "Clientes que no han vuelto". It is
 * read on demand each time the tab opens (never with the Poll), so personal data only travels
 * when the Owner asks for it, behind the same session cookie as every Machine_API route.
 */
export function ClientsView({
  active,
  shop,
  lang,
  copy,
  onLocked,
  focusClientId = null,
  onFocusDone,
}: {
  active: boolean;
  shop: MachineShop;
  lang: Lang;
  copy: MachineCopy;
  onLocked: () => void;
  /** A client whose card should open (from a booking's "Ver ficha"). */
  focusClientId?: string | null;
  onFocusDone?: () => void;
}) {
  const [book, setBook] = useState<ClientsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState<string | null>(null);
  const digits = (t: string) => t.replace(/\D/g, "");
  const target = focusClientId !== null && book?.clients.some((cl) => cl.id === focusClientId) ? focusClientId : null;
  const pendingTarget = target !== null && target !== opened ? target : null;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qd = digits(q);
    if (book === null || q === "" || pendingTarget !== null) return book?.clients ?? [];
    return book.clients.filter((cl) => cl.name.toLowerCase().includes(q) || (qd !== "" && digits(cl.phone).includes(qd)));
  }, [book, query, pendingTarget]);

  useEffect(() => {
    if (!active) return;
    let live = true;
    void getClients(shop.id).then((a) => {
      if (!live) return;
      if (a.ok) {
        setBook(a.body);
        setFailed(false);
      } else if (a.status === 401) onLocked();
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [active, shop.id, onLocked]);

  if (!active) return null;
  const c = copy.clients;
  return (
    <div className="flex flex-col gap-6">
      <h2 className="sr-only">{c.label}</h2>
      {book === null ? (
        <p role="status" className="font-inter text-base text-muted">
          {failed ? c.failed : c.loading}
        </p>
      ) : (
        <>
          {failed && <p className="font-inter text-sm font-semibold text-muted">{c.failed}</p>}
          <LapsedList lapsed={book.lapsed} copy={copy} />
          {book.clients.length === 0 ? (
            <p className="font-inter text-base text-text">{c.empty}</p>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <label htmlFor="clients-search" className="font-inter text-base font-semibold text-ink">
                  {c.search}
                </label>
                <input
                  id="clients-search"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="focus-ring min-h-11 w-full rounded-[14px] border border-border bg-section px-3 font-inter text-base text-ink"
                />
              </div>
              {shown.length === 0 && <p className="font-inter text-base text-text">{c.noMatches}</p>}
              <ul aria-label={c.label} className="flex flex-col gap-3">
                {shown.map((client) => (
                  <ClientCard
                    key={client.id}
                    client={client}
                    shop={shop}
                    lang={lang}
                    copy={copy}
                    onBook={setBook}
                    onLocked={onLocked}
                    autoOpen={client.id === pendingTarget}
                    onOpened={() => {
                      setOpened(client.id);
                      setQuery("");
                      onFocusDone?.();
                    }}
                  />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
