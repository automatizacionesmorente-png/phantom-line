# Implementation Plan: Owner Machine

Follow `design.md`, including the review decisions of 2026-11-13 at its end. Pure logic comes first, and each piece ships with its tests in the same task. No task is optional. Property-based tests are marked **[PBT]**; each one is its own sub-task and names the property and the requirements it validates. Every property runs at least 100 cases (`numRuns: 200` unless the design says otherwise; the PGlite properties run 50 and say so), and the time-based ones hit both 2026 Madrid DST weekends (Requirement 15.6).

Every task finishes only when `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass, and the real results are reported, failures included.

Never read, print or log `.env.local` or any secret. If a script needs it, run it with `node --env-file=.env.local`. **Do not touch the real database:** every database test runs on PGlite. Kiro never runs `npm run db:seed`, `drizzle-kit migrate` or `drizzle-kit push` against Neon; applying migrations 0002 and 0003 to Neon is a human step in the manual checklist (task 12). (Renumbered in task 8: they are `0003_owner_machine` and `0004_machine_triggers`, after natural-voice's `0002_voice_cache`.)

## Working beside the natural-voice session

Another session is changing `lib/receptionist`, `lib/conversation` and `lib/voice` for `.kiro/specs/natural-voice`. Tasks 1–8, 10 and 11 do not edit any file in those three directories (they only import from them). **Task 9 is the only task that edits them, and it starts only after natural-voice has landed on the main branch.** Before task 9 starts, re-read the files it changes as they are then, and stop and ask if natural-voice changed `buildOwnerMessage`, the `Write` / `Effect` types, the end-of-Call paths in `handleTurn.ts` or the `phrases(lang).owner` signatures in a way that `design.md` does not cover.

## Dependencies and parallel work

| Task | Needs | Can run in parallel with |
|---|---|---|
| 1 Spike and setup | none | none |
| 2 Urgency rules | 1 | 4, 5 |
| 3 Tape, texts and tape player | 2.2 | 4, 5, 7 |
| 4 Agenda and moves | 1 | 2, 3, 5, 6, 7 |
| 5 PIN, session and limits | 1 | 2, 3, 4, 6, 7 |
| 6 Poll contract and poll loop | 3 | 4, 5, 7, 8 |
| 7 Demo rules and samples | 2 | 3, 4, 5, 6 |
| 8 Database | 2, 4, 7 | 5, 6 |
| 9 End-of-Call urgency in the conversation core | 2, 8, **natural-voice landed** | 10 (except 10.9), 11 |
| 10 Machine_API | 3, 4, 5, 6, 8 (10.9 also needs 9) | 9, 11 |
| 11 Machine_Page, landing page, demo notice | 3, 4, 6, 10 | 9 |
| 12 Manual checklist | 9, 10, 11 | none |
| 13 Notes | 12 | none |

- **Inside tasks:** in task 2, the property sub-tasks 2.5–2.7 are independent once 2.4 exists. In task 3, 3.2–3.4 are independent once 3.1 exists. In task 4, the property sub-tasks 4.6–4.10 are independent once 4.5 exists. In task 8, the PGlite properties 8.8–8.11 are independent once 8.5 exists. In task 11, the components can be built against the pure reducers and a fake `fetch` before task 10 is done; only 11.5 needs the real routes.

## Tasks

- [x] 1. Verification spike and setup
  - [x] 1.1 PGlite triggers: a throwaway Vitest file on PGlite 0.5.16 creates a table, a `plpgsql` function and a `CREATE CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED`, commits one write, and checks the trigger ran at commit and not before. Record the result in design.md, "Where current documentation changed my first choice", open question 1. If it does not work, stop and ask before choosing a fallback. Delete the throwaway file afterwards.
  - [x] 1.2 Versions, read from the registry and from the packages' own `package.json` (`engines`, `peerDependencies`, `exports`): the current `lucide-react` (React 19.3 in its peer range? a per-icon entry point?), and the newest `jsdom` and `@testing-library/react` that support Node 20.19 and React 19.3. If the network is not available, say so and stop: do not guess versions.
  - [x] 1.3 Install `lucide-react` (dependency) and `jsdom` and `@testing-library/react` (dev dependencies) at the versions from 1.2. Nothing else.
  - [x] 1.4 Vitest: add `tests/**/*.test.tsx` to `include`, keep `environment: "node"`. Write one smoke DOM test, `tests/components/smoke.test.tsx` with `// @vitest-environment jsdom`, that renders a `<button>` with Testing Library and finds it by role. Record whether `.tsx` transformed without `@vitejs/plugin-react`; if a plugin is needed, stop and ask. Record whether the installed jsdom implements `HTMLDialogElement.prototype.showModal`.
  - [x] 1.5 Vercel Cron on Hobby: from the current Vercel docs, the number of cron jobs and the smallest interval on the free plan, and the header that carries `CRON_SECRET`. Record the answer and its source URL. If a daily job is not available on Hobby, record that 16.6 falls back to request-time triggers and say so in the report.
  - [x] 1.6 Neon free plan: the current compute-hours allowance and scale-to-zero delay, with the source URL, for the manual checklist's cost note (open question 4).
  - [x] 1.7 `.env.example` gains the names, without values: `OWNER_SESSION_SECRET`, `DEMO_OWNER_PIN`, `PIN_LIMIT_PER_VISITOR_PER_15MIN`, `PIN_LIMIT_PER_SHOP_PER_HOUR`, `CRON_SECRET`.
  - [x] 1.8 Fill in the open questions in design.md with the findings, and update any design decision a finding changes.
  - Requirements: 7.9, 12.4, 13.9, 16.6, 16.8; tech.md (dependencies few and well known, no secrets in the repo)
  - Done when: `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass.

- [x] 2. Urgency rules (`lib/sectors`, `lib/messages`, pure). Can run in parallel with 4 and 5.
  - [x] 2.1 `lib/sectors/types.ts`: `urgent` and `today` term lists per language in the vocabulary; `VocabularyKey` limited to the string entries so `term()` is unchanged; `SectorPackDataSchema` validates 1–40 terms of 1–40 characters with no duplicates after normalization. `lib/sectors/hairSalon.ts`: the Spanish and English terms from design.md. Unit tests: every pack still passes the schema; a pack with a duplicate term after normalization ("Alergia", "alergia") fails; the hair-salon lists contain "alergia" and "today".
  - [x] 2.2 `lib/messages/terms.ts`: `normalizeForMatch`, `wordsOf`, `findTerm`, reusing `normalizeName` from `lib/conversation/matchCaller.ts` (import only). `lib/messages/urgency.ts`: `Urgency`, `FinalUrgency` (branded), `UrgencyBasis`, `UrgencyInput`, `decideUrgency`, `maxUrgency`, in the rule order of design.md. Unit tests:
    - "HOY," matches "hoy"; "Lo antes   posible" matches "lo antes posible"; "alérgica" matches "alergica"; "hoyo" does not match "hoy";
    - "no es urgente" raises to `urgent` (5.11);
    - a Receptionist line "¿A qué hora te viene bien hoy?" does not raise (5.10);
    - the today rule on 29 March and 25 October 2026 in Europe/Madrid, `open` and `handled`;
    - `model_failed` gives at least `normal`; no suggestion gives the rule alone (5.8);
    - the initial `"normal"` of a Call with no valid Turn is not a suggestion.
  - [x] 2.3 Move `lib/messages.ts` to `lib/messages/index.ts`; `formatMessageCount` gains `lang` ("1 mensaje nuevo", "3 new messages"). The existing smoke test still passes unchanged.
  - [x] 2.4 `tests/messages/arbitraries.ts`: `arbCallerLines` (with near-misses "hoyo", "alergólogo", "painting"), `arbTermVariant(term)`, `arbOutcome`, `arbSuggested`; reuses `arbNow` from `tests/booking/arbitraries.ts`. All run over `allSectorPacks()`.
  - [x] 2.5 **[PBT] M1.** The Final_Urgency is never below the rule or the suggestion, and the rule equals an independent table oracle of 5.3–5.7. Validates 15.1, 5.3–5.8.
  - [x] 2.6 **[PBT] M2.** An urgent term inserted in any case, accent, spacing and punctuation variant always gives `urgent` with basis `urgent_term`. Validates 15.2, 5.3, 5.9.
  - [x] 2.7 **[PBT] M3.** Only whole words in the Caller's lines count: terms moved to Receptionist lines do not count, terms glued to letters do not match, `normalizeForMatch` is idempotent. Validates 5.9, 5.10.
  - Requirements: 5.1–5.12, 6.3, 15.1, 15.2, 15.6
  - Done when: `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass.

- [x] 3. Tape, texts and tape player (`lib/messages`, `lib/owner`, pure). Needs 2.2. Can run in parallel with 4, 5 and 7.
  - [x] 3.1 `lib/messages/tape.ts`: `TapeEntry`, `orderTape`, `tapeCounts`, `lightState`, `lightAnnouncement` (ES and EN, singular and plural, "No new messages"), `urgencyBasisText` (quotes the pack's term, never the caller's sentence). Unit tests for each, including `lightAnnouncement` for 0, 1 and 3 messages in both languages.
  - [x] 3.2 `lib/owner/format.ts`: `formatClock` and `formatDayHeading`, self-contained (no import from `lib/receptionist/format.ts`). Unit tests on 29 March and 25 October 2026 in Madrid, "7:30 pm" / "19:30", "Viernes 13" / "Friday the 13th".
  - [x] 3.3 `lib/messages/currentReply.ts` and `lib/messages/agreedText.ts`, using `phrases(lang).owner` (import only). Unit tests:
    - `currentReply` after an owner move (new time) and an owner cancel; unchanged when the caller changed it;
    - `agreedText` for booked, rescheduled, moved and cancelled Bookings, in ES and EN;
    - the Spanish `agreedText` of an unchanged Booking equals what `buildOwnerMessage` stored for it.
  - [x] 3.4 `lib/owner/tapePlayer.ts`: the reducer with `SNAPSHOT`, `PLAY`, `NEXT`, `STOP`, `ERASE`, `ERASED`, `TRANSCRIPT` and its effects. Unit tests: PLAY freezes the order; a Message arriving during playback joins at the next PLAY; an older snapshot is ignored; NEXT skips an id erased since PLAY.
  - [x] 3.5 **[PBT] M5.** Erase is permanent on the page: for all event sequences with snapshots in any order, an erased id never comes back in `items`, the rest of `queue` or `playing`, and `version` never decreases. Validates 8.1, 7.5, 7.6.
  - [x] 3.6 **[PBT] M6.** Tape order, counts and light: `orderTape` is a permutation in Tape_Order; `tapeCounts` matches a direct count; `lightState` is `blinking`, `steady` or `off` exactly as defined. Validates 7.1, 6.3, 6.4.
  - Requirements: 4.6, 4.7, 6.3, 6.4, 6.8, 7.1, 7.2, 7.5, 7.6, 8.1, 9.2, 13.2
  - Done when: `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass.
  - Result (2026-11-16): every test of this task passes, as do lint, tsc and build. The jsdom smoke test of task 1 could not start: iCloud had evicted css-tree files in node_modules (design.md, "Found in task 3"). It is not caused by this task, but it must be fixed before task 11.

- [x] 4. Agenda and moves (`lib/booking`, `lib/owner`, pure). Can run in parallel with 2, 3, 5, 6 and 7.
  - [x] 4.1 `lib/booking/rules.ts`: `preferResource`. Unit test: only the order changes; the other resources keep theirs.
  - [x] 4.2 `lib/booking/slots.ts`: `daySlots`. Unit tests: Lola on a Saturday with one chair busy at 17:00 lists 17:00 on the other chair; a closed day lists nothing; the 23-hour and 25-hour days list the right local times.
  - [x] 4.3 `lib/owner/agenda.ts`: `agendaWindow`, `agendaStatus`, `allowedActions`, `groupAgenda`, `agendaWhat`. Unit tests: `agendaStatus` for the three states; a booking at 23:30 local on the last day is in, one at 00:00 the day after is out; empty days are present.
  - [x] 4.4 `lib/owner/move.ts`: `MOVE_WINDOW_DAYS`, `moveDays`, `moveContext`, `decideMove`. Unit tests: one per rejection (`not_movable`, `outside_move_window`, each Booking_Rules reason), each carrying the fresh `daySlots`; a 30-minute move on the same chair is accepted thanks to `ignoreBookingId`; a move keeps the chair when free and takes the other when not.
  - [x] 4.5 Generators: extend `tests/booking/arbitraries.ts` with an `arbAgendaBooking` built from accepted requests, and an `arbMoveStart` at minute granularity from −2 to +16 days.
  - [x] 4.6 **[PBT] M7.** A move is accepted exactly when `allowedActions` allows it, the start is in `moveDays` and `evaluateBooking` with the booking ignored accepts; an accepted move is free on its resource and keeps the booking's own resource whenever that one is free. Validates 15.4, 10.4, 10.6, 10.9.
  - [x] 4.7 **[PBT] M8.** `daySlots` are exactly the accepted grid starts of the day, in time order, with no duplicates. Validates 10.3, 15.4. (This and M7 are the property tests of the new `lib/booking` rules `daySlots` and `preferResource`, as `structure.md` requires.)
  - [x] 4.8 **[PBT] M9, pure half.** Over sequences of 1–40 caller requests and owner moves applied to an in-memory agenda, no two active bookings share a resource and overlap. Validates 15.5, 10.5. (The database half is 8.11.)
  - [x] 4.9 **[PBT] M10.** `groupAgenda` returns 8 consecutive local days; every booking in the window appears once, on its local day; active before cancelled, each sorted by start. Validates 9.1, 9.4.
  - [x] 4.10 **[PBT] M11.** Allowed actions: none for a cancelled or started booking; otherwise move and cancel, and confirm only while unconfirmed. Validates 10.1, 10.2.
  - [x] 4.11 Extend P8's coverage meta-test to M7–M10: at least 100 cases each, both DST weekends hit. Validates 15.6.
  - Requirements: 9.1–9.4, 10.1–10.4, 10.6, 10.9, 15.4, 15.5, 15.6
  - Result (2026-11-16): every test of this task passes, five mutation checks were caught (design.md, "As built in task 4"), and lint, tsc and build pass. The full Vitest run still reports one error: the jsdom smoke test cannot start, because iCloud has evicted the css-tree files (unchanged since task 3, and not caused by this task).
  - Done when: `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass.

- [x] 5. PIN, session and limits (`lib/owner`, pure). Can run in parallel with 2, 3, 4, 6 and 7.
  - [x] 5.1 `lib/owner/pin.ts`: `PIN_PATTERN`, `hashPin`, `verifyPin` with async `crypto.scrypt` and `timingSafeEqual`. Unit tests: round trip; wrong PIN; malformed stored hash returns false without throwing; two hashes of one PIN differ (random salt).
  - [x] 5.2 `lib/owner/session.ts`: `SESSION_COOKIE`, `SESSION_HOURS`, `signSession`, `verifySession`, `normalizeLabel`. Unit tests: each failure reason; a label with control characters and runs of spaces; the empty label defaults to "Dueño" / "Owner".
  - [x] 5.3 `lib/owner/limits.ts`: `pinLimitsFromEnv`, `checkPinAttempts`, `pinCounterKeys` with the `demo` flag. Unit tests: window starts at 15-minute and 1-hour boundaries; the Demo_Shop gets only the visitor key; malformed env values fall back to 5 and 30.
  - [x] 5.4 **[PBT] M12.** Session tokens verify exactly when shop, expiry and PIN version match; any one-character change or another secret fails. Validates 1.8.
  - [x] 5.5 **[PBT] M13.** `checkPinAttempts` blocks exactly at the configured limits, visitor first; for the Demo_Shop the shop count is ignored and only the visitor key is produced. Validates 2.2, 2.3.
  - Requirements: 1.3, 1.8, 2.1–2.3
  - Result (2026-11-16): every test of this task passes (four mutation checks caught, design.md "Findings from task 5"), and lint (0 errors), tsc and build pass. The full Vitest run still reports one error: the jsdom smoke test cannot start because iCloud has evicted css-tree files (now `Lexer.Lexer is not a constructor`, from the `dataless` `Lexer.cjs`). This task did not cause it.
  - Done when: `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass.

- [x] 6. Poll contract and poll loop (`lib/owner`, pure). Needs 3. Can run in parallel with 4, 5, 7 and 8.
  - [x] 6.1 `lib/owner/api.ts`: the zod `strictObject` request schemas and the response types of the Machine_API table, including `TapeItem` with `agreed` and `sample`, shared with the browser and with no server imports. Unit tests: every schema rejects an unknown key; a move without `revision` is rejected.
  - [x] 6.2 `lib/owner/poll.ts`: `pollResponse`. Unit tests: the unchanged body has exactly `changed`, `version`, `counts`; the changed body has `tape` and `agenda`; `Cache-Control` is set by the handler, not here.
  - [x] 6.3 `lib/owner/pollLoop.ts`: the reducer with `POLL_MS`, `IDLE_POLL_MS`, `IDLE_AFTER_MS`, `MAX_BACKOFF_MS`, and `hasNewMessage`. Unit tests: backoff 5, 10, 20, 40, 60, 60 s; hidden stops; visible fetches at once; 401 goes to the gate; Idle after exactly 15 minutes; input while Idle fetches at once; a new id ends Idle.
  - [x] 6.4 **[PBT] M14.** The Poll body: the small body under 200 bytes with exactly its three keys when `since === version`, the full one otherwise, and no `TapeItem` with a transcript key. Validates 12.2, 12.3, 14.2.
  - [x] 6.5 **[PBT] M18.** The Poll loop: no fetch while hidden, every schedule between 5 and 60 s, no fetch after 401, an immediate fetch on becoming visible. Validates 12.1, 12.6, 12.7.
  - [x] 6.6 **[PBT] M19.** Idle slowdown: the next schedule is the backoff while failing, else 30 s exactly when the last input or new Message is at least 15 minutes old, else 5 s; input while Idle fetches at once; a new id returns to 5 s. Validates 15.8, 12.9.
  - Requirements: 12.1–12.3, 12.6, 12.7, 12.9, 14.2, 15.8
  - Result (2026-11-16): every test of this task passes (5 files, 26 tests; five mutation checks caught, design.md "As built in task 6"), and lint (0 errors), tsc and build pass. The full Vitest run still reports the jsdom smoke test error (iCloud-evicted css-tree, unchanged since task 3). One full run also failed natural-voice's N15 (`tests/voice/timeStretch.property.test.ts`, seed -1208337310: a period error of 0.020000000001527955 against a strict < 0.02); it passed in the run before. This task did not touch it.
  - Done when: `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass.

- [x] 7. Demo rules and samples (`lib/owner/demo.ts`, pure). Needs 2. Can run in parallel with 3, 4, 5 and 6.
  - [x] 7.1 `DEMO_SHOP_ID`, `isDemoShop`, the retention constants, `demoCutoffs`, `samplesToRestore`, `demoNotice`. Unit tests: `demoCutoffs` uses exact hours across the 25 October change; `demoNotice` in ES and EN is exactly the approved wording.
  - [x] 7.2 `demoSamples`: the three fixed samples of design.md, in the Shop's first language, through `decideUrgency`. Unit tests: the urgent sample is `urgent` with basis `urgent_term`; the booking sample is `normal`, on the next open day, and creates no Booking; the question sample is `low`; names carry "(ejemplo)" / "(example)"; phones are `+34 000 000 001`–`003`.
  - [x] 7.3 **[PBT] M20.** Samples restore the Tape and never repeat: no keys when the Tape has 3 or more; otherwise exactly the missing keys; the urgent sample is always urgent; the booking sample's day is after today and accepted by `evaluateBooking` on an empty agenda. Validates 16.4, 16.5.
  - Requirements: 3.2, 3.3, 7.12, 16.4, 16.5
  - Result (2026-11-16): every test of this task passes (2 files, 15 tests; two mutation checks caught, design.md "As built in task 7"), and lint (0 errors), tsc and build pass. The full Vitest run still reports the jsdom smoke test error (iCloud-evicted css-tree, unchanged since task 3).
  - Done when: `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass.

- [x] 8. Database (`lib/db`, `drizzle/`, `lib/owner/demoRetention.ts`), PGlite only. Needs 2, 4 and 7. Can run in parallel with 5 and 6.
  - [x] 8.1 `lib/db/schema.ts`: the additions to `shops`, `bookings` and `messages` (including `demo_swept_at`, `sample_key` and `messages_sample_uq`), the `owner_actions` table, the checks and indexes of design.md. Generate `drizzle/0002_owner_machine.sql` with `drizzle-kit generate --name=owner_machine`; check that every new column is nullable or has a default.
  - [x] 8.2 Custom migration `drizzle/0003_machine_triggers.sql` (`drizzle-kit generate --custom --name=machine_triggers`): `bump_machine_version` with the two deferred constraint triggers, and `bump_booking_revision`, in the form task 1.1 confirmed.
  - [x] 8.3 `lib/db/repository.ts`: `cancelBooking` sets `cancelled_by = 'caller'`; `insertMessage` writes `urgency_suggested` and `urgency_basis` when given (both nullable until task 9). `tests/db/pglite.ts`: `reset()` also truncates `owner_actions`.
  - [x] 8.4 `lib/db/ownerRepository.ts`: every `OwnerRepository` method, each `OwnerCommand` as one statement (data-modifying CTE), and the four Demo_Retention methods acting only on `DEMO_SHOP_ID`. `lib/owner/demoRetention.ts`: `runDemoRetention` with the claim, the cutoffs, the samples and the `demo_retention` log line.
  - [x] 8.5 `lib/db/seed.ts`: the shop id from `DEMO_SHOP_ID`; the PIN hash from `DEMO_OWNER_PIN` only when it is exactly 6 digits and no longer verifies against the stored hash. PGlite tests: a missing or malformed PIN leaves the Shop without one and prints that it did; re-seeding with the same PIN keeps the hash and `owner_pin_set_at`.
  - [x] 8.6 Integration tests on PGlite:
    - migrations 0000–0003 apply; the triggers exist; `revision` increments on a caller cancel;
    - every `OwnerCommand`: `applied`, `noop`, `stale`, `not_found`, `overlap`, each with or without its Audit_Record as required (11.3); erase twice records one Audit_Record (8.2);
    - no statement can set `erased_at` back to `NULL` (8.3); erasing a Message leaves its Booking unchanged (8.4);
    - Demo_Retention: the claim returns true once in 10 minutes even with 10 concurrent calls; a failing step logs one `demo_retention` line with counts only and does not throw.
  - [x] 8.7 A log test: every `demo_retention` and `owner_auth` line written in these tests contains none of the seeded names, phones, reasons or transcript lines. Validates 14.4, 16.7.
  - [x] 8.8 **[PBT] M4.** Erase is permanent in the database over sequences of finishing, playing, erasing, repeated erasing, late end-of-Call writes and polls. `numRuns: 50`. Validates 15.3, 8.1, 8.2.
  - [x] 8.9 **[PBT] M15.** Every write that changes a row bumps its own shop's Machine_Version and no other's; a write that changes no row bumps nothing. `numRuns: 50`. Validates 12.4.
  - [x] 8.10 **[PBT] M16.** Audit_Records match applied actions exactly, hold the after-state, and never contain a seeded name or phone. `numRuns: 50`. Validates 11.1–11.4.
  - [x] 8.11 **[PBT] M21.** Demo_Retention in the database: after a run, the Demo_Shop meets every clause of 15.7; every Real_Shop row is unchanged; a second run is refused by the claim, and a forced second run changes nothing. `numRuns: 50`. Validates 15.7, 16.1–16.4, 16.6.
  - [x] 8.12 M9, database half: 20 concurrent owner moves and caller bookings for the same chair and time on PGlite leave exactly one active row; every loser gets `overlap` or a caller-side conflict. Validates 15.5, 10.5.
  - Requirements: 2.1, 2.4, 2.6, 8.1–8.4, 10.5, 10.7, 10.8, 11.1–11.5, 12.4, 14.4, 15.3, 15.5, 15.7, 16.1–16.4, 16.6, 16.7
  - Result (2026-11-16): the migrations are numbered 0003 and 0004, because natural-voice landed `0002_voice_cache.sql` first (design.md, "As built in task 8"). 0004 also adds a trigger that refuses to clear `erased_at` (8.3). 8.7 checks every `demo_retention` line; no `owner_auth` line exists until task 10, which extends the check. The 11 database test files (82 tests) pass, three mutation checks were caught (one only after a new unit test and a new M16 clause), and lint (0 errors), tsc and build pass. The full Vitest run still reports the jsdom smoke test error (iCloud-evicted css-tree, unchanged since task 3).
  - Done when: `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass.

- [x] 9. End-of-Call urgency in the conversation core. Needs 2 and 8, and **starts only after natural-voice has landed**. Can run in parallel with 10 (except 10.9) and 11.
  - [x] 9.1 Re-read `lib/conversation/ownerMessage.ts`, `types.ts`, `handleTurn.ts`, `lib/db/repository.ts` (`closeStaleCalls`) and `lib/receptionist/phrases.ts` as natural-voice left them. If they differ from what design.md assumes, stop and ask.
  - [x] 9.2 `lib/conversation/ownerMessage.ts` returns an `OwnerMessageDraft`; new `lib/conversation/messageWrite.ts` calls `decideUrgency`; `Write.insertMessage` requires the branded `FinalUrgency`, so `npx tsc --noEmit` fails for any path that skips it.
  - [x] 9.3 Route all five end-of-Call paths through `messageWrite`: `writesFor`, `endWithFallback`, `giveUpAfterConflicts`, `hangup`, and `closeStaleCalls`.
  - [x] 9.4 Scripted tests through the Turn_API on PGlite with a scripted model: a Caller line "es urgente" with a model that says `low` stores `urgent` with basis `urgent_term`, through the completed, hang-up, fallback and stale-sweep paths; the suggested urgency is stored next to it; a Receptionist line with "hoy" does not raise. Every existing test still passes. The only allowed change to an existing test is the one 9.2 forces (`buildOwnerMessage` now returns a draft); each such change is listed in the report with the reason.
  - Requirements: 4.1–4.5, 5.6, 5.8, 5.10
  - Result (2026-11-16): `messageWrite` is the only producer of an `insertMessage` write on the five end-of-Call paths; `closeStaleCalls` gained an optional `now` that the sweep passes (design.md, "As built in task 9"). New tests: `tests/conversation/messageWrite.test.ts` (7, including two `@ts-expect-error` type checks) and `tests/api/turn.urgency.test.ts` (8, PGlite, completed / hang-up / two fallbacks / give-up / stale sweep, Receptionist "hoy", model `urgent` never lowered). Two mutation checks caught. Existing tests changed only where 9.2 forced it: `tests/conversation/ownerMessage.test.ts` reads `suggested` instead of `urgency` (the early-failure case now expects `null`, the initial "normal" is not a suggestion), and `tests/db/helpers.ts` casts its fixture's urgency to `FinalUrgency` and writes `NULL` suggestion and basis. Full Vitest: 127 files, 1142 tests pass, plus the jsdom smoke test error (iCloud-evicted css-tree, unchanged since task 3). Lint 0 errors, tsc and build pass.
  - Done when: `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass.

- [x] 10. Machine_API (`app/api/machine`, `app/api/cron`, `lib/owner/handleOwner.ts`). Needs 3, 4, 5, 6 and 8; 10.9 also needs 9. Can run in parallel with 9 and 11.
  - [x] 10.1 Move `visitorKeyOf` to `app/api/visitorKey.ts`; `app/api/turn/handler.ts` imports it, with no other change. The Turn_API tests pass unchanged.
  - [x] 10.2 `lib/owner/handleOwner.ts`: `handleLogin`, `handlePoll`, `handleMessageAction`, `handleBookingAction`, `handleSlots`, with I/O only through `OwnerDeps`; the Demo_Retention calls in login and Poll for the Demo_Shop only.
  - [x] 10.3 `app/api/machine/handlers.ts`: `makeMachineHandlers(deps)` with the request checks of design.md (Origin, `Content-Type`, strict schemas, shop lookup, session), `Cache-Control: no-store` on every response, and the `owner_auth` and `owner_error` log lines. Thin route files with `RouteContext<…>` and no `runtime` export.
  - [x] 10.4 `app/api/cron/demo-retention/route.ts` and `vercel.json` (one daily entry), checking `Authorization: Bearer ${CRON_SECRET}` with `timingSafeEqual`, in the form task 1.5 confirmed.
  - [x] 10.5 Login tests with real `Request` objects on PGlite: right PIN sets `__Host-pl_owner` with `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/` and 12 hours; wrong PIN gives the same message every time; the 6th try in 15 minutes is `429` even with the right PIN; 31 tries in an hour from 31 Visitors are `429` for a Real_Shop and not for the Demo_Shop; a wrong `Origin` is `403`; no PIN set is `409`; a missing `OWNER_SESSION_SECRET` is `503`; `DELETE` on the session clears the cookie and the next Poll is `401` (1.9).
  - [x] 10.6 Action tests: play returns the transcript and marks Heard once; erase twice is idempotent; confirm, move and cancel answer `stale`, `not_allowed`, `rejected` with slots and `taken` with slots as in the table; the slots route rejects a date outside `moveDays`; with a valid session, no response body contains the PIN hash, the session secret or another Shop's data (14.3).
  - [x] 10.7 Demo_Retention trigger tests: a demo login with 10-day-old data runs it before the `204`; a Poll 1 minute later does not run it again; a Real_Shop login and Poll never call it; the cron route is `401` without the secret, with a wrong one, and when `CRON_SECRET` is unset, and `204` with it.
  - [x] 10.8 **[PBT] M17.** Nothing personal without a session: for all routes, methods, bodies and queries, with no cookie or a malformed, expired, other-shop or wrong-signature cookie, no response contains a seeded name, phone, reason, transcript line or booking time. `numRuns: 100`. Validates 14.1, 1.2, 1.8.
  - [x] 10.9 **The demo acceptance, scripted** (needs 9): a full Spanish booking call through `makeTurnHandler` with a scripted model, then the Poll handler with the previous version returns `changed: true`, the Message first on the Tape with `heard: false` (light `blinking`), and the Booking in the Agenda on its day. Validates 12.5 (the real 5-second timing is checked by hand in task 12).
  - Requirements: 1.3–1.5, 1.7–1.10, 2.2, 2.3, 2.5, 7.4, 7.6, 8.2, 10.1–10.9, 12.2, 12.3, 12.5, 12.8, 14.1–14.4, 14.6, 16.6, 16.8
  - Result (2026-11-16): `lib/owner/handleOwner.ts`, `app/api/machine/handlers.ts` and its five route files, the cron route and `vercel.json` (`0 4 * * *`) are in; design.md, "As built in task 10", lists what differs from the sketch. New test files: `machine.login` (21), `machine.actions` (22), `machine.demo` (11), `machine.errors` (7), `machine.nosession.property` (M17, 100 runs, plus a control test) and `machine.acceptance` (10.9), all on PGlite. Four mutation checks caught (NOTAS-KIRO.md). Full Vitest: 133 files, 1 failed test (N15 `timeStretch.property`, period error 0.0200006 against `< 0.02`, seed -984890761, untouched by this task) and the jsdom smoke error (iCloud-evicted css-tree, unchanged since task 3). Lint 0 errors, tsc and build pass.
  - Done when: `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass.

- [x] 11. Machine_Page, landing page and demo notice (`app/machine`, `components/machine`, `app/page.tsx`, `components/call`). Needs 3, 4, 6 and 10. Can run in parallel with 9.
  - [x] 11.1 `app/machine/[shopId]/page.tsx` (static shell and `<Suspense>`), `MachineGate.tsx`, `loadMachine.ts`, `error.tsx`, as in design.md: unknown shop, no PIN, PIN_Gate, machine; Demo_Retention before the first snapshot for the Demo_Shop.
  - [x] 11.2 `components/machine/`: every component of the module layout, one per file, with the Marfil & Oro tokens, Newsreader / Inter / Caveat, the `focus-ring` class on every focusable control, `data-light`, the reduced-motion switches, Lucide icons (`aria-hidden`, with text labels), native `<dialog>` for move and cancel, the "Sample" badge, `lang` on every stored or rendered text block, 44 × 44 px controls and a 360 px layout.
  - [x] 11.3 `useMachinePoll` and `useTapePlayer` wire the pure reducers to `fetch`, timers, `visibilitychange` and the input listeners (at most one `INPUT` per second).
  - [x] 11.4 Demo_Notice: `DemoNotice` on the PIN_Gate and the machine of the Demo_Shop; `app/call/[shopId]/page.tsx` passes `demo={isDemoShop(shop.id)}` to `CallScreen`, which shows it before the Call starts. `app/page.tsx`: the two demo links (machine to `/machine/peluqueria-lola`), the PIN from `DEMO_OWNER_PIN` at build time, the Demo_Notice; no PIN line when it is unset. No file in `lib/voice` changes.
  - [x] 11.5 `tests/design/contrast.test.ts`: every text/background pair the machine uses meets 4.5:1 (normal) or 3:1 (large); the `focus-ring` rule exists and uses `--gold`; the light's blink and flicker keyframes, read from `globals.css`, change opacity at most 3 times in any one second (13.5).
  - [x] 11.6 DOM test, keyboard order (`tests/components/machine/keyboard.test.tsx`, jsdom): the tabbable elements of the PIN_Gate and of the machine in both views are in the order of design.md; no `tabindex` above 0; only the selected tab is tabbable; ArrowRight and ArrowLeft move between the tabs. Validates 13.1, 13.6, 13.9.
  - [x] 11.7 DOM test, focus ring: every tabbable element of the PIN_Gate and the machine has `focus-ring`. Validates 13.1, 13.9.
  - [x] 11.8 DOM test, live region: exactly one polite `role="status"`; a scripted Poll with one more unheard Message changes its text to the new `lightAnnouncement`; a Poll with the same counts leaves it unchanged. Validates 13.2, 13.9.
  - [x] 11.9 DOM test, reduced motion: with `prefers-reduced-motion: reduce`, no blink or flicker class on the light, no spin class on the reels while playing, every Transcript line visible; with motion allowed, the same render has those classes. Validates 13.4, 13.9.
  - [x] 11.10 DOM tests for the Demo_Notice (shown for the Demo_Shop on the PIN_Gate, the machine and the Call_Page before the Call; absent for a Real_Shop) and for the PIN_Gate showing no Counter, light state or Message data. If task 1.4 found `showModal()` in jsdom, also: the move and cancel dialogs take focus, close with Escape and return focus to their opener. Validates 1.2, 3.3, 13.6.
  - Result (2026-11-16): `app/machine/[shopId]` (page, MachineGate, loadMachine, error), `lib/owner/machineView.ts` and `machineShop.ts`, 29 files in `components/machine` (21 components, 4 hooks, 4 helpers), `components/call/ShopNotFound.tsx` (shared), the landing page and the call page's Demo_Notice are in; design.md, "As built in task 11", lists what differs from the sketch. New tests: `tests/design/contrast.test.ts` (25), five DOM files in `tests/components/machine` (keyboard 6, focus ring 4, live region 3, reduced motion 5, Demo_Notice and PIN_Gate 6), `tests/owner/machineView.test.ts` (7, PGlite) and `withAgendaItem.test.ts` (5). Six mutation checks caught (NOTAS-KIRO.md). The dialog focus checks stay in task 12.4 (jsdom 29 has no `showModal()`). Full Vitest: 142 files, 1269 tests, all pass; lint 0 errors (2 warnings in `.measurements/` scratch files); tsc and build pass. The local `DEMO_OWNER_PIN` has 4 digits, so the seed sets no PIN and the landing page shows none (2.6, 3.4); see the report.
  - Requirements: 1.1, 1.2, 1.4–1.7, 1.9, 3.1–3.4, 6.1–6.8, 7.1–7.12, 9.1–9.5, 10.3, 10.5, 10.8, 12.5–12.7, 12.9, 13.1–13.7, 13.9, 14.5, 14.6
  - Done when: `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass.

- [ ] 12. Manual checklist. Needs 9, 10 and 11. Write it to `.kiro/specs/owner-machine/manual-checklist.md`. The owner runs it against the deployed app on Neon and records pass or fail per line; Kiro does not run it against the real database.
  - Status (2026-11-16): the checklist is written, with one section per sub-task below and a "Result / date" line for each check. It has not been run yet, so no sub-task is ticked (the same as core-call-loop's task 12): each one is ticked when the owner records a pass. Written from the code as it is now, two facts changed it: the migrations to apply are 0003 and 0004 (design.md, "As built in task 8"), and the PIN must be exactly 6 digits (glossary, 2.6; the seed, the landing page and the PIN_Gate all enforce it), so a 4-digit demo PIN such as 1980 would leave the demo machine "not set up". The checklist says so before check 1 and leaves the choice to the owner.
  - Audit (2026-11-16, after the move to ~/Projects): every command, file name, log line, label and announcement the checklist quotes was checked against the code as it is (`scripts/migrate.mjs`, `scripts/seed.ts`, `lib/db/seed.ts`, `vercel.json`, `app/page.tsx`, `components/machine/machineCopy.ts`, `lib/messages/tape.ts`, `lib/owner/demo.ts`, `lib/owner/session.ts`) and matches. An "After the run" section says how results map to the ticks. The 4-digit demo PIN 1980 is still not a valid Owner_PIN under 2.6; that choice stays with the owner.
  - Result (2026-11-16): the first full Vitest run failed M17 on a generator bug (catch log, task 12), fixed without changing the property. The second full run: 142 files, 1269 tests, 1268 pass; the 1 failure is natural-voice's N15 (`timeStretch.property`, period error 0.02000000000006203 against `< 0.02`, seed 1938273802), the same boundary flake seen in tasks 6 and 10, not touched here. Lint 0 errors (2 warnings in `.measurements/` scratch files), tsc and build pass. Sub-tasks 12.1–12.8 and task 12 stay unticked until the owner records a pass for each section of the checklist.
  - Re-audit (2026-11-16, later): the working tree was checked again and `manual-checklist.md` is complete (sections 1–8 map to 12.1–12.8, "After the run" explains the ticks). Nothing in it needed changing. Full Vitest with `--maxWorkers=3`: 142 files, 1269 tests, all pass (N15 did not flake this time); `npm run lint` 0 errors (2 warnings in `.measurements/` scratch files); `npx tsc --noEmit` clean; `npm run build` passes, `check-client-bundle` OK. The 4-digit demo PIN 1980 is still not a valid Owner_PIN (6 digits, 2.6). 12.1–12.8 and task 12 stay unticked because they need the owner's pass on the deployed app.
  - Re-audit (2026-11-16, 12:59, after the jsdom/iCloud fix): `manual-checklist.md` re-read in full and its quoted strings re-checked against `lib/db/seed.ts`, `vercel.json`, `machineCopy.ts` and `drizzle/` (0003 and 0004 are the owner-machine migrations; the "0002 and 0003" in 12.1 below is stale text, kept as approved). Nothing needed changing. Full Vitest with `--maxWorkers=3`: 142 files, 1269 tests, all pass; `npx tsc --noEmit` clean; `npm run lint` 0 errors (2 warnings in `.measurements/` scratch files); `npm run build` passes, `check-client-bundle` OK. The demo PIN 1980 is still 4 digits and still not a valid Owner_PIN (2.6). 12.1–12.8 stay unticked: each needs the owner's recorded pass on the deployed app.
  - [ ] 12.1 Before the run (human steps): apply migrations 0002 and 0003 to Neon; set `OWNER_SESSION_SECRET`, `DEMO_OWNER_PIN`, `CRON_SECRET` on Vercel; run the seed; check the cron job is listed in the Vercel dashboard.
  - [ ] 12.2 Chrome desktop: the landing page shows the PIN and the Demo_Notice; the PIN_Gate opens the machine; a live booking call on `/call/peluqueria-lola` makes the light blink on an open machine within 5 seconds plus the round trip, with the Booking in the Agenda; PLAY reveals the Transcript and turns the reels; NEXT, ERASE and COPY REPLY work; move and cancel work and show who did them; after 15 minutes without input the Network tab shows Polls every 30 s, and one key press brings a Poll at once.
  - [ ] 12.3 Android phone (Chrome): the same login and one booking at 360 px; no horizontal scroll; every control is easy to tap; the Demo_Notice is visible without scrolling on the call page and the machine.
  - [ ] 12.4 Keyboard only: the whole PIN_Gate and machine, including both tabs, the move dialog and the cancel dialog; the gold focus ring is visible on every control; Escape closes the dialogs and focus returns to the opener.
  - [ ] 12.5 VoiceOver (macOS Safari or iOS): the counter and the "N new messages, M not played yet" announcement when a call arrives; a played Transcript is read in full; the urgency and Channel are read as text; the Spanish Message text is read with a Spanish voice when the labels are English.
  - [ ] 12.6 Reduced motion (OS setting): the light is steady, the reels do not turn, the Transcript appears at once.
  - [ ] 12.7 **Lighthouse accessibility ≥ 95** in Chrome DevTools, mobile, on `/machine/peluqueria-lola`, on the PIN_Gate and on the machine after login ("Clear storage" unchecked). Record both scores.
  - [ ] 12.8 Demo_Retention on the real demo: the Tape shows the 3 samples marked "Ejemplo" when it has fewer than 3 Messages; the `demo_retention` log line appears in the Vercel logs with counts only. Record the Neon compute hours used in one day with a machine left open, next to the allowance found in task 1.6.
  - Requirements: 3.1–3.4, 6.1–6.8, 7.1–7.12, 12.5, 12.9, 13.1–13.8, 16.4–16.7
  - Done when: `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass.

- [ ] 13. Notes for the jury in `NOTAS-KIRO.md`
  - [ ] 13.1 One row per thing a property test caught, from the catch log below: date, "Property-based tests", which property, the bug, and the fix. One row per mutation check result, including any mutation no property caught.
  - [ ] 13.2 One row per place the docs changed a first choice: `lucide-react` optimized by default in Next.js 16.4.5, Vitest's optional `jsdom` peer and per-file environment, and every finding of task 1 (PGlite deferred triggers, package versions, Vercel Cron on Hobby, Neon limits).
  - [ ] 13.3 One row for the spec review: the 14 review decisions, and the four choices made while applying them (Bookings in the 7-day deletion, "Sample" badge, when retention runs with the daily cron, the demo shop recognised by id). One row for working beside the natural-voice session: which files were left alone and why task 9 waited.
  - Requirements: none (submission notes)
  - Done when: `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass.

## Catch log

When a property test fails during tasks 2–11 and the failure shows a real bug (not a broken generator), add one line here before fixing it: task, property, smallest counterexample, cause, fix. If the generator was wrong, say so in the line and fix the generator; never weaken a property to make it pass. Task 13 turns these lines into `NOTAS-KIRO.md` rows.

| Task | Property | Counterexample | Cause | Fix |
|---|---|---|---|---|
| 12 (full run) | M17 | seed 267098037: a Poll on the Demo_Shop with the "otherShop" cookie answered 200 | Generator, not code: "otherShop" always signed a Demo_Shop token, so for a request to the Demo_Shop it was a valid session of the same shop. The handler was right to answer 200. Reached only when `shop` drew "demo" (1 in 11) together with that cookie | `cookieOptions` now signs the token for the shop the request does not address (REAL for the Demo_Shop, DEMO otherwise). The property, its assertions and `numRuns: 100` are unchanged; the failing seed passes |

### Mutation checks

Before a property sub-task is ticked, break the code on purpose as listed, run the suite, record what failed and the shrunk counterexample, and restore the code (suite green again). If no property catches a mutation, write that down; do not adjust the property to catch it after the fact without saying so.

| Task | Mutation | Expected to fail | What failed | Smallest counterexample |
|---|---|---|---|---|
| 2 | Search Receptionist lines too | M3 (a) | | |
| 2 | Compare without removing accents | M2 | | |
| 3 | Apply snapshots without the version check | M5 | | |
| 4 | Skip `ignoreBookingId` in `decideMove` | M7 | | |
| 6 | `pollResponse` returns the small body whenever `since` is not null, whatever the version | M14 | | |
| 6 | Keep polling at 5 s while Idle | M19 | | |
| 7 | Restore all 3 samples without checking the active keys | M20 | | |
| 8 | Plain `AFTER` trigger instead of the deferred constraint trigger | 8.12 concurrency test (40P01) | | |
| 8 | Drop the `shop_id` filter from one Demo_Retention statement | M21 (a Real_Shop row changes) | | |
