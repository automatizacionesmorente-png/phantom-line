import { Suspense } from "react";
import { CallScreen } from "@/components/call/CallScreen";
import { loadPublicShop } from "./loadPublicShop";

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
  if (!shop) return <ShopNotFound />;
  return <CallScreen shop={shop} />;
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

/** Requirement 1.9: a message and no Call button. */
function ShopNotFound() {
  return (
    <section className="flex flex-col items-center gap-4 py-16 text-center">
      <h1 className="font-newsreader text-4xl font-medium tracking-tight text-ink">
        <span lang="es">
          Este número <span className="text-gold">no existe</span>
        </span>
      </h1>
      <p lang="es" className="font-inter text-lg text-text">
        No encontramos esta tienda. Revisa el enlace que te han dado.
      </p>
      <p lang="en" className="font-inter text-lg text-text">
        Shop not found. Please check the link you were given.
      </p>
    </section>
  );
}
