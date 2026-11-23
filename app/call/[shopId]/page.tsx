import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CallScreen } from "@/components/call/CallScreen";
import { isDemoShop } from "@/lib/owner/demo";
import { callTitle, notFoundTitle } from "@/lib/seo/titles";
import { loadPublicShop } from "./loadPublicShop";

/** "Llama a Peluquería Lola · Phantom Line": the shop's name and first language; a lookup failure keeps the default title. */
export async function generateMetadata({ params }: PageProps<"/call/[shopId]">): Promise<Metadata> {
  try {
    const { shopId } = await params;
    const id = safeDecode(shopId);
    const shop = id === null ? null : await loadPublicShop(id);
    return { title: shop ? callTitle(shop.name, shop.languages[0] ?? "es") : notFoundTitle() };
  } catch {
    return {};
  }
}

/**
 * The caller's side. The shell is static; `params` and the shop lookup are
 * runtime data under Cache Components, so they sit inside <Suspense>.
 */
export default function CallPage({ params }: PageProps<"/call/[shopId]">) {
  return (
    <div className="flex flex-1 flex-col items-center bg-bg px-4 py-10 sm:px-6 sm:py-16">
      <main className="flex w-full max-w-xl flex-col items-center">
        <Suspense fallback={<ShopGateFallback />}>
          <ShopGate params={params} />
        </Suspense>
      </main>
    </div>
  );
}

async function ShopGate({ params }: { params: PageProps<"/call/[shopId]">["params"] }) {
  const { shopId } = await params;
  const id = safeDecode(shopId);
  const shop = id === null ? null : await loadPublicShop(id);
  if (!shop) notFound();
  // The Demo_Notice only for the public demo (owner-machine 3.3).
  return <CallScreen shop={shop} demo={isDemoShop(shop.id)} />;
}

/** A malformed escape in the URL is an unknown shop, not a server error. */
function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function ShopGateFallback() {
  return (
    <p role="status" className="py-24 font-inter text-base text-muted">
      <span lang="es">Conectando la línea…</span> / <span lang="en">Connecting the line…</span>
    </p>
  );
}
