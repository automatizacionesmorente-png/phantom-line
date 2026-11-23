import type { Extraction } from "@/lib/rebirth/extraction";

/** The two calls the wizard makes. Plain `fetch`; every answer is read defensively. */

export type ExtractOutcome =
  | { ok: true; extraction: Extraction }
  | { ok: false; error: "too_large" | "wrong_type" | "rate_limited" | "failed" | "network" };

export async function extractDocument(input: { file?: File; text?: string }): Promise<ExtractOutcome> {
  const body = new FormData();
  if (input.file) body.set("file", input.file);
  else body.set("text", input.text ?? "");
  try {
    const res = await fetch("/api/nacer/extract", { method: "POST", body });
    const data = (await res.json().catch(() => null)) as { extraction?: Extraction; error?: string } | null;
    if (res.ok && data?.extraction) return { ok: true, extraction: data.extraction };
    if (res.status === 413) return { ok: false, error: "too_large" };
    if (res.status === 415) return { ok: false, error: "wrong_type" };
    if (res.status === 429) return { ok: false, error: "rate_limited" };
    return { ok: false, error: "failed" };
  } catch {
    return { ok: false, error: "network" };
  }
}

export type CreateOutcome =
  | { ok: true; shopId: string; callPath: string; machinePath: string; expiresAt: string }
  | { ok: false; error: "name_taken" | "rate_limited" | "invalid" | "failed" };

export async function createShop(payload: { draft: unknown; pin: string; acceptTerms: true }): Promise<CreateOutcome> {
  try {
    const res = await fetch("/api/nacer/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.status === 201 && data && typeof data.shopId === "string" && typeof data.callPath === "string" && typeof data.machinePath === "string") {
      return {
        ok: true,
        shopId: data.shopId,
        callPath: data.callPath,
        machinePath: data.machinePath,
        expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : "",
      };
    }
    if (res.status === 409) return { ok: false, error: "name_taken" };
    if (res.status === 429) return { ok: false, error: "rate_limited" };
    if (res.status === 400) return { ok: false, error: "invalid" };
    return { ok: false, error: "failed" };
  } catch {
    return { ok: false, error: "failed" };
  }
}
