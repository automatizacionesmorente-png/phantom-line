---
inclusion: always
---

# Tech stack

Everything must run on free tiers with no credit card.

- **App:** Next.js (App Router) + TypeScript (strict, 5.9), deployed on Vercel (free), on Node.js 20.19 or newer (`"engines": { "node": ">=20.19" }`). Default Node.js runtime; the Edge runtime is deprecated and not used.
- **Styling:** Tailwind CSS. Theme tokens live in one file so the "haunted machine" look stays consistent.
- **Voice (default, free):** the browser's Web Speech API. `SpeechRecognition` (Chrome) for the caller's speech, `speechSynthesis` for the receptionist's voice. Languages: `es-ES` and `en-US`. Typing is always available as a fallback.
- **AI:** Google Gemini API (free tier, Flash model) through `@google/genai` (2.x, the newest line that still supports Node 20), called only from server routes. The key lives in the `GEMINI_API_KEY` environment variable and is never committed or sent to the browser. `GEMINI_MODEL` holds an ordered, comma-separated fallback list of model ids (one id is also fine); attempt k of a Turn uses entry k mod n. When it is unset or empty, the default list is `gemini-flash-lite-latest, gemini-3.5-flash-lite` (`DEFAULT_GEMINI_MODELS` in `lib/receptionist/geminiClient.ts`), so changing models needs no code change.
- **Voice (neural, free tier):** Gemini text-to-speech through the same SDK, called only from server routes. `GEMINI_TTS_MODEL` holds an ordered, comma-separated list of TTS model ids; each model has its own daily quota, so a 429 marks that model exhausted until midnight Pacific and the request moves to the next one, never repeating on the same model. When it is unset or empty, the default list is `gemini-3.8-flash-tts, gemini-3.8-flash-lite-tts, gemini-3.1-flash-tts-preview` (`DEFAULT_TTS_MODELS` in `lib/receptionist/ttsClient.ts`). When every model is out, the browser voice speaks.
- **Time:** the `Temporal` API from `temporal-polyfill`, always imported explicitly (`import { Temporal } from "temporal-polyfill"`); never rely on a runtime `Temporal` global, which Node does not ship. No other date library. All booking times are evaluated in the shop's IANA time zone, never the server's.
- **Database:** Postgres on Neon (free) via Drizzle ORM. Tables: `shops`, `calls`, `messages`, `bookings`, `rate_limits`, `owner_actions` (the audit record of every owner action). Double bookings are prevented by a Postgres exclusion constraint, not only by code.
- **Icons:** Lucide through `lucide-react`, one named import per icon (Next.js optimizes the package by default).
- **Tests:** Vitest for unit tests, fast-check for property-based tests, PGlite for database tests without a server, and `jsdom` with `@testing-library/react` (dev only) for DOM tests of components. Tests run in `node` by default; a DOM test is a `*.test.tsx` file that starts with `// @vitest-environment jsdom`.

## Rules
- The AI must answer from the shop profile passed in the prompt, never from general knowledge.
- Booking rules (opening hours, services, slot length) are enforced in plain TypeScript, not by the model. The model proposes; the code decides.
- Every call to the model has a timeout and a fallback ("I'll take a message for the owner"). A Turn has a 2.4-second budget for all its attempts (`MODEL_TIMEOUT_MS`). Each attempt has its own 1.2-second deadline (`ATTEMPT_TIMEOUT_MS`); when it expires, a fresh attempt with the next model starts beside the old one, and the first valid answer wins. A 5xx starts a fresh attempt at once. A 429 is quota and is never retried. At most 2 attempts per Turn (`MAX_MODEL_ATTEMPTS`), and the last one keeps the rest of the budget (all in `lib/receptionist/callModel.ts`). The model is not called at all on a Sure_Reading, a Turn the code can answer completely by itself.
- Every fallback writes one `turn_fallback` JSON line to the server log with its path, reason, rate limit hit, HTTP status, SDK error class, truncated error message, latency, attempts and zod issues (path, code and zod's own message only). It never contains the API key (redacted), the model's text, the caller's words or transcript, a name, a phone or the visitor key.
- Validate all model output with zod before using it.
- No secrets, personal data or `.env` files in the repo. Ship a `.env.example`.
- Keep dependencies few and well known.
