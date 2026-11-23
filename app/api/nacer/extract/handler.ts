import type { Temporal } from "temporal-polyfill";
import { visitorKeyOf } from "@/app/api/visitorKey";
import { LIMITS, MAX_PASTED_TEXT, MAX_PDF_BYTES } from "@/lib/rebirth/draft";
import { DEFAULT_EXTRACT_OPTIONS, runExtraction, type ExtractOptions } from "@/lib/rebirth/extraction";
import type { ExtractModel, ExtractPart, WizardLimiter } from "@/lib/rebirth/ports";
import { readBodyLimited } from "../body";

/**
 * POST /api/nacer/extract: reads a price-list PDF or pasted text into hours, services and FAQ.
 * multipart/form-data with `file` (application/pdf, at most 4 MB) or `text`, never both.
 * 413 too big, 415 not a PDF, 400 bad form, 429 rate limited (5 per visitor and 100 in all per
 * day: it spends Gemini quota), 502 the model failed, 200 `{ ok: true, extraction }`.
 * Nothing is stored. The PDF is untrusted: see `lib/rebirth/extraction.ts`.
 */
export interface ExtractHandlerOptions {
  model: () => ExtractModel;
  limiter: () => WizardLimiter;
  clock: () => Temporal.Instant;
  salt: () => string;
  options?: ExtractOptions;
}

/** Room for the multipart framing around a 4 MB file. */
const MAX_BODY = MAX_PDF_BYTES + 64 * 1024;
const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export function makeExtractHandler(opts: ExtractHandlerOptions): (request: Request) => Promise<Response> {
  return async function POST(request: Request): Promise<Response> {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) return json({ error: "wrong_type" }, 415);

    const bytes = await readBodyLimited(request, MAX_BODY);
    if (bytes === null) return json({ error: "too_large" }, 413);

    let form: FormData;
    try {
      form = await new Response(bytes as BodyInit, { headers: { "content-type": contentType } }).formData();
    } catch {
      return json({ error: "invalid_request" }, 400);
    }
    const keys = [...new Set([...form.keys()])];
    if (keys.some((k) => k !== "file" && k !== "text")) return json({ error: "invalid_request" }, 400);
    const file = form.get("file");
    const text = form.get("text");
    const hasFile = file !== null && typeof file !== "string" && file.size > 0;
    const hasText = typeof text === "string" && text.trim() !== "";
    if (hasFile === hasText) return json({ error: "invalid_request" }, 400);

    let part: ExtractPart;
    if (hasFile) {
      const f = file as File;
      if (f.size > MAX_PDF_BYTES) return json({ error: "too_large" }, 413);
      const buf = new Uint8Array(await f.arrayBuffer());
      // The declared type and the first bytes must both say PDF.
      const magic = String.fromCharCode(...buf.slice(0, 5));
      if (f.type !== "application/pdf" || magic !== "%PDF-") return json({ error: "wrong_type" }, 415);
      part = { kind: "pdf", base64: Buffer.from(buf).toString("base64") };
    } else {
      if ((text as string).length > MAX_PASTED_TEXT) return json({ error: "too_large" }, 413);
      part = { kind: "text", text: text as string };
    }

    try {
      const now = opts.clock();
      const key = visitorKeyOf(request.headers.get("x-forwarded-for"), opts.salt());
      const counts = await opts.limiter().hit("extract", key, now);
      const limit = LIMITS.extract;
      if (counts.visitor > limit.perVisitorPerDay || counts.day > limit.globalPerDay) return json({ error: "rate_limited" }, 429);

      const result = await runExtraction(opts.model(), part, opts.options ?? DEFAULT_EXTRACT_OPTIONS);
      if (!result.ok) return json({ error: "extraction_failed", failure: result.failure }, result.failure === "quota" ? 503 : 502);
      return json({ ok: true, extraction: result.extraction }, 200);
    } catch {
      return json({ error: "unavailable" }, 503);
    }
  };
}
