import type { z } from "zod";
import {
  BusinessSchema,
  DraftSchema,
  FaqsSchema,
  HoursSchema,
  PinSchema,
  profileIssues,
  SectorStepSchema,
  ServicesSchema,
  TeamSchema,
} from "./draft";
import { sectorById } from "./sectors";
import { toDraft, type WizardState } from "./state";

/** Field path → error code. The first issue of each field wins. */
export type FieldErrors = Record<string, string>;

const KNOWN = new Set([
  "required", "too_long", "invalid_chars", "invalid", "invalid_url", "too_many", "duplicate",
  "concurrent_too_high", "no_open_day", "pin_format", "pin_mismatch", "terms_required",
]);

function collect(errors: FieldErrors, prefix: string, error: z.ZodError, fallback = "invalid") {
  for (const issue of error.issues) {
    const path = [prefix, ...issue.path.map(String)].filter((p) => p !== "").join(".");
    errors[path] ??= KNOWN.has(issue.message) ? issue.message : fallback;
  }
}

export function isHttpUrl(value: string): boolean {
  if (value.trim() === "") return true;
  try {
    const u = new URL(value.trim());
    return (u.protocol === "http:" || u.protocol === "https:") && value.trim().length <= 200;
  } catch {
    return false;
  }
}

/** The errors of one step (0 to 5), as codes. Empty means the step may be left. */
export function validateStep(step: number, s: WizardState, pin?: { pin: string; pinAgain: string; acceptTerms: boolean }): FieldErrors {
  const errors: FieldErrors = {};
  const draft = toDraft(s);
  switch (step) {
    case 0: {
      const r = SectorStepSchema.safeParse({ sectorId: s.sectorId });
      if (!r.success || !sectorById(s.sectorId)) errors.sectorId = "required";
      break;
    }
    case 1: {
      const r = BusinessSchema.safeParse(draft.business);
      if (!r.success) collect(errors, "business", r.error);
      else if (r.data.address.length + r.data.city.length + 2 > 200) errors["business.address"] = "too_long";
      if (!isHttpUrl(s.website)) errors["business.website"] = "invalid_url";
      break;
    }
    case 2: {
      const r = TeamSchema.safeParse(draft.team);
      if (!r.success) collect(errors, "team", r.error);
      break;
    }
    case 3: {
      const h = HoursSchema.safeParse(draft.hours);
      if (!h.success) {
        collect(errors, "hours", h.error, "hours_invalid");
        // One message for the whole grid, whichever day it is about.
        for (const k of Object.keys(errors)) {
          if (k.startsWith("hours.")) {
            errors.hours ??= errors[k];
            delete errors[k];
          }
        }
      }
      const v = ServicesSchema.safeParse(draft.services);
      if (!v.success) collect(errors, "services", v.error);
      break;
    }
    case 4: {
      const r = FaqsSchema.safeParse(draft.faq);
      if (!r.success) collect(errors, "faq", r.error);
      const whole = DraftSchema.safeParse(draft);
      if (r.success && whole.success) {
        // Each answered row alone, so an issue belongs to its row (rows without an answer are skipped by the profile).
        whole.data.faq.forEach((row, i) => {
          if (row.answer === undefined) return;
          for (const issue of profileIssues({ ...whole.data, faq: [row] })) {
            if (issue.path.startsWith("faq")) errors[`faq.${i}.${issue.code === "faq_spoken" ? "answer" : "keywords"}`] ??= issue.code;
          }
        });
      }
      break;
    }
    case 5: {
      const r = PinSchema.safeParse(pin ?? { pin: "", pinAgain: "", acceptTerms: false });
      if (!r.success) collect(errors, "", r.error);
      break;
    }
  }
  return errors;
}
