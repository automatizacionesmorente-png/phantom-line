# Implementation Plan: Front Desk Brain

Follow `design.md`. Pure logic comes first, and each piece ships with its tests in the same task. No task is optional. Property-based tests are marked **[PBT]**; each one is its own sub-task and names the property and the requirements it validates. Every property runs at least 100 cases (`numRuns: 200` unless the design says otherwise: B1, B4, B6, B8 and B11 run 100, B14 runs 30, and each says so), and each one asserts that its rare branches were reached, so none passes without testing anything.

Every task finishes only when `npx vitest run --maxWorkers=3 --hookTimeout=120000 --testTimeout=180000 > .measurements/vt.log 2>&1`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass, and the real results are reported, failures included. Long outputs go to `.measurements/`; read the tail.

Never read, print or log `.env.local` or any secret. If a script needs it, run it with `node --env-file=.env.local`. **Do not touch the real database:** every database test runs on PGlite. Kiro never runs a migration, the seed, `scripts/build-voice-cache.ts` (real run) or the Latency_Script against Neon or the deployed demo; those are owner steps (tasks 15.3 and 14). Real Gemini calls happen only in tasks 1.2 and 7.1, each with its request count stated before it runs. The files in `.kiro/specs/owner-machine/` are read only.

Task numbers 1–14 are those of the first approved plan. Tasks 15–21 were added on 2026-11-16 for the reviewer's answers and the Latency group (Requirements 16.5, 17–22). They are listed below in the order they should run, which is why 15 comes right after 1.

## Working beside the other specs

- **owner-machine**: spec files read only. Task 4.4 changes two owner-side helpers to name a Combo_Id, and task 18 adds Not_Urgent_Phrases to the Urgency_Rules (Requirement 16.5). Every other owner-machine test must pass unchanged after them.
- **jury-polish**: tasks 4.3 (N15) and 6.7 (the suggested-reply language defect) stay in jury-polish. Its task 8 and this spec's task 12 both edit `lib/receptionist/cachePlan.ts`; its tasks 5 and 7 edit `app/api/turn/handler.ts` and `lib/conversation/fallbackLog.ts`, which tasks 9, 17 and 19 here also edit; its task 4 tests `lib/voice/neuralVoice.ts`, which tasks 20 and 21 edit; its Call_Page tasks edit `components/call/`, which tasks 16, 20 and 21 edit. Before editing any of them, re-read the file as it is; if another session is changing it, stop and ask.
- **core-call-loop** and **natural-voice**: requirements amended in requirements.md, "Amendments". The tests that pinned the old behaviour are rewritten in tasks 9.9, 16.4, 19.5 and 21.3, each listed with its old and new assertion; none is deleted.

## Dependencies and parallel work

| Task | Needs | Can run in parallel with |
|---|---|---|
| 1 Spike and docs | none | none |
| 15 Latency_Script and before numbers | 1.8 | 2–8, 18 |
| 2 Combo_Ids in the Booking_Rules | 1.4 | 3, 7, 15, 18 |
| 3 First slots from a time | 1.4 | 2, 7, 15, 18 |
| 4 Profile schema and catalog | 2 | 3, 7, 18 |
| 18 Not_Urgent_Phrases | 1 | 2–8, 15 |
| 5 Rich_Profile | 1.5, 4 | 6, 7 |
| 6 Code_Brain readers | 1.3, 4 | 5, 7 |
| 7 Model path constants | 1.1, 1.2 | 2–6 |
| 8 TurnFacts, templates and decideTurn | 3, 5, 6 | 7 |
| 9 handleTurn and the brain path | 7, 8 | 11 |
| 17 Sure_Readings skip the model | 9 | 11, 16 |
| 10 Regression: Real_Call_2026_11_16 | 17 | 11, 12, 16 |
| 11 Prompt | 8 | 9, 10, 12, 16, 17 |
| 12 Cache_Plan tiers 6 and 7 | 5, 8 | 10, 11, 16 |
| 16 Silence_Cut | 1.7 | 2–12, 17 |
| 19 Inline_Audio | 1.8, 17 | 12, 16 |
| 20 Fillers | 1.9, 12, 16, 19 | none |
| 21 Start_Buffer, Timing_Panel and harness | 19, 20 | none |
| 13 Mutation proofs | 10, 18, 21 | none |
| 14 Manual checklist, after numbers and notes | 13, 15.3 | none |

## Tasks

- [x] 1. Spike and docs (no app code)
  - [x] 1.1 Gemini models: from the current Gemini API docs (Context7, or `web_fetch`; if both fail at the permission step, Node's `fetch` into `.measurements/`), the exact id of `gemini-3.5-flash`, whether it is GA or preview, its free-tier RPM and RPD, and whether it accepts `thinking_level: "low"` and ignores `temperature`, `top_p` and `top_k` like the 3.6+ models. Check the same for the two current defaults. Record it in design.md, "Where current documentation changed my first choice". If the docs cannot be read, say so and do not guess.
  - [x] 1.2 SDK abort at the short wait: a throwaway script (`.measurements/`, `node --env-file=.env.local --import tsx`) makes 1 call per default model (3 requests) with the top-level `signal` aborted at 1600 ms, and records each latency and whether the abort held. State the 3 requests before running.
  - [x] 1.3 Chrome's transcript forms: collect the times, numbers and phones in jury-polish's Real_Call_Cases and in the owner's real call notes (no production log holds transcripts, by design), and list them in design.md as the digit forms `readWhen` and `readPhone` must accept. Read the Web Speech API spec's section on results for anything it says about number formatting.
  - [x] 1.4 fast-check: in the installed version's README and types, `fc.mixedCase`, `fc.shuffledSubarray`, `fc.uniqueArray` and `fc.stringMatching`. Record the version and any API that differs from the design's generators.
  - [x] 1.5 Demo facts: the nearest metro stations to Calle Mayor 12, Madrid, and whether Plaza Mayor has a public car park, from Metro de Madrid and the Madrid city council's pages. If they cannot be checked, the `parking` and `como-llegar` answers use the neutral wording in design.md, and the table says why.
  - [x] 1.6 Next.js: in `node_modules/next/dist/docs/`, confirm that `after()` and the default Node.js runtime of route handlers are as the voice adapter uses them; record "no change" or the change.
  - [x] 1.7 Web Speech: from the current Web Speech API spec and MDN, what `stop()` and `abort()` do to a pending final result and to `onend`, and whether interim results keep arriving with `continuous = false`. Record; if `stop()` gives no final, write the change to the Silence_Cut design and ask.
  - [x] 1.8 Streaming: from the bundled Next.js docs and Vercel's functions docs, whether a Node route handler's `ReadableStream` body is flushed per chunk (the first JSON line before the TTS audio exists), and from MDN whether a `Server-Timing` header is readable by same-origin `fetch`. Record.
  - [x] 1.9 Filler playback: from MDN and WebKit's autoplay policy, whether a `blob:` URL set on the already unlocked shared `<audio>` element plays without a new gesture on Safari iOS, and whether a fetched cached line can be reused without a blob. Record, and the manual checklist line that confirms it on a real iPhone.
  - Done when: the docs table in design.md has a finding and a "what it changed" for every row, and the four checks pass (no app code changed).

- [x] 15. Latency_Script and the before numbers (`scripts/measure-latency.ts`, `scripts/lib/`)
  - [x] 15.1 The script as in design.md ("L6: measuring"): `--base`, `--allow-remote`, `--turns`, `--lang`, `--legacy`; scripted Calls (the regression call, an FAQ, a price question, a free question); per stage p50 and p90 (`Server-Timing` when present, time to the reply, to the audio's first byte and to 150 ms of audio, through `/api/speech` in `--legacy` mode); output to `.measurements/latency/`. Before any request it prints the number of Turns, model calls and TTS requests. Unit tests with a fake `fetch`: the percentiles, both modes, a remote base refused without `--allow-remote`, and a missing `Server-Timing` header reported as "n/a", not as 0.
  - [x] 15.2 Run it once against `next dev` on PGlite or a local database only if the owner provides one; otherwise say it was not run. Never against Neon.
    - Not run (2026-11-16): the app reaches its database only through the Neon HTTP driver (`lib/db/client.ts`, `DATABASE_URL`), so `next dev` would use the Neon database in `.env.local`, and no local database was provided. The script was run only for its refusal path (`--base=https://phantom-line.vercel.app --legacy` exits 2 before any request).
  - [x] 15.3 *(Owner step.)* `--legacy` against the deployed demo before any Latency change is deployed, in Spanish and English; the owner keeps the output file. Kiro writes the exact command in the manual checklist and does not run it.
    - Commands written in `manual-checklist.md`, "Before numbers (task 15.3)".
    - Run by the reviewer (2026-11-16): **Spanish baseline only**, which the reviewer accepted for this task. No English before numbers exist; the reviewer keeps the output file and Kiro has not read it.
  - Requirements: 22.2, 22.3

- [x] 2. Service_Combos in the Booking_Rules (`lib/booking/services.ts`)
  - [x] 2.1 `resolveService`, `resolveParts`, `comboId`, `COMBO_SEPARATOR`, `MAX_COMBO_PARTS`, `MAX_COMBO_MIN`. Unit tests: one id, two and three in catalog order, wrong order, a repeated part, an unknown part, 4 parts, a sum of 481 minutes, an empty string, a trailing `+`.
  - [x] 2.2 `evaluateWith` step 1 and both functions of `slots.ts` use `resolveService`. Existing booking tests pass unchanged.
  - [x] 2.3 **[PBT] B5.** A Service_Combo is one service of the summed duration, and every invalid Combo_Id is `unknown_service`. Validates 7.2, 7.3.
  - [x] 2.4 `arbShop` (in `tests/booking/arbitraries.ts`) may draw a Combo_Id as the request's service id. P1–P9 run unchanged against it; no assertion and no `numRuns` change. Record in design.md, "As built in task 2", how often a Combo_Id was drawn.
  - Requirements: 7.2, 7.3, 7.4

- [x] 3. First slots from a time (`lib/booking/slots.ts`)
  - [x] 3.1 `firstSlotsFrom(req, ctx, opts)` on the same slot grid as `findNearestSlots`, with `limit`, `windowDays` and `within`. Unit tests: from inside a session, from between sessions, from a closed day, across both 2026 Madrid DST changes, with `within` morning and afternoon, with everything busy for 14 days.
  - [x] 3.2 **[PBT] B7.** The first slots from a time are the first ones the rules accept (exhaustive grid oracle). Validates 8.1–8.3.
  - Requirements: 8.1–8.3

- [x] 4. Profile schema and catalog (`lib/conversation/shopProfile.ts`, `lib/conversation/catalog.ts`)
  - Result (2026-11-16, later session): 4.1–4.4 audited and kept as they were. The earlier blocker, N15, was not a rounding flake: the 0.020000001 was a shrunk counterexample, and the same run read 2.32 % before shrinking while the spectrum of both signals moved 0.30 %. N15's autocorrelation oracle is replaced by a spectrum-peak oracle (same 2 % limit, generators and run counts; natural-voice design.md, N15, "Changed 2026-11-16"); a deliberate plain-resampling `stretchAll` failed it on the first run, and the code was restored. The new oracle exposes a real `timeStretch.ts` pitch defect at exactly 100 Hz in about 2 of 3000 cases (BACKLOG item 18), so N15 can still fail about 1 suite run in 10 until the owner decides on that fix. Full suite, lint, `tsc` and build pass. Of two full Vitest runs after the change, the first passed (151 files, 1384 tests) and the second failed only core-call-loop's S5 coverage check (500 runs never reached `listening`; a probe with the same generator reached it in 186 of 20000 runs, so all 500 miss it in about 1 suite run in 100), which this task does not touch and is left for the reviewer.
  - [x] 4.1 The schema additions of design.md ("The Shop_Profile schema"): the id pattern, `category`, `goesWith`, `addOnTo`, `priceFrom`, `categories`, `faq`, `voice.endOfSpeechMs` (300–1500, optional), and every cross-reference and uniqueness refine. Unit tests: each refusal (a digit in an answer, 3 sentences, a 26-word sentence, markup, an emoji, a reserved topic id, a repeated FAQ alias, an FAQ alias equal to a service alias, an unknown `goesWith`, `addOnTo` or `category`, an `addOnTo` pointing at an Add_On, a service that is its own Add_On, an id with `+`, `endOfSpeechMs` 299 and 1501), and that `lolaProfile` (V1) and a profile with every new field parse.
  - [x] 4.2 `serviceView(id, shop)` and `catalogLine(shop, lang)`. Unit tests for one service, a Combo_Id of 2 and 3 parts, `priceFrom` on one part, an unknown id (its own id back, so no screen is empty), and the catalog line by Category within 25 words.
  - [x] 4.3 The Receptionist's helpers (`kit.service`, `kit.spokenService`, `kit.catalog`, `serviceInfo`) and `publicStateOf` use `serviceView`. The V1_Profile's texts are unchanged: every existing phrase test passes as it is.
  - [x] 4.4 Owner side: `serviceName` (`lib/owner/machineShop.ts`) and the Agenda label (`lib/owner/agenda.ts`) name a Combo_Id by its parts ("Corte de hombre + Degradado"). New unit tests for a Combo_Id; every owner-machine test passes unchanged.
  - Requirements: 4.10, 7.6, 11.1–11.3, 11.6, 16.1, 17.2

- [x] 18. Not_Urgent_Phrases (`lib/sectors/types.ts`, `hairSalon.ts`, `lib/messages/terms.ts`, `urgency.ts`)
  - [x] 18.1 `vocabulary[lang].notUrgent` in the pack type and its zod schema (optional, same shape as `urgent`); the hair-salon pack's lists of design.md; `maskPhrases`; `ruleOf` step 1 searches masked lines, steps 2–4 unmasked. Every pack still validates at startup.
  - [x] 18.2 Regression unit tests in `tests/messages/urgency.test.ts`: each row of design.md's table ("Not_Urgent_Phrases"), plus "prueba de alergia para hoy" still `today_open` by the term "hoy", in both languages. Before the change, run them to show that "¿Hacéis la prueba de alergia?" fails (urgent today); record it.
  - [x] 18.3 owner-machine M1–M3 (`tests/messages/urgency.property.test.ts`): the oracle gets the masking rule written its own way, and the generators draw Not_Urgent_Phrases next to urgent terms; each property asserts it reached "masked only" and "masked plus another urgent term". No assertion is loosened for lines without a Not_Urgent_Phrase, and no `numRuns` changes. List the changed lines in design.md, "As built in task 18".
  - Requirements: 9.7, 16.1, 16.5

- [x] 5. The Rich_Profile (`lib/db/seed.ts`)
  - Result (2026-11-16): done; see design.md, "As built in task 5". Two `tests/db/seed.test.ts` checks that pinned the old three-service seed (core-call-loop 7.3's service list, and "seed equals the V1 fixture") were rewritten to Requirements 11.4 and 11.7, with the old and new assertions listed there. core-call-loop 7.3 is not in requirements.md's "Amendments" table; left for the owner.
  - [x] 5.1 `lolaSeedProfile` becomes the Rich_Profile of design.md: the Categories, the 19 services with aliases, Goes_With, `addOnTo` and `priceFrom`, the neighbourhood prices of the services table, and the 14 FAQ_Entries in both languages (with the wording task 1.5 allows). The id, owner, address, zone, hours, chairs, voice and speech rate do not change.
  - [x] 5.2 Tests that pin the seed's catalog texts move to the V1_Profile with the same assertions: in `tests/owner/demo.test.ts` and `tests/owner/demo.property.test.ts`, every use of `lolaSeedProfile` except the "is Peluquería Lola, the seeded shop" check. List each changed line in "As built in task 5". `tests/db/seed.test.ts` keeps `lolaSeedProfile`.
  - [x] 5.3 New unit tests for the Rich_Profile: it parses; every service's combination with each of its Goes_With partners fits the morning session; every FAQ answer passes the Spoken_Form check; the catalog line is "Hacemos cortes, barbería, peinados, color y tratamientos." (and its English twin); `serviceView("corte-hombre+degradado")` is 50 minutes and 1800 cents.
  - [x] 5.4 The demo samples (`lib/owner/demo.ts`) and the Cache_Plan's tier 2 still use `shop.services[0]`. Check that with the Rich_Profile they still produce a valid sample and a valid demo conversation, and record the new first service in design.md.
  - Requirements: 11.4, 11.5, 11.7, 11.8, 16.2

- [x] 6. The Code_Brain's readers (`lib/conversation/brain/`)
  - Result (2026-11-16): done; see design.md, "As built in task 6". New tests in `tests/conversation/brain/` (normalize, lexicon, services, when, person, topics, read, and the B3/B13, B9 and B10 property files). B3 found an FAQ alias read inside a longer service alias ("Kids' cut"), and B9(b) found "a haircut for one" read as 13:00; both fixed with regression unit tests. CallFields gains the optional `serviceChoice`, `day` and `partOfDay`; nothing writes them until task 8.
  - [x] 6.1 `normalize.ts` (tokens, plural folding, Damerau–Levenshtein with the length rule) and `lexicon.ts` (both languages, including the filler words of 19.2). Unit tests for each lexicon list; a test that no lexicon word is a service alias, a Category alias or an FAQ alias of the Rich_Profile (3.6); a lint rule that `lib/conversation/brain/` imports nothing from `lib/db` or `lib/receptionist/callModel.ts`.
  - [x] 6.2 `services.ts`: `matchServices` with spans, longest match, the typo rule, the tie rules 5(a)–(c), Goes_With, Add_Ons, Category requests, negation, add mode, the 3-part cap, and the Service_Choice follow-up. Unit tests with the examples of requirements.md (4.3–4.7, 4.10) and design.md ("The Rich_Profile"): "cortarme el pelo y hacerme un degradado" → `["corte-hombre", "degradado"]`; "un degradado" and "corte degradado" alone → the same set; "un corte para mi hija" → `["corte-infantil"]`; "un corte" after an earlier "barba" → `corte-hombre`; a bare "un corte" → a Service_Choice; "sin el corte" with `corte-hombre+degradado` removes both.
  - [x] 6.3 **[PBT] B3** (matcher part: every alias and its variants are found, or make exactly the right Service_Choice, with an Add_On's base added). Validates 4.1–4.4, 4.10.
  - [x] 6.4 **[PBT] B13.** Negation, addition and replacement. Validates 4.6, 4.7, 7.8.
  - [x] 6.5 `when.ts`: `readWhen` with day words, digit days, time words, digit times, noon and midnight, the half-day rule of 5.3, part of the day, corrections, the non-cue filter, and the forms task 1.3 listed. Unit tests with every example of Requirement 5.
  - [x] 6.6 **[PBT] B9.** Days and times are read as said, and only when said. Validates 5.1–5.3, 5.5, 5.7.
  - [x] 6.7 `person.ts`: `readName` and `readPhone`. Unit tests with the examples of Requirement 6, "Hola Lola, quería…" (no name), and a rejected phone.
  - [x] 6.8 **[PBT] B10.** Names and phones are read as said. Validates 6.1–6.4.
  - [x] 6.9 `topics.ts`: `matchTopic` for hours (all, a day, today, tomorrow, now), address, services, price and duration (service, Combo_Id, Service_Choice, Category) and FAQ_Entries, with the urgent-term carve-out of 9.7 and the Sensitive_Hit outside it. Unit tests: each Rich_Profile FAQ_Entry by two aliases in each language; "¿cuánto tarda el color?" is a Category duration; "me ha dado alergia el tinte" is a Sensitive_Hit; "¿hacéis la prueba de alergia?" and "¿hacéis test de alergia?" are the FAQ.
  - [x] 6.10 `read.ts`: `readUtterance` with the Intent order of 3.3, goodbye only alone (3.4), yes and no only first (3.5), the language switch, and `sure` by design.md's table ("What makes a Reading sure"). Unit tests for each line of 3.3's order and each row of the Sure table, sure and not sure. Performance test: the 50 longest pool utterances each read in under 20 ms (2.6).
  - Requirements: 3.1–3.6, 4.1–4.7, 4.10, 5.1–5.7, 6.1–6.5, 9.7, 19.2

- [ ] 7. Model path constants (`lib/receptionist/callModel.ts`, `geminiClient.ts`, `.kiro/steering/tech.md`)
  - Status (2026-11-16): **stopped at 7.1's stop condition, waiting for the owner.** The 45 requests ran (`.measurements/model-wait/repeat15.log`). `gemini-3.5-flash-lite` failed 5 of 15 and answered 3 of 15 under 1.6 s, so no `ATTEMPT_TIMEOUT_MS` was chosen. 7.2 and 7.3 were not built; code, tests and `tech.md` are unchanged. Numbers in design.md, "As built in task 7"; the decisions are open question 17.
  - [ ] 7.1 Measurement: `scripts/check-turn.ts --repeat 15` once per default model (45 requests; check against the RPD of task 1.1 and state the count before running), output to `.measurements/model-wait/`. Apply the rule of design.md ("Model path constants": the 75th percentile, clamped to [900, 1300]) and record the raw numbers, the percentile, the share under 1.6 s and the chosen `ATTEMPT_TIMEOUT_MS` in "As built in task 7". If more than 1 in 5 requests of the first model fail, or fewer than half answer under 1.6 s, stop and ask the owner.
  - [ ] 7.2 `DEFAULT_GEMINI_MODELS` gets `gemini-3.5-flash` third; `MODEL_TIMEOUT_MS` 1600 and the measured `ATTEMPT_TIMEOUT_MS`, `MIN_ATTEMPT_MS`, `MAX_MODEL_ATTEMPTS`. Update the tests that pin the old values (`tests/receptionist/geminiClient.test.ts`, the `callModel` tests): list each one and say whether it pinned a value (updated) or a behaviour (kept, with the new numbers in its setup).
  - [ ] 7.3 `.kiro/steering/tech.md`: the AI line's default list, and the Rules line's budget, attempt deadline and attempt count, in the same words with the new numbers, plus one sentence that the model is not called on a Sure_Reading. Nothing else in the steering file changes.
  - Requirements: 12.1–12.4, 2.3

- [ ] 8. TurnFacts, templates and decideTurn
  - [ ] 8.1 `lib/conversation/facts.ts`: `TurnFacts`, `factsFromModel(turn, reading, shop)` by the table "Who decides what", and `factsFromReading(reading)`. Unit tests for each row of the table.
  - [ ] 8.2 `lib/receptionist/phrases.ts`: every template of design.md ("New templates") in both languages, with Phrase_Variants where marked, and `lib/receptionist/fillers.ts` (Filler texts and kinds, no phrase-book import). Unit tests: each template's Spanish and English text with the Rich_Profile; every one at most 3 sentences of at most 25 words, no digits; the cacheable flag by natural-voice 6.5; at least 2 Filler variants per kind and language.
  - [ ] 8.3 `decideTurn` reads `TurnFacts` and follows design.md, "decideTurn, step by step": Owner_Requests, Sensitive_Hits and unanswered questions as Owner_Notes with Keep_Alive_Lines; Profile_Topic answers, with the flow's next question appended; Service_Request, Service_Choice, Add_On and Category choices; the First_Offer with declines; offer acceptance in `mergeFields`; the brain's templated lines where the model's line was used; the miss counter. The new CallState fields are optional. Every existing `decideTurn` unit test and property (S1–S8) passes, with S2's generator extended by brain facts and offers (no assertion changed).
  - [ ] 8.4 `buildOwnerMessage`: the code-built reason when the Call had brain Turns (10.7), the Owner_Notes after the main reason, outcome `message` when notes remain and nothing was booked (10.6), and `suggested: null` when no Turn had a valid model answer. Unit tests for each.
  - [ ] 8.5 **[PBT] B12.** An accepted offer is not a booking. Validates 8.4, 13.5.
  - [ ] 8.6 **[PBT] B4.** Two or three services in one sentence make one Service_Combo (through `decideTurn` and a memory repository). Validates 7.1, 7.3, 7.5, 4.7. `numRuns: 100`.
  - [ ] 8.7 **[PBT] B6.** The Code_Brain never invents. Validates 9.2, 8.2. `numRuns: 100`.
  - Requirements: 7.5, 7.7, 7.8, 8.1–8.6, 9.1–9.6, 10.1–10.7, 13.1–13.5, 18.3

- [ ] 9. handleTurn and the brain path
  - [ ] 9.1 `tests/conversation/memoryRepository.ts`: an in-memory `Repository` that refuses an overlapping booking on commit with `booking_overlap`. Its own unit tests compare it with the PGlite repository on the same scripted Calls.
  - [ ] 9.2 `handleTurn.say` as in design.md ("handleTurn", steps 1–6): the Reading first, the bookings read in parallel when the times are known, the Model_Wait, `factsFromModel` or `factsFromReading`, no `endWithFallback` for a model failure, the per-visitor limit still ending with `fallback`, the global limit skipping the model. In this task every Reading still calls the model (task 17 adds the skip). `CoreConfig.maxConsecutiveInvalid` is marked deprecated.
  - [ ] 9.3 `fallbackLog.ts`: `path: "brain"`. The redaction test gets a brain case with a name, a phone and an unanswered question in the utterance; the log line holds none of them, nor the key.
  - [ ] 9.4 **[PBT] B1.** A model failure never ends a Call. Validates 1.1–1.3, 1.7. `numRuns: 100`.
  - [ ] 9.5 **[PBT] B8.** The brain answers by the Model_Wait, and a late model changes nothing (fake timers). Validates 2.3–2.5. `numRuns: 100`.
  - [ ] 9.6 **[PBT] B2.** Every FAQ topic gets the profile's answer. Validates 9.1, 9.5, 9.6, 1.1.
  - [ ] 9.7 **[PBT] B3** (conversation part: price, duration and booking frames with a failing model). Validates 9.1, 8.1.
  - [ ] 9.8 **[PBT] B11.** Owner requests and unanswered questions keep the Call alive and reach the Owner. Validates 10.1–10.6. `numRuns: 100`.
  - [ ] 9.9 Rewrite the tests that asserted the old behaviour (Requirement 15.4). For each, record the old assertion, the new one, and what it still protects:
    - `tests/api/turn.failures.test.ts`: a hang, a 503, a 429 and a network error each get the brain's reply with `complete: false`; the timing check keeps its bound with the new Model_Wait; two invalid outputs in a row are two brain replies; a Call that then ends by goodbye has exactly one Message with `modelFailed: true` and the caller's name. These cases use utterances that are not Sure_Readings, so they keep exercising the model path after task 17.
    - `tests/api/turn.urgency.test.ts`: the `fallback` cases run through the per-visitor rate limit (still outcome `fallback`, still `urgent` from "es urgente"); a new case runs a brain-only Call with "es urgente" that ends by goodbye, and its Message is `urgent` with basis `urgent_term`.
    - any other test the full run shows failing because a model failure no longer ends the Call: listed here before it is changed.
  - Requirements: 1.1–1.7, 2.1, 2.3–2.5, 2.7, 12.5, 15.4

- [ ] 17. Sure_Readings skip the model, and `Server-Timing` (`lib/conversation/handleTurn.ts`, `app/api/turn/handler.ts`)
  - [ ] 17.1 `handleTurn.say` steps 4, 5 and 7 of design.md: no model call when `reading.sure`, no `turn_fallback` line, `modelFailed` unchanged, `brainTurns` counted; the stage times returned beside the output.
  - [ ] 17.2 The adapter sets `Server-Timing: brain;dur=…, db;dur=…, model;dur=…, total;dur=…`. Unit test: the header is present on every `say`, holds only those four names and numbers, and `model` is 0 on a Sure_Reading.
  - [ ] 17.3 **[PBT] B15.** A Sure_Reading never calls the model, and says only what was said. Validates 2.2, 2.3, 19.2, 19.3.
  - [ ] 17.4 Performance unit test: `readUtterance` plus `decideTurn` with the memory repository under 50 ms per Turn over the 50 longest pool utterances and every Turn of the regression call (19.1).
  - [ ] 17.5 Re-run the tests of 9.9 and the B-properties of task 9: any that relied on the model being called for a Sure_Reading is listed with its old and new setup (an utterance that is not sure, so the same behaviour is still tested); none is deleted.
  - Requirements: 2.2, 2.3, 12.5, 19.1–19.4

- [ ] 10. Regression: Real_Call_2026_11_16 (`tests/api/turn.realCall1116.test.ts`, PGlite)
  - [ ] 10.1 The Spanish call as in design.md ("Testing strategy"): Rich_Profile, `NOW` Saturday 2026-11-14 19:30 Madrid, and three model fakes (always 503, hang, 429). Turn by turn: "Hola Lola quería cortarme el pelo y hacerme un degradado" → the First_Offer for `corte-hombre+degradado` ("… son cincuenta minutos y dieciocho euros. ¿Te viene bien el martes a las diez? …"); "sí" → the name ask; "Me llamo Ana" → the phone ask (the pack requires the phone); "612 345 678" → the read-back with the total price; "sí" → `booked`. One booking row from 10:00 to 10:50 Madrid on `chair-1` with the Combo_Id; one Message, outcome `booked`; every Turn a Sure_Reading, so each model fake records zero calls and no `turn_fallback` line is written; no reply is the Fallback_Message; `complete: false` until the last Turn. The first reply is also compared once with a literal string.
  - [ ] 10.2 The fourth run: the first utterance with three unplaceable words added, so the model is called and fails (each of the three fakes); the first reply is the same First_Offer, there is one `turn_fallback` line with `path: "brain"` for that Turn, and the Message has `modelFailed: true`.
  - [ ] 10.3 The English twin: "Hi Lola, I'd like a haircut and a fade", then "yes", "My name is Ann", "+34 612 345 678", "yes".
  - [ ] 10.4 The same call with a healthy scripted model whose `service` is "cortarme el pelo y un degradado", on the not-sure variant of 10.2: the same Combo_Id and First_Offer (the code's facts on the model path, 13.2).
  - Requirements: 15.1, 15.2, 7.1–7.5, 8.1, 8.4, 13.2, 2.2

- [ ] 11. Prompt (`lib/receptionist/prompt.ts`, `schema.ts`)
  - [ ] 11.1 The `service` field's description asks for every service the caller named, joined with " y " / " and ". The system instruction lists the Categories, marks "desde" prices, and includes the FAQ answers as facts the model may repeat. Prompt tests: the Rich_Profile's prompt contains each FAQ answer and no digit-written price; the V1_Profile's prompt is unchanged except for the `service` description (pinned diff).
  - Requirements: 4.9, 13.1

- [ ] 12. Cache_Plan tiers 6 and 7 (`lib/receptionist/cachePlan.ts`, `buildVoiceCache.ts`)
  - [ ] 12.1 Tier 6 (pinned Fillers) and tier 7 (profile answers) as in design.md; `PINNED_TIERS` gains 6. Check how `buildVoiceCache.ts` orders work under the budget and, if needed, build pinned tiers first; record what it did before and after. Unit tests: tier 6 holds every Filler variant per language; tier 7 lines for the Rich_Profile in Spanish, none with a day, all cacheable; the build refuses a Filler over 900 ms of audio (fake TTS).
  - [ ] 12.2 **[PBT] B14.** Tiers 6 and 7 only append. Validates 14.2, 18.5. `numRuns: 30`, 120 s timeout.
  - [ ] 12.3 Size: the Rich_Profile's full plan (lines and estimated bytes, per tier) against `voiceCacheBudget.ts`, recorded in "As built in task 12". If it does not fit, stop and ask before trimming (14.3). No audio is built in this task.
  - Requirements: 14.1–14.4, 18.5, 18.6

- [ ] 16. The Silence_Cut (`lib/voice/endOfSpeech.ts`, `lib/voice/speechPort.ts`, `lib/voice/publicShop.ts`)
  - [ ] 16.1 The reducer of design.md ("L1: the Silence_Cut"). Unit tests with fake timers: a cut at 600 ms; a pause of 550 ms then more words (no cut); a late final equal to the sent text (Transcript only), with extra words (carried), with a corrected word (Transcript only); `REC_END` with no interim results (Chrome's final sent).
  - [ ] 16.2 **[PBT] B16.** One utterance per listen, at the Silence_Cut. Validates 17.1, 17.3–17.5.
  - [ ] 16.3 The Web Speech port runs the reducer with 50 ms ticks, calls `rec.stop()` at the cut, reports End_Of_Speech with the result, and puts carried words in front of the next utterance; `endOfSpeechMs` comes from the public shop data (default 600). Port unit tests with a fake recognition object, including that `abort()` is not called at the cut.
  - [ ] 16.4 Re-run `tests/voice/speechPort.test.ts`, `callLoop` tests and their properties. Any test that pinned "the utterance is Chrome's final" is listed with its old and new assertion before it is changed.
  - Requirements: 17.1–17.6

- [ ] 19. Inline_Audio (`lib/voice/turnStream.ts`, `app/api/speech/stream.ts`, `app/api/turn/handler.ts`, `lib/voice/turnRequest.ts`)
  - [ ] 19.1 The encoder and decoder of design.md ("L4"). Unit tests for each header kind, a body cut before the second line, and a first line that is not JSON.
  - [ ] 19.2 **[PBT] B18.** The Inline_Audio stream decodes the same however it is split. Validates 20.1, 20.5.
  - [ ] 19.3 `speechStream` extracted from `/api/speech`'s `say`; `/api/speech`'s tests pass unchanged against it.
  - [ ] 19.4 `/api/turn` with `audio: "inline"` on `say`: the first line as soon as `handleTurn` returns, then the audio header and PCM, or the cache URL, or `none`. `TurnRequestSchema` gains the optional key. Handler tests with fakes: a cached hit, a live line, a 429 on every TTS model (`none`/`quota`), a TTS error before the first chunk (`none`/`unavailable`), an error after it (body ends early), a request without the key (today's JSON, byte for byte), and the TTS limits counted once per reply.
  - [ ] 19.5 The browser runner (`neuralVoice.ts`, `useCallLoop`) reads the stream: the text to the call loop at once, the audio to the player, one retry through `/api/speech` by 20.4. Unit tests with a fake `fetch`. Any test that pinned "live audio comes from `/api/speech`" is listed with its old and new assertion before it is changed.
  - Requirements: 20.1–20.5

- [ ] 20. Fillers (`lib/voice/filler.ts`, the Call_Page, `neuralVoice.ts`)
  - [ ] 20.1 `fillerKind`, `pickFiller` and the `fillerDecision` reducer of design.md ("L2"). Unit tests: each kind from example utterances in both languages; no variant twice in a row; no Filler in Typed_Mode or with the browser voice. `scripts/check-client-bundle.mjs` passes with the lexicon in the browser bundle.
  - [ ] 20.2 **[PBT] B17.** A Filler only when it helps, never twice. Validates 18.1, 18.2, 18.4, 18.6, 18.8, 22.4.
  - [ ] 20.3 Preload at Call start and on a language switch (the Filler list in the public shop data: text, key, url), and playback through the shared element before the reply. DOM test (jsdom): no Filler text in the Transcript or in the `conversation` sent to the server; a Filler whose fetch failed is skipped.
  - Requirements: 18.1–18.8

- [ ] 21. Start_Buffer, Timing_Panel and the timing harness (`lib/voice/voiceDecision.ts`, `lib/voice/timing.ts`, `tests/voice/latencyHarness.ts`)
  - [ ] 21.1 `startBufferMs` and `underruns` in `voiceDecision`; the runner passes 150 or 300 by the Call's underruns.
  - [ ] 21.2 **[PBT] B19.** The Start_Buffer adapts and N12 still holds. Validates 21.1, 21.2.
  - [ ] 21.3 N12 and every `voiceDecision` unit test run unchanged with `startBufferMs: 300`; tests that pinned `START_BUFFER_MS` as a value are listed and updated, tests that pinned a behaviour keep it.
  - [ ] 21.4 The Timing_Panel (`?timing=1`) with `lib/voice/timing.ts`. Unit tests for the percentiles; a DOM test that the panel is absent without the parameter and holds no utterance or reply text with it.
  - [ ] 21.5 The timing harness and the scenarios of design.md ("L6: measuring"), each as a unit test with its expected times.
  - Requirements: 21.1–21.3, 22.4, 22.5

- [ ] 13. Mutation proofs
  - [ ] 13.1 Make each mutation of design.md's table, run the named property or test, record the result and the shrunk counterexample in design.md ("Mutation proofs"), and restore the code. A mutation that no test catches is recorded as such, with the test added to catch it, never hidden.
  - Requirements: 15.5

- [ ] 14. Manual checklist, after numbers and notes
  - [ ] 14.1 `.kiro/specs/front-desk-brain/manual-checklist.md` for the owner, written from the code as it is: run the seed (owner step), then on the deployed app (a) a call with `GEMINI_MODEL` set to an id that answers 404, so every model Turn is the brain: the Real_Call_2026_11_16 books end to end by voice in Chrome; (b) five FAQ questions by voice and by typing, including "¿hacéis la prueba de alergia?" (the Message is not urgent) and "me ha dado alergia el tinte" (urgent); (c) "quiero hablar con Lola" mid-booking; (d) "un degradado" alone and "un corte para mi hija"; (e) the Owner's machine shows "Corte de hombre + Degradado" on the Tape and in the Agenda, and moving it keeps both parts; (f) the Filler on a real iPhone and in Chrome on Android (task 1.9). Each check has a "Result / date" line.
  - [ ] 14.2 *(Owner step.)* After every Latency change is deployed: the Latency_Script without `--legacy`, with the same Turns as 15.3, and at least 20 voice Turns in Chrome with `?timing=1`, copying the panel's numbers. Kiro writes the commands and the table to fill in; it does not run them.
  - [ ] 14.3 `NOTAS-KIRO.md`: one row for the spec itself (what the production log showed and what the design changed), one row with the before and after numbers per stage and the underruns once the owner has them (22.3; a missed target is recorded as missed, with its slowest stage), and one row per property that caught a real bug or a wrong generator, and per doc that changed a choice in task 1.
  - Requirements: 15.5, 22.1, 22.3, 22.6, and the working rules of the Introduction
