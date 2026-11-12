# Phantom Line

An AI answering machine for small local businesses. When nobody picks up, Phantom Line answers by voice in Spanish or English, takes bookings inside opening hours, and leaves the owner a message on the tape. The model proposes; plain TypeScript decides every booking.

Built with Next.js (App Router), TypeScript, Tailwind CSS, Gemini (`@google/genai`), Postgres on Neon with Drizzle, and Vitest with fast-check.

## Run it locally

Needs Node.js 20.19 or newer, a free [Neon](https://neon.tech) Postgres database and a free [Gemini API key](https://aistudio.google.com/apikey).

1. Install and create your env file from `.env.example`. Never commit `.env.local`.

   ```bash
   npm install
   cp .env.example .env.local
   ```

   | Name | Required | What it is |
   |---|---|---|
   | `GEMINI_API_KEY` | yes | Gemini API key, used only on the server |
   | `DATABASE_URL` | yes | Neon Postgres connection string |
   | `GEMINI_MODEL` | no | Ordered, comma-separated list of model ids to try. Default `gemini-3.5-flash-lite,gemini-flash-lite-latest` |
   | `TURN_LIMIT_PER_VISITOR_PER_MINUTE` | no | Turns per visitor per minute. Default 12 |
   | `TURN_LIMIT_GLOBAL_PER_HOUR` | no | Turns per hour for the whole app. Default 200 |
   | `RATE_LIMIT_SALT` | recommended | Any random string, used to hash visitor IPs for the rate limit. Empty works but hashes without a salt |

2. Apply the migrations (tables plus the Postgres constraint that blocks double bookings) and seed the demo shop, Peluquería Lola. Both are safe to run again.

   ```bash
   node --env-file=.env.local scripts/migrate.mjs
   npm run db:seed
   ```

3. Start the app and open <http://localhost:3000/call/peluqueria-lola> in Chrome. Press **Call** and talk, or press **Type instead**.

   ```bash
   npm run dev
   ```

Tests run without a database or network (PGlite and a fake model): `npx vitest run`. The manual Chrome checks are in [`.kiro/specs/core-call-loop/manual-checklist.md`](.kiro/specs/core-call-loop/manual-checklist.md).

## How it was built with Kiro

The project was written spec-first with [Kiro](https://kiro.dev):

- [`.kiro/steering/`](.kiro/steering/): the standing rules every session starts from (product, tech stack, structure, sector packs, receptionist voice, visual design).
- [`.kiro/specs/core-call-loop/`](.kiro/specs/core-call-loop/): the first spec, as requirements, design (with correctness properties and the findings that changed it) and tasks, including the catch log of bugs found by property tests and real calls.
- [`.kiro/agents/`](.kiro/agents/): the scoped builder agent used for headless runs.
- [`NOTAS-KIRO.md`](NOTAS-KIRO.md): a dated log of what Kiro did and what it caught, with real examples.

## Deploy on Vercel

The app runs on Vercel's free tier with the default Node.js runtime. Set the same environment variables in the Vercel project settings. See the [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying).
