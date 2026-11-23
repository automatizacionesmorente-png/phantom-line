import type { Lang } from "@/lib/conversation/types";

export const DEMO_PIN = "198000";
export const GUIDE_STORAGE_KEY = "pl:guide-dismissed";

export interface GuideCopy {
  title: string;
  steps: [string, string, string];
  dismiss: string;
  stepOf: (n: number) => string;
}

/** "Try it in 30 seconds": the judge's three steps, in both languages. */
export const GUIDE_COPY: Record<Lang, GuideCopy> = {
  es: {
    title: "Pruébalo en 30 segundos",
    steps: ["Llama y reserva una cita", `Abre el contestador con el PIN ${DEMO_PIN}`, "Mira cómo parpadea con tu mensaje"],
    dismiss: "Cerrar la guía",
    stepOf: (n) => `Paso ${n} de 3`,
  },
  en: {
    title: "Try it in 30 seconds",
    steps: ["Call and book an appointment", `Open the machine with PIN ${DEMO_PIN}`, "Watch it blink with your message"],
    dismiss: "Close the guide",
    stepOf: (n) => `Step ${n} of 3`,
  },
};
