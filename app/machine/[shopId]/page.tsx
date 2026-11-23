import type { Metadata } from "next";
import { Suspense } from "react";
import { machineTitle, notFoundTitle } from "@/lib/seo/titles";
import { loadPublicShop } from "../../call/[shopId]/loadPublicShop";
import { MachineGate } from "./MachineGate";

/** "Contestador · Phantom Line" in the shop's first language; the lookup is the Call_Page's cached public one. */
export async function generateMetadata({ params }: PageProps<"/machine/[shopId]">): Promise<Metadata> {
  try {
    const { shopId } = await params;
    let id: string;
    try {
      id = decodeURIComponent(shopId);
    } catch {
      return { title: notFoundTitle() };
    }
    const shop = await loadPublicShop(id);
    if (shop?.trial) return { title: machineTitle(shop.languages[0] ?? "es"), robots: { index: false, follow: false } };
    return { title: shop ? machineTitle(shop.languages[0] ?? "es") : notFoundTitle() };
  } catch {
    return {};
  }
}

/**
 * The Owner's answering machine. The shell is static; `params`, the session cookie and the
 * shop lookup are request data under Cache Components, so they sit inside <Suspense>, as on
 * the Call_Page. Nothing personal is cached (14.6).
 */
export default function MachinePage({ params }: PageProps<"/machine/[shopId]">) {
  return (
    <div className="flex flex-1 flex-col items-center bg-bg px-3 py-6 sm:px-6 sm:py-12">
      <main className="flex w-full max-w-3xl flex-col items-center">
        <Suspense fallback={<MachineFallback />}>
          <MachineGate params={params} />
        </Suspense>
      </main>
    </div>
  );
}

function MachineFallback() {
  return (
    <p className="py-24 font-inter text-base text-muted">
      <span lang="es">Rebobinando la cinta…</span> / <span lang="en">Rewinding the tape…</span>
    </p>
  );
}
