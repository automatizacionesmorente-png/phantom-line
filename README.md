# Phantom Line

An 80s answering machine brought back from the dead, as the AI phone receptionist of a hair salon. When nobody picks up, it answers by voice in Spanish or English, books inside opening hours, and leaves the owner a message on a blinking tape. The model proposes; plain TypeScript decides every booking.

Since 23 Nov 2026 the owner's side is also a small salon system: Today (a booking book per worker, a + button for manual bookings and blocked time, cash desk), Clients, My business (month, expenses, export for the accountant) and Settings (switches and a WhatsApp outbox). The month in the demo is **sample data**.

Kiroween 2026 (Devpost), category **Resurrection**, plus Best Student and Best Startup. Founder: Miguel Morente, student at UFV Madrid. AGPL-3.0 license.

## Try it in 30 seconds

Best in **Chrome** (speech recognition). Demo shop: Peluquería Lola, Madrid.

1. Open the [call page](https://phantom-line-nine.vercel.app/call/peluqueria-lola), press **Call**, ask for a haircut tomorrow at 9 pm (the shop is closed, so it offers the nearest free time), give a name and phone, say yes. Or press **Type instead**. ES / EN switch on the page.
2. Open the [owner's machine](https://phantom-line-nine.vercel.app/machine/peluqueria-lola) and enter the public demo PIN **198000**.
3. Within about 5 seconds the red light **blinks** and the counter goes up. Press PLAY to hear the call back; the booking is in the Agenda tab.

Also: [landing page](https://phantom-line-nine.vercel.app), [/startup](https://phantom-line-nine.vercel.app/startup) (the business angle, with a waitlist). The demo is free to use until 29 Jan 2027; demo messages are cleaned up automatically.

## How Kiro was used (5 to 16 Nov 2026)

Phantom Line was built spec-first with [Kiro](https://kiro.dev), IDE and CLI (`kiro-cli chat --no-interactive`):

- [`.kiro/steering/`](.kiro/steering/): six standing docs (product, tech, structure, sector packs, receptionist voice, visual design).
- Specs, each with requirements, design and tasks: [core-call-loop](.kiro/specs/core-call-loop/), [natural-voice](.kiro/specs/natural-voice/), [owner-machine](.kiro/specs/owner-machine/), [front-desk-brain](.kiro/specs/front-desk-brain/) (tasks 1-11, 15, 17, 18 done by Kiro), and [jury-polish](.kiro/specs/jury-polish/) (partly done), and [salon-system](.kiro/specs/salon-system/) (written by Claude, see below).
- Property-based tests with fast-check, proven by mutation: Kiro broke the code on purpose and recorded the shrunk counterexamples.
- [`.kiro/hooks/`](.kiro/hooks/) (secret guard, booking properties after each write, session brief), [`.kiro/agents/builder.json`](.kiro/agents/builder.json) (a builder agent that cannot push or read secrets) and a Context7 docs MCP in [`.kiro/settings/`](.kiro/settings/).
- Day-by-day log: [`NOTAS-KIRO.md`](NOTAS-KIRO.md). The most telling rows:
  - 2026-11-06, Kiro applied an 11-point owner review to its own requirements.
  - 2026-11-11, "Human review vs docs": the design said Node has Temporal built in; `typeof Temporal` said otherwise, before any code.
  - 2026-11-12, "mutation proof": dropping the fit check shrank property P3 to a 158-minute service at 09:14.
  - 2026-11-16, "from a production log": a real failed call became the front-desk-brain spec and a regression test.

## What Claude wrote after Kiro's credits ran out (from 17 Nov)

Kiro's 4,000 hackathon credits were used up on 17 Nov. The rest was written by Claude (Anthropic's coding assistant) under the owner's direction; the commits say "Written by Claude (Kiro credits exhausted)". This is not Kiro's work:

- **Salon system** (23-25 Nov, spec in [`.kiro/specs/salon-system/`](.kiro/specs/salon-system/), 18 tasks, commits `3c59a94` to `11ef12b`): four-tab owner app, manual bookings, time blocks, cash desk, clients with notes and consent, month report, expenses, accountant CSV, automation switches and outbox, demo month. Migration `0009_salon`.
- Fix of the B15 counterexamples in front-desk-brain (`52a5c7e`).
- BACKLOG 1: `npm run demo:reset`, a curated demo set (`caafb29`).
- BACKLOG 11 and 12: `/startup` page, waitlist, `docs/impact.md` (`d98397b`).
- BACKLOG 2, 26, 27, 28: the "Try it in 30 seconds" guide, browser-language machine, route titles, real 404 (`6de4fed`).
- BACKLOG 19-25: QA fixes (stale reply, call-back needs a phone, code-built owner reason, no empty cards) (`f087657`, `e5b2d77`).
- English cut aliases (men's, women's, kids' haircut) (`545e2a2`).
- These docs (README, submission, checklist, video script).

### Where the salon-system ideas come from

The ideas come from the Nece-sites team's earlier private salon app (from 25 Oct 2026, before the hackathon). No code was copied from it; everything was rewritten in this repository during the submission period. The spec is organised the Kiro way, but Claude implemented it.

Not built, on purpose: legal invoices (VeriFactu; the app exports numbers for the accountant instead), automatic WhatsApp sending (every message is a one-tap `wa.me` link), and a real phone line.

## It answers without spending an API token

The Code_Brain reads every turn first and answers by itself whenever it is sure: bookings, hours,
prices, the shop's own FAQ and a built-in Universal_FAQ (who are you, a joke, the weather, "what is the
capital of France", compliments, complaints, "say that again"), in Spanish and English. Only when it is
unsure does it ask the Gemini model, and if that fails or the free quota runs out it keeps answering
from code. Set `PHANTOM_BRAIN_ONLY=1` and the model is never called: zero tokens, same demo.
What nobody planned for ends as a note for the owner, never an invented answer.

## Architecture

- Next.js 16 (App Router), TypeScript strict, Tailwind 4, Postgres on Neon with Drizzle. Gemini (`@google/genai`) for conversation and optional neural voice, on the server only.
- One channel-agnostic core, `handleTurn`: a rule-based Code_Brain reads the caller first; Gemini is called only when it is not sure, and a model failure never ends a call.
- `decideTurn` and `lib/booking` are pure TypeScript: hours, service length, shop time zone and free chairs. A Postgres exclusion constraint makes double bookings impossible.
- Urgency and the owner's message are built by code from the caller's words, never from the model's text.
- The owner's machine polls for changes (light, counter, tape, agenda, audited owner actions, scrypt PIN with signed session).
- Sector packs (hair salon ships) supply vocabulary and defaults.

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
   | `GEMINI_MODEL` | no | Ordered, comma-separated list of model ids to try. Default `gemini-flash-lite-latest,gemini-3.5-flash-lite` |
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

Tests run without a database or network (PGlite and a fake model). Current run: **2537 tests in 237 files, all passing**.

```bash
npx vitest run
```

Manual Chrome checks: [`.kiro/specs/core-call-loop/manual-checklist.md`](.kiro/specs/core-call-loop/manual-checklist.md). To reset the demo shop to its curated set: `npm run demo:reset` (add `-- --allow-remote` for Neon).

## Deploy

Runs on Vercel's free tier with the default Node.js runtime. Set the same environment variables in the project settings.

## License

GNU Affero General Public License v3.0 (AGPL-3.0), see [LICENSE](LICENSE). Copyright (c) 2026 Miguel Morente de las Heras.

You may read, run and change this code. If you offer a modified version to users over a network, you must publish your full source under the same license.
