import type { Lang } from "@/lib/conversation/types";

/**
 * Every word of the /startup page, in ES and EN. Pricing is PLANNED and said so; roadmap items are
 * marked as roadmap; only what is built is promised (browser voice calls ES/EN, bookings with real
 * rules, the owner's answering machine with PIN, sector packs). Figures come from docs/impact.md.
 */
export interface StartupCopy {
  nav: { back: string; langLabel: string };
  cta: { label: string; hint: string };
  eyebrow: string;
  title: [string, string];
  lead: string;
  founder: string;
  problem: { heading: string; intro: string; stats: { value: string; text: string }[]; sources: { label: string; href: string }[]; note: string };
  how: { heading: string; steps: { title: string; text: string }[] };
  built: { heading: string; items: string[]; roadmapHeading: string; roadmapTag: string; roadmap: string[] };
  pricing: {
    heading: string;
    planned: string;
    tiers: { name: string; price: string; period: string; items: string[] }[];
    basis: string;
  };
  form: {
    heading: string;
    intro: string;
    shopName: string;
    city: string;
    email: string;
    consent: string;
    privacy: string;
    submit: string;
    sending: string;
    thanks: string;
    errors: { invalid: string; consent: string; rateLimited: string; unavailable: string };
  };
}

export const COPY: Record<Lang, StartupCopy> = {
  en: {
    nav: { back: "Back to the demo", langLabel: "Language" },
    cta: { label: "Create your own receptionist", hint: "Free trial in a few minutes. The trial shop is deleted after 7 days." },
    eyebrow: "Phantom Line for salons",
    title: ["The phone rings while your hands are ", "full of hair"],
    lead: "An AI receptionist that answers your calls, books the appointment with your real rules, and leaves you a message on a haunted ivory answering machine.",
    founder: "Founded by Miguel Morente, student at UFV Madrid",
    problem: {
      heading: "The problem: calls nobody answers",
      intro: "A hairdresser cannot pick up with scissors in one hand and a client in the chair. Public surveys show what happens next.",
      stats: [
        { value: "78%", text: "of US consumers surveyed say they have abandoned a business after an unanswered call (CallRail survey of 1,000 consumers, 2025)." },
        { value: "69%", text: "of callers who reached voicemail hung up without leaving a message (Moneypenny survey of UK micro businesses, 2016)." },
        { value: "33,882", text: "hairdressing and barber companies in Spain in 2024 (einforma sector database, CNAE 9621)." },
      ],
      sources: [
        { label: "CallRail", href: "https://www.callrail.com/blog/missed-calls-cost-businesses-more-than-ever" },
        { label: "Moneypenny", href: "https://www.moneypenny.com/uk/resources/news/small-business-call-report/" },
        { label: "einforma", href: "https://www.einforma.com/informes-sectoriales/cnae-9621-empresas-peluquerias-y-barberias" },
      ],
      note: "The first two are vendor surveys and are not specific to salons. We found no verified salon-only figure, so we show none.",
    },
    how: {
      heading: "How it works",
      steps: [
        { title: "A client calls", text: "They talk to the receptionist in Spanish or English, from the browser. It answers only from your shop profile: services, prices, hours." },
        { title: "It books with your rules", text: "Opening hours, service length and your chairs are checked by code, never by the AI, so two clients can never get the same slot." },
        { title: "You see it on the machine", text: "The red light blinks. Open the answering machine with your PIN, read each message, confirm, move or cancel the booking." },
      ],
    },
    built: {
      heading: "What exists today",
      items: [
        "Voice calls in the browser, in Spanish and English.",
        "Bookings with real rules: hours, service duration, one booking per chair.",
        "The owner's answering-machine screen, protected by a PIN.",
        "Sector packs: the hair salon pack is the first.",
        "Self-service trial setup: your own receptionist in a few minutes.",
      ],
      roadmapHeading: "Roadmap",
      roadmapTag: "Roadmap, not built yet",
      roadmap: ["A real phone number for your shop.", "WhatsApp as a second channel.", "A customer book and win-back messages."],
    },
    pricing: {
      heading: "Planned pricing",
      planned: "Planned pricing. Nothing is charged today: the demo is free and these tiers are not on sale yet.",
      tiers: [
        { name: "Free", price: "0 EUR", period: "per month", items: ["1 shop", "Up to 30 calls a month", "Browser voice"] },
        { name: "Salon", price: "29 EUR", period: "per month, per shop", items: ["Up to 300 calls a month", "Natural neural voice", "Answering machine with PIN", "Bookings with your rules"] },
      ],
      basis: "Cost basis: about 0.04 USD per call and about 35 USD a month of shared hosting for all shops, from the public prices in docs/impact.md. 300 calls cost us about 12 USD.",
    },
    form: {
      heading: "Join the waitlist",
      intro: "Tell us about your shop and we will write to you when the Salon plan opens.",
      shopName: "Shop name",
      city: "City",
      email: "Email",
      consent: "I agree that Phantom Line stores my shop name, city and email to contact me about the launch.",
      privacy: "We use these three fields only to write to you about Phantom Line. Nobody else sees them and they are never shown publicly. Ask us to delete them any time.",
      submit: "Join the waitlist",
      sending: "Sending...",
      thanks: "Thank you. You are on the list.",
      errors: {
        invalid: "Please check the shop name, city and email.",
        consent: "Please tick the consent box to join.",
        rateLimited: "Too many attempts. Please try again later.",
        unavailable: "Something went wrong. Please try again.",
      },
    },
  },
  es: {
    nav: { back: "Volver a la demo", langLabel: "Idioma" },
    cta: { label: "Crea tu propia recepcionista", hint: "Prueba gratis en unos minutos. El negocio de prueba se borra a los 7 días." },
    eyebrow: "Phantom Line para peluquerías",
    title: ["Suena el teléfono y tienes las manos ", "llenas de pelo"],
    lead: "Una recepcionista con IA que contesta tus llamadas, reserva la cita con tus reglas reales y te deja un mensaje en un contestador de marfil y oro.",
    founder: "Fundada por Miguel Morente, estudiante de la UFV de Madrid",
    problem: {
      heading: "El problema: llamadas que nadie contesta",
      intro: "Una peluquera no puede coger el teléfono con las tijeras en una mano y una clienta en la silla. Las encuestas públicas muestran qué pasa después.",
      stats: [
        { value: "78%", text: "de los consumidores de EE. UU. encuestados dicen haber dejado un negocio tras una llamada sin respuesta (encuesta de CallRail a 1.000 consumidores, 2025)." },
        { value: "69%", text: "de quienes llegaron al buzón de voz colgaron sin dejar mensaje (encuesta de Moneypenny a microempresas del Reino Unido, 2016)." },
        { value: "33.882", text: "empresas de peluquería y barbería en España en 2024 (base sectorial de einforma, CNAE 9621)." },
      ],
      sources: [
        { label: "CallRail", href: "https://www.callrail.com/blog/missed-calls-cost-businesses-more-than-ever" },
        { label: "Moneypenny", href: "https://www.moneypenny.com/uk/resources/news/small-business-call-report/" },
        { label: "einforma", href: "https://www.einforma.com/informes-sectoriales/cnae-9621-empresas-peluquerias-y-barberias" },
      ],
      note: "Las dos primeras son encuestas de empresas del sector y no son específicas de peluquerías. No hemos encontrado una cifra verificada solo de peluquerías, así que no mostramos ninguna.",
    },
    how: {
      heading: "Cómo funciona",
      steps: [
        { title: "Un cliente llama", text: "Habla con la recepcionista en español o inglés, desde el navegador. Responde solo con el perfil de tu local: servicios, precios, horario." },
        { title: "Reserva con tus reglas", text: "El horario, la duración del servicio y tus sillones los comprueba el código, nunca la IA, así que dos clientes no pueden tener el mismo hueco." },
        { title: "Lo ves en el contestador", text: "La luz roja parpadea. Abre el contestador con tu PIN, lee cada mensaje y confirma, mueve o cancela la cita." },
      ],
    },
    built: {
      heading: "Lo que existe hoy",
      items: [
        "Llamadas de voz en el navegador, en español e inglés.",
        "Reservas con reglas reales: horario, duración del servicio, una reserva por sillón.",
        "La pantalla del contestador del dueño, protegida con PIN.",
        "Paquetes por sector: el de peluquería es el primero.",
        "Alta de prueba sin ayuda: tu propia recepcionista en pocos minutos.",
      ],
      roadmapHeading: "Hoja de ruta",
      roadmapTag: "Hoja de ruta, aún no existe",
      roadmap: ["Un número de teléfono real para tu local.", "WhatsApp como segundo canal.", "Un libro de clientes y mensajes para recuperarlos."],
    },
    pricing: {
      heading: "Precios previstos",
      planned: "Precios previstos. Hoy no se cobra nada: la demo es gratis y estos planes aún no están a la venta.",
      tiers: [
        { name: "Gratis", price: "0 EUR", period: "al mes", items: ["1 local", "Hasta 30 llamadas al mes", "Voz del navegador"] },
        { name: "Salón", price: "29 EUR", period: "al mes, por local", items: ["Hasta 300 llamadas al mes", "Voz neuronal natural", "Contestador con PIN", "Reservas con tus reglas"] },
      ],
      basis: "Base de coste: unos 0,04 USD por llamada y unos 35 USD al mes de alojamiento compartido para todos los locales, con precios públicos en docs/impact.md. 300 llamadas nos cuestan unos 12 USD.",
    },
    form: {
      heading: "Apúntate a la lista de espera",
      intro: "Cuéntanos de tu local y te escribiremos cuando se abra el plan Salón.",
      shopName: "Nombre del local",
      city: "Ciudad",
      email: "Correo electrónico",
      consent: "Acepto que Phantom Line guarde el nombre de mi local, mi ciudad y mi correo para contactarme sobre el lanzamiento.",
      privacy: "Usamos estos tres datos solo para escribirte sobre Phantom Line. Nadie más los ve y nunca se muestran en público. Puedes pedirnos que los borremos cuando quieras.",
      submit: "Apuntarme a la lista",
      sending: "Enviando...",
      thanks: "Gracias. Ya estás en la lista.",
      errors: {
        invalid: "Revisa el nombre del local, la ciudad y el correo.",
        consent: "Marca la casilla de consentimiento para apuntarte.",
        rateLimited: "Demasiados intentos. Inténtalo más tarde.",
        unavailable: "Algo ha fallado. Inténtalo de nuevo.",
      },
    },
  },
};

/** The browser language picks the page language once; anything but Spanish is English. */
export const langFromBrowser = (language: string | undefined): Lang => (language?.toLowerCase().startsWith("es") ? "es" : "en");
