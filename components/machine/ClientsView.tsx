"use client";

import { useEffect, useState } from "react";
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
}: {
  active: boolean;
  shop: MachineShop;
  lang: Lang;
  copy: MachineCopy;
  onLocked: () => void;
}) {
  const [book, setBook] = useState<ClientsResponse | null>(null);
  const [failed, setFailed] = useState(false);

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
            <ul aria-label={c.label} className="flex flex-col gap-3">
              {book.clients.map((client) => (
                <ClientCard
                  key={client.id}
                  client={client}
                  shop={shop}
                  lang={lang}
                  copy={copy}
                  onBook={setBook}
                  onLocked={onLocked}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
