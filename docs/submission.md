# Phantom Line

**An 80s answering machine brought back from the dead, as the AI phone receptionist of a hair salon.** When nobody picks up, it answers by voice in Spanish or English, books appointments inside opening hours, and leaves the owner a message on a blinking tape.

Category: **Resurrection** (also entered for Best Student and Best Startup).

- Live demo: https://phantom-line-nine.vercel.app (Peluquería Lola, a demo salon in Madrid; the month shown is sample data)
- Code, specs and steering: https://github.com/automatizacionesmorente-png/phantom-line (`.kiro/` at the root)
- Startup page: https://phantom-line-nine.vercel.app/startup

## Testing instructions for judges

Best in **Chrome** (speech recognition). Free to use until 29 Jan 2027; no account needed.

1. Open https://phantom-line-nine.vercel.app/call/peluqueria-lola. Press **Call** and ask for a haircut tomorrow at 9 pm. The shop is closed, so it offers the nearest free time. Give a name and a phone, say yes. No microphone? Press **Type instead**. Switch to **EN** for English.
2. Open https://phantom-line-nine.vercel.app/machine/peluqueria-lola and enter the public demo PIN **198000**.
3. Within about 5 seconds the red light blinks and the counter goes up. Press PLAY to hear the call, open the Agenda tab to see the booking.
4. Open `/startup` for the business case. The "Try it in 30 seconds" strip on the call page walks through the same steps.

## Inspiration

A hair salon owner has scissors in one hand and the other hand on a customer. The phone rings and nobody answers, and that booking is gone. The 1980s answering machine solved this once: the light blinked, you came back to messages. We brought it back from the dead, with a receptionist that can actually book. The category fits twice: the machine is resurrected, and so are the calls nobody answered.

## What it does

**Caller** (`/call/peluqueria-lola`): talk or type, in Spanish or English. The assistant says it is the shop's virtual assistant and answers only from the shop's profile (hours, 19 services, prices, address, FAQ). It books, reschedules and cancels, and understands "un corte y un degradado" as one booking. Ask for 21:00 and the code says the shop is closed and offers 19:30.

**Owner** (`/machine/peluqueria-lola`, 6-digit PIN): an ivory and gold machine with a blinking light, a counter and reels that turn while a message plays. Each card shows caller, reason, urgency, what was agreed and a suggested reply. An 8-day agenda has confirm, move and cancel, and every owner action is audited. The machine follows the browser language.

**The model proposes, the code decides.** Hours, service length, the past, the shop's time zone and free chairs are checked in pure TypeScript, and a Postgres exclusion constraint makes double bookings impossible. A rule-based Code_Brain reads the caller first and Gemini is used only when it is not sure, so a model failure never ends a call. Urgency and the owner's message are built by code.

**Salon system (new, 23-25 Nov)**: the owner's side has four tabs. *Today* is a booking book with one column per worker, a + button for manual bookings (marked as made by the owner) and blocked time (the receptionist never offers it), and a cash desk ("Cobrar": cash, card, Bizum or voucher). *Clients* adds notes and allergies, birthday, consent for promotions and sector fields. *My business* shows taken, expenses and what is left against the previous month, what the receptionist did (only figures the stored data proves), expenses and a CSV and printable page for the accountant. *Settings* has switches (reminder, review, freed slot, win-back, birthday) that fill an outbox; each message opens WhatsApp with the text ready and the owner sends it with one tap. The month in the demo is **sample data**, labelled on screen.

**Startup angle** (`/startup`, `docs/impact.md`): the problem in cited numbers (42% of US consumers leave a voicemail and 78% say they abandoned a business after an unanswered call, CallRail 2025; 33,882 hair and barber companies in Spain, einforma 2024), the cost to run (upper bound $0.04096 per call, about $76 a month at 1,000 calls with paid plans; $0 inside free tiers), a planned Salon plan of 29 EUR a month (a planned price, not market-tested) and a waitlist. Impact limits are stated in the doc: the surveys are not salon-only, and we publish no figure we could not verify. Not built, so not promised: a real phone number, automatic WhatsApp sending (one-tap `wa.me` links only), legal invoices (VeriFactu), online payments, billing.

## How we built it

Next.js 16, TypeScript strict, Tailwind 4, Gemini via `@google/genai` (server only), Postgres on Neon with Drizzle, `temporal-polyfill`, and Vitest with fast-check and PGlite. All free tiers. **2537 tests in 237 files, all passing.**

### Kiro, 5 to 16 Nov 2026 (IDE and CLI)

- **Steering:** six docs load in every session (product, tech, structure, sector packs, receptionist voice, visual design).
- **Specs with human review:** core-call-loop, natural-voice, owner-machine and front-desk-brain (jury-polish partly), each with EARS requirements, a design with numbered correctness properties, and tasks. Our 11-point review "as a shop owner" was applied by Kiro. Kiro found that our own amendment contradicted its Requirements 5.4 and 9.6, and rewrote both.
- **Docs before memory:** the design said Node has Temporal built in; `typeof Temporal` on the real machine said `undefined`, so we moved to `temporal-polyfill` before any code. `@google/genai` 3.x needs Node 22, so it is pinned to 2.32.0.
- **Property-based tests proven by mutation:** Kiro broke the code on purpose and recorded each shrunk counterexample. Dropping the fit check shrank P3 to a 158-minute service at 09:14; substring urgency matching shrank to a caller who said only "painting".
- **Hooks** (secret guard, booking properties after each write, session brief), a **builder agent** that cannot push or read env files, and a **Context7 MCP** (its calls failed at the permission step in the logged sessions, so Kiro read docs another way; we claim no successful call).
- A real failed public call (2026-11-16) became the front-desk-brain spec and a regression test.
- Day-by-day log: `NOTAS-KIRO.md`.

### Claude, from 17 Nov (Kiro's credits ran out)

Kiro's 4,000 hackathon credits were used up on 17 Nov. The remaining work was written by Claude (Anthropic's coding assistant) under the owner's direction, and the commits say so. It was not Kiro's work:

- The B15 fixes in front-desk-brain (`52a5c7e`).
- BACKLOG 1, `npm run demo:reset` (`caafb29`); 11 and 12, `/startup`, waitlist and `docs/impact.md` (`d98397b`).
- BACKLOG 2, 26, 27, 28: the "Try it in 30 seconds" guide, browser-language machine, route titles, real 404 (`6de4fed`).
- BACKLOG 19-25: QA fixes (`f087657`, `e5b2d77`) and the English cut aliases (`545e2a2`).
- The **salon system** (commits `3c59a94` to `11ef12b`, spec in `.kiro/specs/salon-system/`): the four-tab owner app described above.
- These submission documents.

**Disclosure of pre-existing ideas.** The ideas come from the Nece-sites team's earlier private salon app (from 25 Oct 2026, before the hackathon). No code was copied from it; everything was rewritten in this repository during the submission period. The salon-system spec is organised the Kiro way (requirements, design, tasks) but it was implemented by Claude, because Kiro's credits had run out.

## Challenges

- **Free-tier Gemini 503s and hangs.** Kiro measured 155 calls on 5 models and built hedged attempts inside a time budget. Then the Code_Brain made the demo work without the model for sure readings.
- **Safari audio.** Safari refused a new `<audio>` per line outside a user gesture and needed 206 Range answers, so one unlocked element is reused and only the browser caches audio.
- **A leaked connection string.** The Neon driver quoted its connection string in an error and our log printed it. Every logged error now goes through `redactCredentials`, pinned by a test.
- **Running out of credits mid-project.** We moved the remaining backlog to Claude and kept the same specs, tests and rules, and wrote down who did what.

## Accomplishments

- A voice booking in Spanish or English with nothing spoken as digits, from call to blinking light.
- Property tests whose power was shown by deliberate mutations, with no test weakened to pass.
- An accessible machine: focus ring, one live region, reduced motion, contrast checked from the real CSS.
- A product story with sourced numbers instead of invented ones.

## What we learned

- A spec is worth most when a human argues with it.
- Check docs, then check the real machine.
- A property is only as good as its generator.
- Free tiers fail in bursts, so a demo must survive without the model.
- Being honest about who wrote what is easier when the commits say it.

## What's next

- A real phone number and WhatsApp as thin adapters over the same core.
- `/setup`: a salon creates its own shop in three minutes (BACKLOG 16).
- Automatic WhatsApp sending through each client's own official API, and a real phone line.
- Physio, restaurant and bakery packs (only the hair salon ships today), and a trial with a real Madrid salon.

## Team

Miguel Morente, student at UFV Madrid (Best Student, Best Startup). Built with Kiro and, after the credits ran out, Claude.
