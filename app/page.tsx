export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-bg px-6 py-24">
      <main className="flex w-full max-w-2xl flex-col items-center text-center">
        {/* Eyebrow */}
        <p className="mb-6 flex items-center gap-2 font-inter text-xs uppercase tracking-[0.18em] text-muted">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full bg-gold-dot"
            aria-hidden="true"
          />
          KIROWEEN 2026
        </p>

        {/* Heading */}
        <h1 className="font-newsreader text-6xl font-medium tracking-tight text-ink sm:text-7xl">
          Phantom Line
        </h1>

        {/* Tagline — one line, gold phrase */}
        <p className="mt-6 font-inter text-xl text-text">
          The phone rang for weeks, but{" "}
          <span className="text-gold-text">nobody answered</span>.
        </p>
      </main>
    </div>
  );
}
