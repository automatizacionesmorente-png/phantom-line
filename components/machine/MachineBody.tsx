import type { ReactNode } from "react";

/**
 * The ivory bakelite body of the machine (owner-machine 6.2): 28 px radius, a gold hairline
 * trim, a soft brown translucent shadow, and a faint tape-hiss grain (opacity 0.04).
 */
export function MachineBody({ children, slim = false }: { children: ReactNode; slim?: boolean }) {
  return (
    <div className={`machine-grain w-full rounded-[28px] border border-gold-dot bg-section shadow-[0_18px_40px_rgb(36_29_20/0.14)] ${slim ? "p-3 sm:p-4" : "p-4 sm:p-7"}`}>
      <div className="pointer-events-none absolute inset-1.5 rounded-[23px] border border-gold-dot/40" aria-hidden="true" />
      <div className={`relative flex flex-col ${slim ? "gap-3" : "gap-5"}`}>{children}</div>
    </div>
  );
}
