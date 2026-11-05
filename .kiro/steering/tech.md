---
inclusion: always
---

# Tech stack

Everything must run on free tiers with no credit card.

- **App:** Next.js (App Router) + TypeScript (strict), deployed on Vercel (free).
- **Styling:** Tailwind CSS. Theme tokens live in one file so the "haunted machine" look stays consistent.
- **Voice (default, free):** the browser's Web Speech API. `SpeechRecognition` (Chrome) for the caller's speech, `speechSynthesis` for the receptionist's voice. Languages: `es-ES` and `en-US`.
- **AI:** Google Gemini API (free tier, Flash model) called only from server routes. The key lives in the `GEMINI_API_KEY` environment variable and is never committed or sent to the browser.
- **Database:** Postgres on Neon (free) via Drizzle ORM. Tables: `shops`, `calls`, `messages`.
- **Tests:** Vitest for unit tests and fast-check for property-based tests.

## Rules
- The AI must answer from the shop profile passed in the prompt, never from general knowledge.
- Booking rules (opening hours, services, slot length) are enforced in plain TypeScript, not by the model. The model proposes; the code decides.
- Every call to the model has a timeout and a fallback ("I'll take a message for the owner").
- Validate all model output with zod before using it.
- No secrets, personal data or `.env` files in the repo. Ship a `.env.example`.
- Keep dependencies few and well known.
