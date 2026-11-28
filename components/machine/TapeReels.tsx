/**
 * Two espresso tape reels with gold hubs (owner-machine 6.2, 6.5). They turn only while a
 * Message plays, and never with reduced motion (13.4): the spin class is simply not there.
 * Decorative, so `aria-hidden`.
 */
export function TapeReels({ spinning, small = false }: { spinning: boolean; small?: boolean }) {
  return (
    <div data-reels={spinning ? "spinning" : "still"} aria-hidden="true" className={`relative flex items-center ${small ? "gap-2" : "gap-6"}`}>
      <Reel spinning={spinning} size={small ? 28 : 56} />
      <span className={`absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-espresso/70 ${small ? "left-3.5 right-3.5" : "left-7 right-7 h-1.5"}`} />
      <Reel spinning={spinning} size={small ? 28 : 56} />
    </div>
  );
}

function Reel({ spinning, size }: { spinning: boolean; size: number }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
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
