import Link from "next/link";
import { ArrowRight, Phone } from "lucide-react";
import { TryItGuide } from "@/components/guide/TryItGuide";
import { DemoNotice } from "@/components/machine/DemoNotice";
import { GOLD_GRADIENT, PRIMARY_BUTTON } from "@/components/machine/controlButton";
import { DEMO_SHOP_ID } from "@/lib/owner/demo";

/** The same rule as the seed (owner-machine 2.6): only a 6-digit PIN is ever set, so only one is shown. */
const SIX_DIGITS = /^\d{6}$/;

/**
 * The landing page (owner-machine 3): the two demo links, the demo machine's PIN read from
 * `DEMO_OWNER_PIN` at build time, and the Demo_Notice next to it. Static: no request data,
 * so it prerenders. No PIN set, or not 6 digits, means no PIN line and no placeholder (3.4).
 */
export default function Home() {
  const raw = process.env.DEMO_OWNER_PIN?.trim();
  const pin = raw !== undefined && SIX_DIGITS.test(raw) ? raw : null;
  const demo = encodeURIComponent(DEMO_SHOP_ID);

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-bg px-5 py-16 sm:px-6 sm:py-24">
      <main className="flex w-full max-w-2xl flex-col items-center text-center">
        <p className="mb-6 flex items-center gap-2 font-inter text-xs uppercase tracking-[0.18em] text-muted">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold-dot" aria-hidden="true" />
          KIROWEEN 2026
        </p>

        <h1 className="font-newsreader text-6xl font-medium tracking-tight text-ink sm:text-7xl">Phantom Line</h1>

        <p className="mt-6 font-inter text-xl text-text">
          The phone rang for weeks, but <span className="text-gold-text">nobody answered</span>.
        </p>

        <div className="mt-10 w-full">
          <TryItGuide />
        </div>

        <section
          aria-labelledby="demo-heading"
          className="mt-6 flex w-full flex-col items-center gap-5 rounded-[28px] border border-gold-dot bg-section px-5 py-8 shadow-[0_18px_40px_rgb(36_29_20/0.14)] sm:px-8"
        >
          <h2 id="demo-heading" className="font-newsreader text-3xl font-medium tracking-tight text-ink">
            Try the demo: <span className="text-gold">Peluquería Lola</span>
          </h2>
          <p className="font-inter text-base text-text">
            Call the salon from your browser, then open the owner&apos;s answering machine and watch the light blink.
          </p>

          <div className="flex w-full flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href={`/call/${demo}`} className={PRIMARY_BUTTON} style={GOLD_GRADIENT}>
              <Phone aria-hidden="true" size={20} />
              Call Peluquería Lola
              <ArrowRight aria-hidden="true" size={20} />
            </Link>
            <Link
              href={`/machine/${demo}`}
              className="focus-ring inline-flex min-h-12 items-center justify-center rounded-full border-2 border-ink bg-card px-6 font-inter text-base font-semibold text-ink hover:bg-bg"
            >
              Open the answering machine
            </Link>
          </div>

          {pin !== null && (
            <p className="font-inter text-base text-text">
              Owner PIN:{" "}
              <span data-demo-pin="" className="font-newsreader text-3xl font-medium tracking-[0.2em] text-ink">
                {pin}
              </span>
            </p>
          )}
          <DemoNotice lang="en" />
        </section>

        <p className="mt-8 font-inter text-base text-text">
          Run a salon?{" "}
          <Link href="/startup" className="focus-ring font-semibold text-gold-text underline">
            See Phantom Line for salons
          </Link>
        </p>
      </main>
    </div>
  );
}
