"use client";

/** The database (or the shop lookup) is down: say so kindly and offer to try again. */
export default function CallError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center bg-bg px-4 py-16 sm:px-6">
      <main className="flex w-full max-w-xl flex-col items-center gap-4 text-center">
        <h1 className="font-newsreader text-4xl font-medium tracking-tight text-ink">
          <span lang="es">
            La línea está <span className="text-gold">en silencio</span>
          </span>
        </h1>
        <p lang="es" className="font-inter text-lg text-text">
          La línea no está disponible ahora mismo. Vuelve a intentarlo en unos minutos.
        </p>
        <p lang="en" className="font-inter text-lg text-text">
          The line is not available right now. Please try again in a few minutes.
        </p>
        <button
          type="button"
          onClick={() => retry()}
          className="mt-2 inline-flex min-h-12 items-center gap-2 rounded-full border-2 border-ink bg-card px-6 font-inter text-base font-semibold text-ink hover:bg-section"
        >
          <span lang="es">Reintentar</span> / <span lang="en">Try again</span>
        </button>
      </main>
    </div>
  );
}
