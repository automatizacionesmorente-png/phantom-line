# Phantom Line

**The voices of customers nobody answered come back from the dead.** Phantom Line brings back the 1980s answering machine as the AI front desk of a small shop. When nobody picks up, it answers by voice in Spanish or English, books appointments inside opening hours, and leaves the owner a message on the tape.

- Demo: DEMO_URL (Peluquería Lola, a demo hair salon in Madrid; owner PIN TODO_PIN)
- Code, specs and steering: REPO_URL (`.kiro/` at the root)

## Inspiration

Small salons, bakeries and clinics miss calls every day because the owner is busy with the customer in the chair. Each missed call is usually a lost booking, and a receptionist is out of reach.

## What it does

**Caller** (`/call/peluqueria-lola`): press Call and talk, with a visible ES / EN switch, or type instead. The assistant says it is the shop's virtual assistant and answers only from the shop's profile (hours, services, prices, address). It books, reschedules and cancels. Ask for 21:00 and the code says the shop is closed and offers 19:30, the nearest free slot on either chair. Times, days, prices and phones are spoken in words. A neural Gemini voice speaks the replies, and the browser voice takes over when the free quota runs out.

**Owner** (`/machine/peluqueria-lola`, 6-digit PIN): an ivory and gold machine with a blinking terracotta light, a counter, and reels that turn while a message plays. Each tape card shows the caller, reason, urgency, what was agreed and a suggested reply, and PLAY shows the transcript. An 8-day agenda has one-tap confirm, move and cancel, and every owner action is audited.

**The model proposes, the code decides.** Opening hours, service length, the past, the shop's time zone (Europe/Madrid, across DST) and free chairs are checked in pure TypeScript. A Postgres exclusion constraint makes double bookings impossible. Urgency comes from the caller's own words; the model's suggestion can raise it, never lower it.

**Public demo hygiene:** demo messages leave the tape after 24 hours and are deleted after 7 days; 3 "Ejemplo" samples refill an empty tape.

## How we built it

Next.js 16, TypeScript 5.9 strict, Tailwind 4, Gemini text and TTS via `@google/genai` 2.32.0 (server only), Postgres on Neon with Drizzle, `temporal-polyfill`, and Vitest with fast-check and PGlite. All free tiers, no card. One channel-agnostic core (`handleTurn`) serves the voice page. Booking rules, urgency, tape, agenda, PIN, poll loop and retention are pure functions with injected I/O.

## How we used Kiro

**Specs with human review.** Five specs (core-call-loop, natural-voice, owner-machine, front-desk-brain, jury-polish), each with EARS requirements, a design with numbered correctness properties, and tasks with a catch log. Review changed them before any code:
- Our 11-point review "as a shop owner" added the time zone, no past or double bookings, the ES/EN switch (recognition cannot detect the language) and reschedule and cancel. Kiro applied it for 2.6 credits.
- Kiro found that our amendment contradicted its own Requirements 5.4 and 9.6 (a booking that "overlaps any booking" against 2 chairs), and rewrote both.
- Kiro proposed requiring both name and phone before reading back a booking, so a stranger with someone's number cannot hear their appointment.
- The design claimed Node had Temporal built in. `typeof Temporal` on the real machine said `undefined`, so we switched to `temporal-polyfill` before any code used it.
- Kiro's owner checklist caught that our planned 4-digit demo PIN would leave the machine "not set up", because the spec requires 6 digits.

**Steering.** Six files load in every session: product, tech, structure, sector packs, receptionist voice, and the visual design (only for UI files). The first scaffold came out ivory and gold. Later, a contrast test that reads the real CSS found that the design's own gold button fails at 4.4:1.

**Docs before memory.** Each spec starts with a spike against current docs and real APIs. `@google/genai` 3.x needs Node 22, so it is pinned to 2.32.0. Gemini 3.6+ ignores sampling parameters, so none are sent. Neon's free plan would be kept awake by the machine's poll and suspend the demo after about 16 days.

**Custom builder agent** (`.kiro/agents/builder.json`): it may run only `npm`, `npx`, `node`, `ls`, `mkdir` and read-only git. `git push`, `commit`, `reset`, `rm -rf`, `curl` and any read of `.env` files are denied. Tested: `git push --dry-run` was blocked while `npx vitest run` ran.

**Hooks:**
- `guard-secrets` (PreToolUse) blocks any tool call that names a real env file.
- `booking-properties` (PostToolUse, plus an IDE on-save hook) runs the booking properties after every write to `lib/booking/`.
- `session-brief` (SessionStart) tells each headless session what is uncommitted and the next task of every spec. It opened the session that wrote this file: "owner-machine: 11/13 tasks, next: 12. Manual checklist".

TODO: recorded output of the other two hooks firing.

**MCP:** the Context7 docs server is wired into the workspace and the builder agent. In the logged sessions its calls failed at the permission step, so Kiro fetched the docs' Markdown with Node instead of guessing. TODO: a successful Context7 call, or the `phantom-booking` MCP server once built (Roadmap).

**Property-based tests, proven by mutation.** The specs define 55 properties (P1–P9, S1–S8, N1–N17, M1–M21), part of 1,269 tests in 142 files, all passing in the last full run. Database properties run on in-memory Postgres (PGlite). Kiro broke the code on purpose about 60 times and recorded each shrunk counterexample. Substring urgency matching shrank to a caller who said only "painting" (it contains "pain"). When a mutation went uncaught, Kiro said so; when a generator never reached a branch, it fixed the generator instead of dropping the check.

Real bugs the properties caught:
- **N7:** a read-back with a long name ran to 26 words, and the 25-word clamp would have cut the caller's name off.
- **N4:** the parser could not read back "el martes treinta y uno de marzo".
- **S4:** `"*1. x"` left a list marker in a spoken reply.
- **N15:** the time-stretch kept choosing the edge of its search window and lowered the voice's pitch by 2.5 %.

**Kiro CLI headless and parallel sessions.** Most of the build ran as `kiro-cli chat --no-interactive --resume` with the builder agent. Specs ran side by side: owner-machine planned its tasks around the files the natural-voice session was editing. This write-up came from a separate git worktree.

## Challenges

- **Free-tier Gemini 503s and hangs.** The model answered 503 to 2 of 14 sampled calls, and one 503 ended a whole call with nothing logged. Kiro measured 155 calls on 5 models and built hedged attempts: at 2.5 s a fresh attempt on the next model starts beside the slow one, inside an 8 s budget. Real conversations went from 2 of 6 booked to 6 of 6. A public call on 2026-11-16 still fell back, so our answer is the **Code_Brain**, a deterministic reader that answers from the shop profile when the model fails. It is specced (front-desk-brain) and **being built now**.
- **Safari audio.** Safari refused a new `<audio>` per line outside a user gesture, so the Call button now unlocks one element that every line reuses. Safari then probed with `Range: bytes=0-1` and refused anything but a 206, so the voice route answers ranges. Vercel's CDN answered those probes with a cached 200, so now only the browser caches audio.
- **iCloud.** With the repo under `~/Documents`, iCloud evicted files in `node_modules` and DOM tests timed out. Kiro traced it to `css-tree` files marked `dataless`, changed no test, and the repo moved.
- **A leaked connection string.** On the first deploy, the Neon driver quoted its connection string in an error, and our log line printed it. Every logged error now goes through `redactCredentials`, pinned by a regression test.

## Accomplishments

- A voice booking in Spanish or English with nothing spoken as digits, and a scripted acceptance test from call to blinking light.
- 55 properties and about 60 mutation proofs, with no test weakened to pass.
- An accessible machine: a gold focus ring on every control, one polite live region, reduced motion, and contrast checked from the real CSS.

## What we learned

- A spec is worth most when a human argues with it.
- Check docs, then check the real machine.
- A property is only as good as its generator.
- Free tiers fail in bursts, so a demo must survive without the model.

## What's next (Roadmap)

- Code_Brain with a real salon catalog and two or three services in one sentence ("corte y degradado").
- A typed-first call page for Safari and Firefox, an honest "the neural voice is resting" notice, an English voice cache, a booking MCP server, a full landing page (jury-polish).
- WhatsApp and web chat as thin adapters over the same core.
- Physio, restaurant and bakery packs (only the hair salon ships today), and a trial with a real Madrid salon.
