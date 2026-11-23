import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { DemoNotice } from "@/components/machine/DemoNotice";
import { MACHINE_COPY } from "@/components/machine/machineCopy";
import { MachineScreen } from "@/components/machine/MachineScreen";
import { PinGate } from "@/components/machine/PinGate";
import type { GateShop } from "@/lib/owner/machineShop";
import { SESSION_COOKIE } from "@/lib/owner/session";
import { loadMachine } from "./loadMachine";

/**
 * Server, inside <Suspense>: params, the session cookie, then the shop (owner-machine 1.1,
 * 1.2, 1.6, 1.7). Unknown shop → the Call_Page's not-found block; no PIN → "not set up yet";
 * no valid session → the PIN_Gate with the shop name only; valid → the machine with its
 * first snapshot, after the Demo_Shop's retention (16.6).
 */
export async function MachineGate({ params }: { params: PageProps<"/machine/[shopId]">["params"] }) {
  const { shopId } = await params;
  const id = safeDecode(shopId);
  if (id === null) notFound();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const view = await loadMachine(id, token);
  switch (view.kind) {
    case "not_found":
      return notFound();
    case "no_pin":
      return <NotSetUp shop={view.shop} />;
    case "gate":
      return <PinGate shop={view.shop} />;
    case "machine":
      return <MachineScreen shop={view.shop} initial={view.initial} label={view.label} />;
  }
}

/** A malformed escape in the URL is an unknown shop, not a server error (as on the Call_Page). */
function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** 1.7: the machine has no PIN yet, so there is no form to fill in. */
function NotSetUp({ shop }: { shop: GateShop }) {
  const lang = shop.languages[0] ?? "es";
  const copy = MACHINE_COPY[lang];
  return (
    <section lang={lang} className="flex flex-col items-center gap-4 py-16 text-center">
      <h1 className="font-newsreader text-4xl font-medium tracking-tight text-ink break-words">
        {copy.gate.headingBefore} <span className="text-gold">{shop.name}</span>
      </h1>
      {shop.demo && <DemoNotice lang={lang} />}
      <p className="font-inter text-lg text-text">{copy.gate.notSetUp}</p>
      <p className="font-inter text-base text-muted">{copy.gate.notSetUpHint}</p>
    </section>
  );
}
