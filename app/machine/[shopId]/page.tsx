import { Suspense } from "react";
import { MachineGate } from "./MachineGate";

/**
 * The Owner's answering machine. The shell is static; `params`, the session cookie and the
 * shop lookup are request data under Cache Components, so they sit inside <Suspense>, as on
 * the Call_Page. Nothing personal is cached (14.6).
 */
export default function MachinePage({ params }: PageProps<"/machine/[shopId]">) {
  return (
    <div className="flex flex-1 flex-col items-center bg-bg px-3 py-6 sm:px-6 sm:py-12">
      <main className="flex w-full max-w-3xl flex-col items-center">
        <Suspense fallback={<MachineFallback />}>
          <MachineGate params={params} />
        </Suspense>
      </main>
    </div>
  );
}

function MachineFallback() {
  return (
    <p className="py-24 font-inter text-base text-muted">
      <span lang="es">Rebobinando la cinta…</span> / <span lang="en">Rewinding the tape…</span>
    </p>
  );
}
