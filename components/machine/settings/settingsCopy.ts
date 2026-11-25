import type { Lang } from "@/lib/sectors";
import type { OutboxKind } from "@/lib/salon/settings";

/** The Settings tab's words (salon spec 2.4, 9.7, 9.8). Pure, so tests can read them. */
export interface SettingsCopy {
  title: string;
  loading: string;
  failed: string;
  automations: { title: string; hint: string; label: Record<OutboxKind, string>; explain: Record<OutboxKind, string>; saveFailed: string };
  review: { label: string; hint: string; placeholder: string; save: string; saving: string; saved: string; needsLink: string; invalid: string; needsLinkSwitch: string };
  vat: { label: string; hint: string; invalid: string };
  outbox: {
    title: string;
    count: (n: number) => string;
    empty: string;
    send: string;
    dismiss: string;
    promoNote: string;
    kind: Record<OutboxKind, string>;
    to: (phone: string) => string;
    failed: string;
    gone: string;
  };
}

export const SETTINGS_COPY: Record<Lang, SettingsCopy> = {
  es: {
    title: "Ajustes",
    loading: "Cargando los ajustes…",
    failed: "No se pudieron cargar los ajustes. Lo intento de nuevo.",
    automations: {
      title: "Lo que hace tu recepcionista sola",
      hint: "Ella solo prepara los mensajes; tú los envías con un toque desde tu WhatsApp.",
      label: { reminder: "Recordatorio", review: "Pedir reseña", gap: "Hueco libre", winback: "Recuperar clientes", birthday: "Cumpleaños" },
      explain: {
        reminder: "Avisa a cada cliente el día antes de su cita.",
        review: "Tras la visita, pide una reseña en Google.",
        gap: "Si se cancela una cita cercana, ofrece el hueco a clientes habituales.",
        winback: "Escribe a quien hace tiempo que no viene.",
        birthday: "Felicita el día del cumpleaños con un detalle.",
      },
      saveFailed: "No se pudo guardar el cambio. Prueba otra vez.",
    },
    review: {
      label: "Enlace de reseñas de Google",
      hint: "Pega el enlace de g.page, de Google Maps o de search.google.com.",
      placeholder: "https://g.page/r/…",
      save: "Guardar ajustes",
      saving: "Guardando…",
      saved: "Guardado.",
      needsLink: "Para pedir reseñas hace falta un enlace de Google válido.",
      invalid: "Ese no parece un enlace de reseñas de Google. Usa uno de g.page, Google Maps o search.google.com.",
      needsLinkSwitch: "Pon primero el enlace de Google.",
    },
    vat: { label: "IVA (%)", hint: "Un número entero entre 0 y 30.", invalid: "El IVA debe ser un número entero entre 0 y 30." },
    outbox: {
      title: "Mensajes listos para enviar",
      count: (n) => (n === 1 ? "1 mensaje listo" : `${n} mensajes listos`),
      empty: "No hay mensajes esperando. Cuando haya uno, aparecerá aquí.",
      send: "Enviar por WhatsApp",
      dismiss: "Descartar",
      promoNote: "Promoción: solo para clientes que dieron su consentimiento. El texto termina con «Responde BAJA si no quieres más mensajes.»",
      kind: { reminder: "Recordatorio", review: "Reseña", gap: "Hueco libre", winback: "Recuperar", birthday: "Cumpleaños" },
      to: (phone) => `Para ${phone}`,
      failed: "No se pudo actualizar el mensaje. Prueba otra vez.",
      gone: "Ese mensaje ya estaba gestionado.",
    },
  },
  en: {
    title: "Settings",
    loading: "Loading settings…",
    failed: "Settings could not be loaded. Trying again.",
    automations: {
      title: "What your receptionist does by herself",
      hint: "She only prepares the messages; you send them with one tap from your own WhatsApp.",
      label: { reminder: "Reminder", review: "Ask for a review", gap: "Free slot", winback: "Win clients back", birthday: "Birthday" },
      explain: {
        reminder: "Reminds each client the day before their appointment.",
        review: "After the visit, asks for a Google review.",
        gap: "If a near appointment is cancelled, offers the slot to regulars.",
        winback: "Writes to clients who have not been in for a while.",
        birthday: "Wishes a happy birthday with a little treat.",
      },
      saveFailed: "The change could not be saved. Try again.",
    },
    review: {
      label: "Google review link",
      hint: "Paste the link from g.page, Google Maps or search.google.com.",
      placeholder: "https://g.page/r/…",
      save: "Save settings",
      saving: "Saving…",
      saved: "Saved.",
      needsLink: "Asking for reviews needs a valid Google link.",
      invalid: "That does not look like a Google review link. Use one from g.page, Google Maps or search.google.com.",
      needsLinkSwitch: "Set the Google link first.",
    },
    vat: { label: "VAT (%)", hint: "A whole number from 0 to 30.", invalid: "VAT must be a whole number from 0 to 30." },
    outbox: {
      title: "Messages ready to send",
      count: (n) => (n === 1 ? "1 message ready" : `${n} messages ready`),
      empty: "No messages waiting. When there is one, it shows up here.",
      send: "Send on WhatsApp",
      dismiss: "Dismiss",
      promoNote: "Promotion: only for clients who gave consent. The text ends with “Reply STOP to opt out.”",
      kind: { reminder: "Reminder", review: "Review", gap: "Free slot", winback: "Win back", birthday: "Birthday" },
      to: (phone) => `To ${phone}`,
      failed: "The message could not be updated. Try again.",
      gone: "That message was already handled.",
    },
  },
};
