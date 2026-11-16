/**
 * Two espresso tape reels with gold hubs (owner-machine 6.2, 6.5). They turn only while a
 * Message plays, and never with reduced motion (13.4): the spin class is simply not there.
 * Decorative, so `aria-hidden`.
 */
export function TapeReels({ spinning }: { spinning: boolean }) {
  return (
    <div data-reels={spinning ? "spinning" : "still"} aria-hidden="true" className="relative flex items-center gap-6">
      <Reel spinning={spinning} />
      <span className="absolute left-7 right-7 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-espresso/70" />
      <Reel spinning={spinning} />
    </div>
  );
}

function Reel({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width="56"
      height="56"
      className={`relative z-10 shrink-0 ${spinning ? "reel-spin" : ""}`}
      focusable="false"
    >
      <circle cx="32" cy="32" r="30" fill="var(--espresso)" />
      <circle cx="32" cy="32" r="22" fill="none" stroke="var(--gold-dot)" strokeOpacity="0.35" strokeWidth="1" />
      {[0, 120, 240].map((deg) => (
        <circle
          key={deg}
          cx={32 + 15 * Math.cos((deg * Math.PI) / 180)}
          cy={32 + 15 * Math.sin((deg * Math.PI) / 180)}
          r="5"
          fill="var(--section)"
        />
      ))}
      <circle cx="32" cy="32" r="8" fill="var(--gold-dot)" />
      <circle cx="32" cy="32" r="2.5" fill="var(--espresso)" />
    </svg>
  );
}
