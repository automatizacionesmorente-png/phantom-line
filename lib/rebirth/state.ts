import type { Lang } from "@/lib/sectors";
import { sectorById, type SectorOption } from "./sectors";

/**
 * What the wizard keeps in the browser (and in localStorage): everything a person types, as
 * strings, so half-filled fields survive a reload. `toDraft` turns it into the typed `Draft`
 * the schemas check. Never holds the PIN: it is typed again after a reload.
 */
export interface ServiceRow {
  name: string;
  nameEn: string;
  durationMin: string;
  priceEur: string;
  from: boolean;
}
export interface FaqRow {
  question: string;
  keywords: string;
  keywordsEn: string;
  answer: string;
  answerEn: string;
  /** A starter row's example answer, shown as a placeholder only. */
  example?: string;
}
export type DayRow = { open: string; close: string }[];

export interface WizardState {
  step: number;
  sectorId: string;
  name: string;
  address: string;
  city: string;
  timeZone: string;
  languages: Lang[];
  ownerName: string;
  website: string;
  members: string[];
  concurrent: string;
  /** ISO weekday 1..7 → sessions; a missing day is closed. */
  hours: Record<number, DayRow>;
  services: ServiceRow[];
  faq: FaqRow[];
  /** Whether the catalogue came from a starter, an extraction, or by hand (informational). */
  catalogueFrom: "none" | "starter" | "document";
}

export const emptyState = (): WizardState => ({
  step: 0,
  sectorId: "",
  name: "",
  address: "",
  city: "",
  timeZone: "Europe/Madrid",
  languages: ["es", "en"],
  ownerName: "",
  website: "",
  members: [""],
  concurrent: "1",
  hours: {},
  services: [],
  faq: [],
  catalogueFrom: "none",
});

export const toNumber = (v: string): number => (v.trim() === "" ? NaN : Number(v.trim().replace(",", ".")));

export function starterServices(sector: SectorOption): ServiceRow[] {
  return sector.starterCatalogue.map((s) => ({
    name: s.name.es,
    nameEn: s.name.en,
    durationMin: String(s.durationMin),
    priceEur: String(s.priceEur),
    from: s.from === true,
  }));
}

export function starterFaq(sector: SectorOption): FaqRow[] {
  return sector.starterFaq.map((f) => ({
    question: f.question.es,
    keywords: f.keywords.es.join(", "),
    keywordsEn: f.keywords.en.join(", "),
    answer: "",
    answerEn: "",
    example: f.example.es,
  }));
}

/** The typed draft of a state (NaN stays NaN, so the schema says "invalid" for that field). */
export function toDraft(s: WizardState) {
  const hours: Record<string, DayRow> = {};
  for (const [day, sessions] of Object.entries(s.hours)) if (sessions.length > 0) hours[day] = sessions;
  return {
    sectorId: s.sectorId,
    business: { name: s.name, address: s.address, city: s.city, timeZone: s.timeZone, languages: s.languages, ownerName: s.ownerName },
    team: { members: s.members, concurrent: toNumber(s.concurrent) },
    hours,
    services: s.services.map((r) => ({
      name: r.name,
      nameEn: r.nameEn,
      durationMin: toNumber(r.durationMin),
      priceEur: toNumber(r.priceEur),
      from: r.from,
    })),
    faq: s.faq.map(({ question, keywords, keywordsEn, answer, answerEn }) => ({ question, keywords, keywordsEn, answer, answerEn })),
  };
}

/** A state saved by an older or tampered build is dropped, not trusted. */
export function parseSavedState(raw: string | null): WizardState | null {
  if (raw === null || raw.length > 200_000) return null;
  try {
    const v = JSON.parse(raw) as Partial<WizardState> | null;
    if (v === null || typeof v !== "object") return null;
    const base = emptyState();
    const str = (x: unknown, d: string) => (typeof x === "string" ? x.slice(0, 500) : d);
    const strs = (x: unknown) => (Array.isArray(x) ? x.filter((i): i is string => typeof i === "string").map((i) => i.slice(0, 500)) : []);
    const step = typeof v.step === "number" && Number.isInteger(v.step) && v.step >= 0 && v.step <= 5 ? v.step : 0;
    const sectorId = str(v.sectorId, "");
    const hours: Record<number, DayRow> = {};
    if (v.hours && typeof v.hours === "object") {
      for (const d of [1, 2, 3, 4, 5, 6, 7]) {
        const day = (v.hours as Record<string, unknown>)[String(d)];
        if (Array.isArray(day))
          hours[d] = day
            .filter((x): x is { open: string; close: string } => !!x && typeof x.open === "string" && typeof x.close === "string")
            .slice(0, 4)
            .map((x) => ({ open: x.open.slice(0, 5), close: x.close.slice(0, 5) }));
      }
    }
    const rows = <T,>(x: unknown, pick: (o: Record<string, unknown>) => T, max: number): T[] =>
      Array.isArray(x) ? x.filter((o) => !!o && typeof o === "object").slice(0, max).map((o) => pick(o as Record<string, unknown>)) : [];
    return {
      ...base,
      step: sectorId && sectorById(sectorId) ? step : 0,
      sectorId,
      name: str(v.name, ""),
      address: str(v.address, ""),
      city: str(v.city, ""),
      timeZone: str(v.timeZone, base.timeZone),
      languages: Array.isArray(v.languages) ? v.languages.filter((l): l is Lang => l === "es" || l === "en") : base.languages,
      ownerName: str(v.ownerName, ""),
      website: str(v.website, ""),
      members: strs(v.members).length > 0 ? strs(v.members).slice(0, 8) : [""],
      concurrent: str(v.concurrent, "1"),
      hours,
      services: rows(v.services, (o) => ({
        name: str(o.name, ""),
        nameEn: str(o.nameEn, ""),
        durationMin: str(o.durationMin, ""),
        priceEur: str(o.priceEur, ""),
        from: o.from === true,
      }), 40),
      faq: rows(v.faq, (o) => ({
        question: str(o.question, ""),
        keywords: str(o.keywords, ""),
        keywordsEn: str(o.keywordsEn, ""),
        answer: str(o.answer, ""),
        answerEn: str(o.answerEn, ""),
        ...(typeof o.example === "string" ? { example: o.example.slice(0, 300) } : {}),
      }), 20),
      catalogueFrom: v.catalogueFrom === "starter" || v.catalogueFrom === "document" ? v.catalogueFrom : "none",
    };
  } catch {
    return null;
  }
}
