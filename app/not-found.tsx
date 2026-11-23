import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { GOLD_GRADIENT, PRIMARY_BUTTON } from "@/components/machine/controlButton";
import { notFoundTitle } from "@/lib/seo/titles";

export const metadata: Metadata = { title: notFoundTitle() };

/**
 * HTTP 404 in the brand style, ES + EN. Unknown shops reach it through `notFound()` and
 * through the proxy's rewrite; any other unknown URL lands here too.
 */
export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-bg px-5 py-16 sm:px-6">
      <main className="flex w-full max-w-xl flex-col items-center gap-4 text-center">
        <p className="flex items-center gap-2 font-inter text-xs uppercase tracking-[0.18em] text-muted">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold-dot" aria-hidden="true" />
          Phantom Line · 404
        </p>
        <h1 className="font-newsreader text-4xl font-medium tracking-tight text-ink sm:text-5xl">
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
        <Link href="/" className={`${PRIMARY_BUTTON} mt-2`} style={GOLD_GRADIENT}>
          <span lang="es">Volver al inicio</span> / <span lang="en">Back to start</span>
          <ArrowRight aria-hidden="true" size={20} />
        </Link>
      </main>
    </div>
  );
}
