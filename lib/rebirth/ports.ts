import type { Temporal } from "temporal-polyfill";
import type { ShopProfile } from "@/lib/conversation/shopProfile";

/** The two public endpoints of the wizard that are rate limited. */
export type WizardKind = "create" | "extract";

export interface WizardLimiter {
  /** Counts include this request: `visitor` and `day` (all visitors) in the current UTC day. */
  hit(kind: WizardKind, visitorKey: string, now: Temporal.Instant): Promise<{ visitor: number; day: number }>;
}

export type CreateShopResult =
  | { ok: true; shopId: string }
  | { ok: false; reason: "name_taken" | "no_free_slug" };

export interface TrialStore {
  /**
   * Inserts a new trial shop under the first free id of `candidates`. Never updates an existing
   * shop: a taken id is skipped, a taken name is refused.
   */
  createShop(input: {
    name: string;
    candidates: readonly string[];
    buildProfile: (id: string) => ShopProfile;
    pinHash: string;
    now: Temporal.Instant;
    expiresAt: Temporal.Instant;
  }): Promise<CreateShopResult>;
  isTrial(shopId: string): Promise<boolean>;
  /** Deletes every trial shop whose `expires_at` has passed, with all its data. Returns how many. */
  deleteExpired(now: Temporal.Instant): Promise<number>;
}

/** One piece of what the extraction model reads: pasted text, or a PDF as base64. */
export type ExtractPart = { kind: "text"; text: string } | { kind: "pdf"; base64: string };

/** The model port of the extraction; `lib/rebirth/geminiExtract.ts` implements it. */
export interface ExtractModel {
  models: readonly string[];
  generate(req: {
    systemInstruction: string;
    part: ExtractPart;
    jsonSchema: object;
    signal: AbortSignal;
    attempt: number;
  }): Promise<string>;
}
