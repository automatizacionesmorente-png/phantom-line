# Implementation Plan: Core Call Loop

Follow `design.md`. Pure logic comes first, and each piece ships with its tests in the same task. No task is optional. Property-based tests are marked **[PBT]**; each one is its own sub-task and names the property and requirements it validates.

Every task finishes only when `npx vitest run`, `npm run lint` and `npm run build` all pass. Never read, print or log `.env.local` or the value of `GEMINI_API_KEY`.

## Dependencies and parallel work

| Task | Needs | Can run in parallel with |
|---|---|---|
| 1 Spike | none | none |
| 2 Setup | 1 | none |
| 3 Booking_Rules | 2 | none |
| 4 Sector packs | 3 | none |
| 5 Conversation core (pure) | 4 | none |
| 6 Receptionist | 5 | 7, 9 |
| 7 Database | 5 | 6, 9 |
| 8 handleTurn + Turn_API | 6, 7 | 9, 11 |
| 9 Voice reducer | 5.1 | 6, 7, 8 |
| 10 Call_Page | 8, 9 | 11 |
| 11 Seed | 7 | 8, 10 |
| 12 Manual checklist | 10, 11 | none |
| 13 Notes | 12 | none |

- **Inside tasks:** in task 3, the property sub-tasks 3.5 to 3.14 are independent of each other once 3.4 exists. In task 5, sub-tasks 5.2 to 5.7 are independent once 5.1 exists.
- **One deviation from the requested order:** the model contract (`lib/receptionist/schema.ts`) and the phrase templates are created in 5.1, because `decideTurn` consumes them. Task 6 adds everything else in `lib/receptionist`.

## Tasks

- [x] 1. Verification spike: Gemini model, SDK abort behaviour, nullable JSON Schema
  - [x] 1.1 Install `@google/genai` and `zod` (v4). Record the exact installed versions in design.md.
  - [x] 1.2 Write `scripts/check-gemini.mjs` (plain JavaScript: the machine's default Node 20.19 cannot run `.mts`), run with `node --env-file=.env.local scripts/check-gemini.mjs`. Node loads the file itself, so nobody reads it. The script:
    - takes the model from `process.env.GEMINI_MODEL ?? "gemini-3.8-flash"` (or `--model=<id>`; after the spike the default is `gemini-3.5-flash-lite`) and passes `apiKey: process.env.GEMINI_API_KEY` to `new GoogleGenAI(...)`;
    - never prints `process.env` or the key, and passes every error message through a `redact()` that replaces the key's value with `***` before printing;
    - prints only: model id, outcome, HTTP status, error class name and latency in milliseconds.
  - [x] 1.3 Check 1, free tier: one `interactions.create` call with `store: false` and a one-line input. Record success, or the status (403/404/429) and what it means. If the default model is not available on the free tier, pick the newest Flash model that is, and make that the default.
  - [x] 1.4 Check 2, abort and timeout: read the installed SDK's type definitions for a per-request `signal`/`abortSignal` or `httpOptions.timeout` option. Then call with `AbortSignal.timeout(50)` and record whether the promise rejects, how long it takes, and the error class and name. Record the class and `status` field the SDK uses for API errors such as 429, from the types.
  - [x] 1.5 Check 3, nullable fields: send `z.toJSONSchema(ModelTurnSchema)` (copy the schema from design.md into the script) as `response_format.schema`, with an input that should leave most fields null. Record whether the API accepts it and whether `ModelTurnSchema.parse` accepts the output. If it is rejected, try `anyOf: [{type}, {type: "null"}]` and record which form works.
  - [x] 1.6 Fill in the "Verification spike findings" table in design.md. Update any design decision a finding changes, such as falling back to `generateContent`, the timeout mechanism, or the JSON Schema form.
  - Requirements: 4.1, 4.2, 4.4, 4.7, 8.4
  - Done when: `npx vitest run`, `npm run lint` and `npm run build` all pass.

- [x] 2. Project setup
  - [x] 2.1 Keep TypeScript at the installed 5.9 and add `"engines": { "node": ">=20.19" }`. No `tsconfig.json` lib change: Temporal and its types come from `temporal-polyfill`, imported explicitly (`import { Temporal } from "temporal-polyfill"`), never from a global. A one-line test checks that `Temporal.Now.instant()` from that import runs under Vitest.
  - [x] 2.2 Install `drizzle-orm`, `@neondatabase/serverless` and `server-only`, plus dev dependencies `drizzle-kit` and `@electric-sql/pglite`. Decide between the Drizzle v1 RC and the latest 0.x, and record the choice in design.md.
  - [x] 2.3 Add the new names to `.env.example`, without values: `GEMINI_MODEL`, `TURN_LIMIT_PER_VISITOR_PER_MINUTE`, `TURN_LIMIT_GLOBAL_PER_HOUR`, `RATE_LIMIT_SALT`.
  - Requirements: tech.md (Node 20.19+, TypeScript 5.9, Temporal from `temporal-polyfill`, no secrets in the repo)
  - Done when: `npx vitest run`, `npm run lint` and `npm run build` all pass.

- [ ] 3. Booking_Rules (`lib/booking`, pure)
  - [ ] 3.1 `types.ts` and `time.ts`: `toInstant`, `localDateOf`, `sessionsOn`, `overlaps`. Unit tests:
    - Madrid on 28, 29 and 31 March and 24 and 25 October 2026;
    - the synthetic shop open Sundays 01:00–05:00 (3 real hours on 29 March, 5 on 25 October);
    - back-to-back ranges do not overlap.
  - [ ] 3.2 `rules.ts`: `evaluateBooking` and `checkBooking` in the evaluation order of design.md, assigning the first free resource. Unit tests:
    - one test per rejection reason;
    - a second chair is used when the first is busy;
    - `ignoreBookingId` lets a booking move 30 minutes on the same chair;
    - a synthetic pack rule rejects with `sector:<name>`.
  - [ ] 3.3 `slots.ts`: `slotCandidates` and `findNearestSlots` on the `slotStepMin` grid, inside `[max(now, R − 14 d), R + 14 d]`. Unit tests:
    - **the worked example:** at Lola on Wednesday 2026-11-11, `now` 09:00, a haircut at 21:00 is rejected as `outside_hours`, and the alternatives are 19:30, 19:15 and 19:00 on `chair-1`;
    - the two DST companions: Saturday 28 March 21:00 → 19:30 (`18:30Z`), and Sunday 29 March 12:00 → Saturday 19:30, not Tuesday 10:00.
  - [ ] 3.4 `tests/booking/arbitraries.ts`: `arbShop` (always including Lola), `arbNow`, `arbRequest` (minute granularity, biased to session boundaries) and `arbExisting` (built only from accepted requests), as in design.md. Also an exhaustive grid oracle for P4(d).
  - [ ] 3.5 **[PBT] P1.** Outside opening hours is rejected. Validates 9.1, 5.6.
  - [ ] 3.6 **[PBT] P2.** Closed weekdays are rejected. Validates 9.2.
  - [ ] 3.7 **[PBT] P3.** An accepted service ends by its session's close, using real-time arithmetic. Validates 9.3, 5.2.
  - [ ] 3.8 **[PBT] P4.** A rejection comes with the nearest valid grid slot, covering clauses (a) to (e) of design.md. Validates 9.4, 5.5.
  - [ ] 3.9 **[PBT] P5.** The past is rejected. Validates 9.5, 5.3.
  - [ ] 3.10 **[PBT] P6.** A time is rejected when every resource is busy, and accepted on a free resource when at least one is free. Validates 9.6, 5.4, 5.12.
  - [ ] 3.11 **[PBT] P7.** A re-check gives the same verdict, also with `existing` shuffled. Validates 9.7, 5.9.
  - [ ] 3.12 **[PBT] P8.** A meta-test checks the coverage floor: at least 100 requests per property, minute granularity, at least 7 consecutive days, and both 2026 DST weekends hit. Validates 9.8.
  - [ ] 3.13 **[PBT] P9.** No two accepted bookings share a resource and overlap, over sequences of 1–40 requests. Validates 9.9, 5.11. (The database half is in 7.5.)
  - [ ] 3.14 **[PBT] S1.** An unknown `serviceId` is always rejected as `unknown_service`. Validates 5.7.
  - Requirements: 5.1–5.7, 5.11, 5.12, 9.1–9.9
  - Done when: `npx vitest run`, `npm run lint` and `npm run build` all pass.

- [ ] 4. Sector packs (`lib/sectors`, pure)
  - [ ] 4.1 `types.ts`: `SectorPack` and the zod `SectorPackDataSchema`. `registry.ts`: `getSectorPack` validates every pack when the module loads; `term()` looks up vocabulary.
  - [ ] 4.2 `hairSalon.ts`: unit `appointment`, resource kind sillón / chair, required fields service → requestedTime → name → phone, `slotStepMin: 15`, `rules: []`, vocabulary in ES and EN, sensitive topics and things it must never promise.
  - [ ] 4.3 Make the P1–P9 property tests run over every pack in the registry. Unit tests: every pack passes `SectorPackDataSchema`; an unknown id throws; the hair-salon ES vocabulary contains "cita" and never "mesa".
  - Requirements: 11.1–11.5, 4.12
  - Done when: `npx vitest run`, `npm run lint` and `npm run build` all pass.

- [ ] 5. Conversation core, pure parts (`lib/conversation`)
  - [ ] 5.1 `types.ts`: `TurnInput`, `TurnOutput`, `PublicState`, `CallState`, `Effect` and the port types. `shopProfile.ts`: `ShopProfileSchema`. `lib/receptionist/schema.ts`: `ModelTurnSchema` in the form task 1.5 confirmed. `lib/receptionist/phrases.ts`: every templated line in ES and EN, including the same "cannot find the booking" reply for both mismatch cases. Unit tests: the Lola profile from design.md passes `ShopProfileSchema`; every phrase exists in both languages.
  - [ ] 5.2 `fields.ts`: `normalizePhone`, `matchService` and `mergeFields`, with unit tests for accents, synonyms, `+34`, short numbers, and a server value kept when the model returns null.
  - [ ] 5.3 `matchCaller.ts`: `normalizeName` and `matchesCaller` (phone and name must both match; the name ignores case and accents). Unit tests: "maria jose" matches "María José"; the right phone with another name does not match.
  - [ ] 5.4 **[PBT] S7.** For the Booking_Match: case, accent and spacing variants match; a different normalized name or phone never matches; `normalizeName` is idempotent. Validates 12.1, 12.2, 12.7.
  - [ ] 5.5 `limits.ts`: `checkLimits`, with unit tests at exactly 12 and 13 Turns.
  - [ ] 5.6 **[PBT] S6.** `checkLimits` blocks exactly when a count is over its configured limit. Validates 3.9.
  - [ ] 5.7 `ownerMessage.ts`: `buildOwnerMessage` for every outcome (booked, rescheduled, cancelled, answered, message, fallback, abandoned). Unit tests check that every field is filled and that `modelFailed` is set on fallback.
  - [ ] 5.8 `decide.ts`: `decideTurn` following the reply-composition table of design.md. Unit tests:
    - an unknown service;
    - a rejection with 3 alternatives, then "vale, a las siete y media" resolved from `lastOffer`;
    - a read-back sets `awaiting_confirmation`;
    - a confirmation emits `createBooking` and `saveMessage`;
    - a language switch;
    - a question outside the profile;
    - the 20th Turn;
    - reschedule and cancel with a match, with no booking for the phone, and with a name mismatch (both mismatch cases give the same reply and read back nothing);
    - `callerConfirmed: true` outside `awaiting_confirmation` does nothing.
  - [ ] 5.9 **[PBT] S2.** For all model turns and server states, every booking effect carries a verdict that `evaluateBooking` accepts for the same `existing`, and nothing is emitted unless the stage was `awaiting_confirmation`. Validates 5.8, 5.9, 3.11.
  - Requirements: 3.5, 3.6, 3.9, 4.12–4.17, 5.8–5.10, 6.2, 6.3, 6.5, 10.1, 12.1–12.7
  - Done when: `npx vitest run`, `npm run lint` and `npm run build` all pass.

- [ ] 6. Receptionist with a fake model (`lib/receptionist`). Can run in parallel with 7 and 9.
  - [ ] 6.1 `prompt.ts`: `buildSystemInstruction` and `buildInput` as in design.md, with the transcript placed inside delimiters as data. Snapshot tests for Lola in ES and EN; they must contain the name, owner, address, hours in words, prices in €, today's date in Europe/Madrid, the field order, and the reschedule order (phone, then name).
  - [ ] 6.2 `format.ts`: `formatSlot` for ES and EN in the shop's time zone, with unit tests that include a DST date.
  - [ ] 6.3 `speech.ts`: `toSpokenReply`, with unit tests for markdown, emoji, lists and long sentences.
  - [ ] 6.4 **[PBT] S4.** For all strings, `toSpokenReply` returns at most 2 sentences of at most 25 words each, with no markdown or emoji. Validates 4.11.
  - [ ] 6.5 `callModel.ts`: `callReceptionist` with an 8-second timeout (signal plus race), sorting failures into timeout, quota, unavailable and invalid_output. Fakes: `createScriptedModel`, `neverResolves`, `throws429`, `throwsNetwork`, `returnsGarbage`. Unit tests with fake timers: rejection at exactly 8 s; 429 is `quota`; garbage is `invalid_output`. No test touches the network.
  - [ ] 6.6 `geminiClient.ts`: `import "server-only"`. Uses the `interactions.create` call and abort mechanism confirmed in task 1 (top-level `signal`, `retries: { strategy: "none" }`), with the model from `GEMINI_MODEL` and the default (`gemini-3.5-flash-lite`) in one constant. A unit test with a mocked SDK checks the request shape: `store: false`, `response_format`, `thinking_level`, and no sampling parameters.
  - Requirements: 4.1–4.11, 4.13–4.15, 8.2, 8.4, 8.5
  - Done when: `npx vitest run`, `npm run lint` and `npm run build` all pass.

- [ ] 7. Database with PGlite (`lib/db`, `drizzle/`). Can run in parallel with 6 and 9.
  - [ ] 7.1 `schema.ts`: the tables `shops`, `calls`, `bookings`, `messages` and `rate_limits`, with the columns, indexes, unique keys and CHECK constraints from design.md. `drizzle.config.ts`. Generate the first migration.
  - [ ] 7.2 Custom migration `bookings_no_overlap`, made with `drizzle-kit generate --custom`: `btree_gist` plus the partial `EXCLUDE` constraint.
  - [ ] 7.3 `client.ts`: `getDb()`, neon-http, `server-only`, created lazily so that `npm run build` does not need `DATABASE_URL`. `repository.ts`: `createRepository(db)` implementing the `Repository` port, where `commit` maps `23P01` to `booking_overlap`. A test helper runs every migration on PGlite with `btree_gist`.
  - [ ] 7.4 Integration tests on PGlite:
    - overlapping confirmed bookings on one chair are rejected, while the other chair, back-to-back bookings and cancelled rows are allowed;
    - a reschedule batch rolls back completely when the new slot conflicts;
    - one Message and one Booking per Call (unique keys);
    - `hitRateLimits` counts per window;
    - `findCallerBookings` returns only upcoming, confirmed bookings;
    - `closeStaleCalls`.
  - [ ] 7.5 Concurrency test for the database half of P9: 20 concurrent `commit` calls for the same chair and time leave exactly one confirmed row and return 19 `booking_overlap` conflicts. Validates 9.9, 5.11.
  - Requirements: 5.9–5.13, 6.1, 6.2, 6.4, 6.6, 10.4, 10.5, 3.9
  - Done when: `npx vitest run`, `npm run lint` and `npm run build` all pass.

- [ ] 8. `handleTurn` and the Turn_API (voice adapter). Needs 6 and 7.
  - [ ] 8.1 `lib/conversation/handleTurn.ts`: start, say and hangup as in the design sequences. It covers the rate limit, the model call, fresh booking reads, `decideTurn`, `toSpokenReply`, commit with up to 2 retries on `booking_overlap`, the end and retry fallback paths, and the stale-call sweep. All I/O goes through `CoreDeps`.
  - [ ] 8.2 `app/api/turn/route.ts`: `TurnRequestSchema` (`strictObject`, discriminated by `kind`), `makeTurnHandler(deps)`, a hashed `visitorKey` from `x-forwarded-for`, the 200/400/404/503 responses, no `runtime` export, and the sweep in `after()`.
  - [ ] 8.3 **[PBT] S3.** For all JSON bodies with a key outside the schema (for example `fields`, `accepted`, `bookingId`), `TurnRequestSchema` fails and the route returns 400 listing the key. Validates 3.7, 3.11.
  - [ ] 8.4 Scripted full booking call through `POST` with a real `Request`, PGlite and a scripted model, **in Spanish and in English**: greeting, 21:00 rejected with 19:30 offered, "vale, a las siete y media", name, phone, read-back, "sí", confirmation. At the end: `complete: true`, one confirmed booking on a chair, and one Message with every field filled. Validates 8.1, 4.8, 4.13, 4.15, 6.1, 6.2.
  - [ ] 8.5 Scripted failure calls:
    - model timeout and 429, each giving the end fallback and a Message with `model_failed`;
    - invalid output once (the Call continues) and twice (the Call ends);
    - the visitor limit reached mid-call (200, fallback and Message) and on `start` (no Message);
    - a hang-up mid-call (an `abandoned` Message, no Booking, idempotent on repeat);
    - an unknown shop (404);
    - a forged body with `accepted: true` (400);
    - two parallel confirmations for the last free slot (one gets the booking, the other is offered alternatives);
    - reschedule and cancel with a name mismatch (nothing read back).
  - [ ] 8.6 A build check that the client bundle never contains `GEMINI_API_KEY` or `@google/genai`: after `npm run build`, grep `.next/static`. Validates 8.4.
  - Requirements: 3.1–3.11, 4.6–4.10, 5.8–5.10, 6.1–6.6, 8.1–8.5, 10.1–10.5, 12.1–12.7
  - Done when: `npx vitest run`, `npm run lint` and `npm run build` all pass.

- [ ] 9. Voice loop reducer and speech port (`lib/voice`). Needs only 5.1. Can run in parallel with 6, 7 and 8.
  - [ ] 9.1 `callLoop.ts`: the pure reducer with the phases, events and effects of design.md. Recognition starts only after speaking ends; a 15-second client timeout ends the Call and emits `beaconHangup`.
  - [ ] 9.2 `speechPort.ts`: `createWebSpeechPort(window)` (constructor detection, `available()` when present, `phrases` when supported, voice choice with a 1-second wait for `voiceschanged`), `createTypedOnlyPort()` and `createFakeSpeechPort(script)`.
  - [ ] 9.3 Reducer unit tests with the fake port:
    - a complete voice call;
    - `not-allowed` mid-call switches to Typed_Mode in the same Call;
    - no recognition from the start;
    - no synthesis voice (shown only, then listening again);
    - two `no-speech` errors in a row;
    - a language switch restarts recognition in the new language;
    - the client timeout.
  - [ ] 9.4 **[PBT] S5.** For all event sequences, the Call reaches `ended` only through a hang-up, a client timeout or a complete reply, and "type instead" is available in every phase except `ended`. Validates 2.11, 2.12.
  - Requirements: 2.1–2.12
  - Done when: `npx vitest run`, `npm run lint` and `npm run build` all pass.

- [ ] 10. Call_Page. Needs 8 and 9. Can run in parallel with 11.
  - [ ] 10.1 `app/call/[shopId]/page.tsx`: a static shell plus `<Suspense>` around `ShopGate`, which loads the public shop data with `'use cache'` and `cacheTag`. An unknown shop gets the "not found" message and no Call button. Add `error.tsx` for the database being down.
  - [ ] 10.2 `components/call/`: `CallScreen`, `CallButton` (the gold pill with an arrow), `LanguageSwitch` (defaults to `navigator.language`), `Transcript`, `TypedInput`, `TypeInsteadButton` (always visible) and the `useCallLoop` hook. Use the Marfil & Oro tokens, a gold focus ring, `prefers-reduced-motion` and a 360 px layout.
  - [ ] 10.3 Unit tests for `useCallLoop` with the fake speech port and a mocked `fetch`: a `pagehide` and the hang-up button send `hangup` with `keepalive`.
  - Requirements: 1.1–1.9, 2.1–2.12
  - Done when: `npx vitest run`, `npm run lint` and `npm run build` all pass.

- [ ] 11. Seed Peluquería Lola. Needs 7. Can run in parallel with 10.
  - [ ] 11.1 `lib/db/seed.ts` and an `npm run db:seed` script: the Lola profile from design.md, with 2 chairs and the hair-salon pack, and an upsert on the shop name so it never creates a duplicate.
  - [ ] 11.2 PGlite tests: the seeded profile passes `ShopProfileSchema`; running the seed twice leaves exactly one shop.
  - Requirements: 7.1–7.7
  - Done when: `npx vitest run`, `npm run lint` and `npm run build` all pass.

- [ ] 12. Manual Chrome checklist. Needs 10 and 11. Write it to `.kiro/specs/core-call-loop/manual-checklist.md`, run it against the deployed app on Neon, and record pass or fail per line.
  - [ ] 12.1 es-ES on desktop Chrome: a full booking by voice; the owner's Message exists; the transcript is correct; the voice is Spanish.
  - [ ] 12.2 en-US: the same call in English, plus a mid-call switch from ES to EN.
  - [ ] 12.3 Microphone denied: the Call continues in Typed_Mode and the booking can still be completed by typing.
  - [ ] 12.4 A 360 px viewport (DevTools and a real Android phone): no horizontal scroll; the Call button, language switch and "type instead" are visible; the focus ring shows when tabbing; reduced motion turns animations off.
  - [ ] 12.5 An unknown shop URL shows "not found" and no Call button.
  - Requirements: 1.1–1.9, 2.1–2.12, 8.1
  - Done when: `npx vitest run`, `npm run lint` and `npm run build` all pass.

- [ ] 13. Notes for the jury in `NOTAS-KIRO.md`
  - [ ] 13.1 Add one row per thing a property test caught, taken from the "Catch log" below: date, "Property-based tests", which property, the bug, and the fix.
  - [ ] 13.2 Add one row per place the current docs changed a first choice, taken from the table in design.md: Interactions API with `store: false`, the model id and dropped sampling parameters, Temporal from `temporal-polyfill` (the native-Temporal claim did not hold on the real machine), `@google/genai` 2.x for Node 20, no Drizzle `EXCLUDE` builder, neon-http batches, the deprecated Edge runtime and no `runtime` export, `request.ip` removed, `<Suspense>` with Cache Components, `SpeechRecognition.available()`. Add any further finding from task 1.
  - [ ] 13.3 Add one row for the spec review: the four amendments and the six review decisions.
  - Requirements: none (submission notes)
  - Done when: `npx vitest run`, `npm run lint` and `npm run build` all pass.

## Catch log

When a property test fails during tasks 3–9 and the failure shows a real bug (not a broken generator), add one line here before fixing it: task, property, smallest counterexample, cause, fix. Task 13 turns these lines into `NOTAS-KIRO.md` rows.

| Task | Property | Counterexample | Cause | Fix |
|---|---|---|---|---|
