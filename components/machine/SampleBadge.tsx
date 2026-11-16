/** "Sample" / "Ejemplo" on a Sample_Message, on its card and while it plays (owner-machine 7.12). */
export function SampleBadge({ label }: { label: string }) {
  return (
    <span
      data-sample=""
      className="inline-flex items-center rounded-full bg-espresso px-2.5 py-0.5 font-inter text-xs font-semibold uppercase tracking-[0.12em] text-card"
    >
      {label}
    </span>
  );
}
