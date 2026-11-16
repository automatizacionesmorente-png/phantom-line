# Implementation Plan: Front Desk Brain

Follow `design.md`. Pure logic comes first, and each piece ships with its tests in the same task. No task is optional. Property-based tests are marked **[PBT]**; each one is its own sub-task and names the property and the requirements it validates. Every property runs at least 100 cases (`numRuns: 200` unless the design says otherwise: B1, B4, B6, B8 and B11 run 100, B14 runs 30, and each says so), and each one asserts that its rare branches were reached, so none passes without testing anything.

Every task finishes only when `npx vitest run --maxWorkers=3 --hookTimeout=120000 --testTimeout=180000 > .measurements/vt.log 2>&1`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass, and the real results are reported, failures included. Long outputs go to `.measurements/`; read the tail.

Never read, print or log `.env.local` or any secret. If a script needs it, run it with `node --env-file=.env.local`. **Do not touch the real database:** every database test runs on PGlite. Kiro never runs a migration, the seed or `scripts/build-voice-cache.ts` (real run) against Neon; those are owner steps (task 14). Real Gemini calls happen only in tasks 1.2 and 7.1, each with its request count stated before it runs. The files in `.kiro/specs/owner-machine/` are read only.

## Working beside the other specs

- **owner-machine**: spec files read only. Task 4.4 changes two owner-side helpers to name a Combo_Id; every owner-machine test must still pass after it.
- **jury-polish**: tasks 4.3 (N15) and the suggested-reply language defect stay in jury-polish. Its task 8 and this spec's task 12 both edit `lib/receptionist/cachePlan.ts`, and its tasks 5 and 7 edit `app/api/turn/handler.ts` and `lib/conversation/fallbackLog.ts`, which task 9 here also edits. Before editing any of them, re-read the file as it is; if another session is changing it, stop and ask.
- **core-call-loop**: requirements 4.6 and 4.7 are amended (requirements.md, "Amendments"). The tests that pinned the old behaviour are rewritten in task 9.9, each listed with its old and new assertion; none is deleted.

## Dependencies and parallel work

| Task | Needs | Can run in parallel with |
|---|---|---|
| 1 Spike and docs | none | none |
| 2 Combo_Ids in the Booking_Rules | 1.4 | 3, 7 |
| 3 First slots from a time | 1.4 | 2, 7 |
| 4 Profile schema and catalog | 2 | 3, 7 |
| 5 Rich_Profile | 1.5, 4 | 6, 7 |
| 6 Code_Brain readers | 1.3, 4 | 5, 7 |
| 7 Model path constants | 1.1, 1.2 | 2–6 |
| 8 TurnFacts, templates and decideTurn | 3, 5, 6 | 7 |
| 9 handleTurn and the brain path | 7, 8 | 11 |
| 10 Regression: Real_Call_2026_11_16 | 9 | 11, 12 |
| 11 Prompt | 8 | 9, 10, 12 |
| 12 Cache_Plan tier 6 | 5, 8 | 10, 11 |
| 13 Mutation proofs | 10 | none |
| 14 Manual checklist and notes | 10–13 | none |

## Tasks

- [ ] 1. Spike and docs (no app code)
  - [ ] 1.1 Gemini models: from the current Gemini API docs (Context7, or `web_fetch`; if both fail at the permission step, Node's `fetch` into `.measurements/`), the exact id of `gemini-3.5-flash`, whether it is GA or preview, its free-tier RPM and RPD, and whether it accepts `thinking_level: "low"` and ignores `temperature`, `top_p` and `top_k` like the 3.6+ models. Check the same for the two current defaults. Record it in design.md, "Where current documentation changed my first choice". If the docs cannot be read, say so and do not guess.
  - [ ] 1.2 SDK abort at the short wait: a throwaway script (`.measurements/`, `node --env-file=.env.local --import tsx`) makes 1 call per default model (3 requests) with the top-level `signal` aborted at 2600 ms, and records each latency and whether the abort held. State the 3 requests before running.
  - [ ] 1.3 Chrome's transcript forms: collect the times, numbers and phones in jury-polish's Real_Call_Cases and in the owner's real call notes (no production log holds transcripts, by design), and list them in design.md as the digit forms `readWhen` and `readPhone` must accept. Read the Web Speech API spec's section on results for anything it says about number formatting.
  - [ ] 1.4 fast-check: in the installed version's README and types, `fc.mixedCase`, `fc.shuffledSubarray`, `fc.uniqueArray` and `fc.stringMatching`. Record the version and any API that differs from the design's generators.
  - [ ] 1.5 Demo facts: the nearest metro stations to Calle Mayor 12, Madrid, and whether Plaza Mayor has a public car park, from Metro de Madrid and the Madrid city council's pages. If they cannot be checked, the `parking` and `como-llegar` answers use the neutral wording in design.md, and the table says why.
  - [ ] 1.6 Next.js: in `node_modules/next/dist/docs/`, confirm that `after()` and the default Node.js runtime of route handlers are as the voice adapter uses them; record "no change" or the change.
  - Done when: the docs table in design.md has a finding and a "what it changed" for every row, and the four checks pass (no app code changed).

- [ ] 2. Service_Combos in the Booking_Rules (`lib/booking/services.ts`)
  - [ ] 2.1 `resolveService`, `resolveParts`, `comboId`, `COMBO_SEPARATOR`, `MAX_COMBO_PARTS`, `MAX_COMBO_MIN`. Unit tests: one id, two and three in catalog order, wrong order, a repeated part, an unknown part, 4 parts, a sum of 481 minutes, an empty string, a trailing `+`.
  - [ ] 2.2 `evaluateWith` step 1 and both functions of `slots.ts` use `resolveService`. Existing booking tests pass unchanged.
  - [ ] 2.3 **[PBT] B5.** A Service_Combo is one service of the summed duration, and every invalid Combo_Id is `unknown_service`. Validates 7.2, 7.3.
  - [ ] 2.4 `arbShop` (in `tests/booking/arbitraries.ts`) may draw a Combo_Id as the request's service id. P1–P9 run unchanged against it; no assertion and no `numRuns` change. Record in design.md, "As built in task 2", how often a Combo_Id was drawn.
  - Requirements: 7.2, 7.3, 7.4

- [ ] 3. First slots from a time (`lib/booking/slots.ts`)
  - [ ] 3.1 `firstSlotsFrom(req, ctx, opts)` on the same slot grid as `findNearestSlots`, with `limit`, `windowDays` and `within`. Unit tests: from inside a session, from between sessions, from a closed day, across both 2026 Madrid DST changes, with `within` morning and afternoon, with everything busy for 14 days.
  - [ ] 3.2 **[PBT] B7.** The first slots from a time are the first ones the rules accept (exhaustive grid oracle). Validates 8.1–8.3.
  - Requirements: 8.1–8.3

- [ ] 4. Profile schema and catalog (`lib/conversation/shopProfile.ts`, `lib/conversation/catalog.ts`)
  - [ ] 4.1 The schema additions of design.md ("The Shop_Profile schema"): the id pattern, `category`, `goesWith`, `priceFrom`, `categories`, `faq`, and every cross-reference and uniqueness refine. Unit tests: each refusal (a digit in an answer, 3 sentences, a 26-word sentence, markup, an emoji, a reserved topic id, a repeated FAQ alias, an FAQ alias equal to a service alias, an unknown `goesWith` or `category`, an id with `+`), and that `lolaProfile` (V1) and a profile with every new field parse.
  - [ ] 4.2 `serviceView(id, shop)` and `catalogLine(shop, lang)`. Unit tests for one service, a Combo_Id of 2 and 3 parts, `priceFrom` on one part, an unknown id (its own id back, so no screen is empty), and the catalog line by Category within 25 words.
  - [ ] 4.3 The Receptionist's helpers (`kit.service`, `kit.spokenService`, `kit.catalog`, `serviceInfo`) and `publicStateOf` use `serviceView`. The V1_Profile's texts are unchanged: every existing phrase test passes as it is.
  - [ ] 4.4 Owner side: `serviceName` (`lib/owner/machineShop.ts`) and the Agenda label (`lib/owner/agenda.ts`) name a Combo_Id by its parts ("Corte de hombre + Degradado"). New unit tests for a Combo_Id; every owner-machine test passes unchanged.
  - Requirements: 7.6, 11.1–11.3, 11.6, 16.1

- [ ] 5. The Rich_Profile (`lib/db/seed.ts`)
  - [ ] 5.1 `lolaSeedProfile` becomes the Rich_Profile of design.md: the Categories, the 19 services with aliases, Goes_With and `priceFrom`, and the 14 FAQ_Entries in both languages (with the wording task 1.5 allows). The id, owner, address, zone, hours, chairs, voice and speech rate do not change.
  - [ ] 5.2 Tests that pin the seed's catalog texts move to the V1_Profile with the same assertions: in `tests/owner/demo.test.ts` and `tests/owner/demo.property.test.ts`, every use of `lolaSeedProfile` except the "is Peluquería Lola, the seeded shop" check. List each changed line in "As built in task 5". `tests/db/seed.test.ts` keeps `lolaSeedProfile`.
  - [ ] 5.3 New unit tests for the Rich_Profile: it parses; every service's combination with each of its Goes_With partners fits the morning session; every FAQ answer passes the Spoken_Form check; the catalog line is "Hacemos cortes, barbería, peinados, color y tratamientos." (and its English twin); `serviceView("corte-hombre+degradado")` is 50 minutes and 2400 cents.
  - [ ] 5.4 The demo samples (`lib/owner/demo.ts`) and the Cache_Plan's tier 2 still use `shop.services[0]`. Check that with the Rich_Profile they still produce a valid sample and a valid demo conversation, and record the new first service in design.md.
  - Requirements: 11.4, 11.5, 11.7, 11.8, 16.2

- [ ] 6. The Code_Brain's readers (`lib/conversation/brain/`)
  - [ ] 6.1 `normalize.ts` (tokens, plural folding, Damerau–Levenshtein with the length rule) and `lexicon.ts` (both languages). Unit tests for each lexicon list; a test that no lexicon word is a service alias, a Category alias or an FAQ alias of the Rich_Profile (3.6); a lint rule that `lib/conversation/brain/` imports nothing from `lib/db` or `lib/receptionist/callModel.ts`.
  - [ ] 6.2 `services.ts`: `matchServices` with spans, longest match, the typo rule, ties, Goes_With, Category requests, negation, add mode, the 3-part cap, and the Service_Choice follow-up. Unit tests with the examples of requirements.md (4.3–4.7) and "cortarme el pelo y hacerme un degradado" → `["corte-hombre", "degradado"]`.
  - [ ] 6.3 **[PBT] B3** (matcher part: every alias and its variants are found, or make exactly the right Service_Choice). Validates 4.1–4.4.
  - [ ] 6.4 **[PBT] B13.** Negation, addition and replacement. Validates 4.6, 4.7, 7.8.
  - [ ] 6.5 `when.ts`: `readWhen` with day words, digit days, time words, digit times, noon and midnight, the half-day rule of 5.3, part of the day, corrections, the non-cue filter, and the forms task 1.3 listed. Unit tests with every example of Requirement 5.
  - [ ] 6.6 **[PBT] B9.** Days and times are read as said, and only when said. Validates 5.1–5.3, 5.5, 5.7.
  - [ ] 6.7 `person.ts`: `readName` and `readPhone`. Unit tests with the examples of Requirement 6, "Hola Lola, quería…" (no name), and a rejected phone.
  - [ ] 6.8 **[PBT] B10.** Names and phones are read as said. Validates 6.1–6.4.
  - [ ] 6.9 `topics.ts`: `matchTopic` for hours (all, a day, today, tomorrow, now), address, services, price and duration (service, Combo_Id, Service_Choice, Category) and FAQ_Entries, with the urgent-term carve-out of 9.7 and the Sensitive_Hit outside it. Unit tests: each Rich_Profile FAQ_Entry by two aliases in each language; "¿cuánto tarda el color?" is a Category duration; "me ha dado alergia el tinte" is a Sensitive_Hit; "¿hacéis la prueba de alergia?" is the FAQ.
  - [ ] 6.10 `read.ts`: `readUtterance` with the Intent order of 3.3, goodbye only alone (3.4), yes and no only first (3.5), the language switch. Unit tests for each line of 3.3's order. Performance test: the 50 longest pool utterances each read in under 20 ms (2.5).
  - Requirements: 3.1–3.6, 4.1–4.7, 5.1–5.7, 6.1–6.5, 9.7

- [ ] 7. Model path constants (`lib/receptionist/callModel.ts`, `geminiClient.ts`, `.kiro/steering/tech.md`)
  - [ ] 7.1 Measurement: `scripts/check-turn.ts --repeat 15` once per default model (45 requests; check against the RPD of task 1.1 and state the count before running), output to `.measurements/model-wait/`. Apply the rule of design.md ("Model path constants") and record the raw numbers, the 90th percentile and the chosen `ATTEMPT_TIMEOUT_MS` in "As built in task 7". If more than 1 in 5 requests of the first model fail, stop and ask the owner.
  - [ ] 7.2 `DEFAULT_GEMINI_MODELS` gets `gemini-3.5-flash` third; `MODEL_TIMEOUT_MS` 2600 and the measured `ATTEMPT_TIMEOUT_MS`, `MIN_ATTEMPT_MS`, `MAX_MODEL_ATTEMPTS`. Update the tests that pin the old values (`tests/receptionist/geminiClient.test.ts`, the `callModel` tests): list each one and say whether it pinned a value (updated) or a behaviour (kept, with the new numbers in its setup).
  - [ ] 7.3 `.kiro/steering/tech.md`: the AI line's default list, and the Rules line's budget, attempt deadline and attempt count, in the same words with the new numbers. Nothing else in the steering file changes.
  - Requirements: 12.1–12.4

- [ ] 8. TurnFacts, templates and decideTurn
  - [ ] 8.1 `lib/conversation/facts.ts`: `TurnFacts`, `factsFromModel(turn, reading, shop)` by the table "Who decides what", and `factsFromReading(reading)`. Unit tests for each row of the table.
  - [ ] 8.2 `lib/receptionist/phrases.ts`: every template of design.md ("New templates") in both languages, with Phrase_Variants where marked. Unit tests: each template's Spanish and English text with the Rich_Profile; every one at most 3 sentences of at most 25 words, no digits; the cacheable flag by natural-voice 6.5.
  - [ ] 8.3 `decideTurn` reads `TurnFacts` and follows design.md, "decideTurn, step by step": Owner_Requests, Sensitive_Hits and unanswered questions as Owner_Notes with Keep_Alive_Lines; Profile_Topic answers, with the flow's next question appended; Service_Request, Service_Choice and Category choices; the First_Offer with declines; offer acceptance in `mergeFields`; the brain's templated lines where the model's line was used; the miss counter. The new CallState fields are optional. Every existing `decideTurn` unit test and property (S1–S8) passes, with S2's generator extended by brain facts and offers (no assertion changed).
  - [ ] 8.4 `buildOwnerMessage`: the code-built reason when the Call had brain Turns (10.7), the Owner_Notes after the main reason, outcome `message` when notes remain and nothing was booked (10.6), and `suggested: null` when no Turn had a valid model answer. Unit tests for each.
  - [ ] 8.5 **[PBT] B12.** An accepted offer is not a booking. Validates 8.4, 13.5.
  - [ ] 8.6 **[PBT] B4.** Two or three services in one sentence make one Service_Combo (through `decideTurn` and a memory repository). Validates 7.1, 7.3, 7.5, 4.7. `numRuns: 100`.
  - [ ] 8.7 **[PBT] B6.** The Code_Brain never invents. Validates 9.2, 8.2. `numRuns: 100`.
  - Requirements: 7.5, 7.7, 7.8, 8.1–8.6, 9.1–9.6, 10.1–10.7, 13.1–13.5

- [ ] 9. handleTurn and the brain path
  - [ ] 9.1 `tests/conversation/memoryRepository.ts`: an in-memory `Repository` that refuses an overlapping booking on commit with `booking_overlap`. Its own unit tests compare it with the PGlite repository on the same scripted Calls.
  - [ ] 9.2 `handleTurn.say` as in design.md ("handleTurn"): the Reading first, the bookings read in parallel when the times are known, the Model_Wait, `factsFromModel` or `factsFromReading`, no `endWithFallback` for a model failure, the per-visitor limit still ending with `fallback`, the global limit skipping the model. `CoreConfig.maxConsecutiveInvalid` is marked deprecated.
  - [ ] 9.3 `fallbackLog.ts`: `path: "brain"`. The redaction test gets a brain case with a name, a phone and an unanswered question in the utterance; the log line holds none of them, nor the key.
  - [ ] 9.4 **[PBT] B1.** A model failure never ends a Call. Validates 1.1–1.3, 1.7. `numRuns: 100`.
  - [ ] 9.5 **[PBT] B8.** The brain answers by the Model_Wait, and a late model changes nothing (fake timers). Validates 2.2–2.4. `numRuns: 100`.
  - [ ] 9.6 **[PBT] B2.** Every FAQ topic gets the profile's answer. Validates 9.1, 9.5, 9.6, 1.1.
  - [ ] 9.7 **[PBT] B3** (conversation part: price, duration and booking frames with a failing model). Validates 9.1, 8.1.
  - [ ] 9.8 **[PBT] B11.** Owner requests and unanswered questions keep the Call alive and reach the Owner. Validates 10.1–10.6. `numRuns: 100`.
  - [ ] 9.9 Rewrite the tests that asserted the old behaviour (Requirement 15.4). For each, record the old assertion, the new one, and what it still protects:
    - `tests/api/turn.failures.test.ts`: a hang, a 503, a 429 and a network error each get the brain's reply with `complete: false`; the timing check keeps its bound with the new Model_Wait; two invalid outputs in a row are two brain replies; a Call that then ends by goodbye has exactly one Message with `modelFailed: true` and the caller's name.
    - `tests/api/turn.urgency.test.ts`: the `fallback` cases run through the per-visitor rate limit (still outcome `fallback`, still `urgent` from "es urgente"); a new case runs a brain-only Call with "es urgente" that ends by goodbye, and its Message is `urgent` with basis `urgent_term`.
    - any other test the full run shows failing because a model failure no longer ends the Call: listed here before it is changed.
  - Requirements: 1.1–1.7, 2.1–2.4, 2.6, 12.5, 15.4

- [ ] 10. Regression: Real_Call_2026_11_16 (`tests/api/turn.realCall1116.test.ts`, PGlite)
  - [ ] 10.1 The Spanish call as in design.md ("Testing strategy"): Rich_Profile, `NOW` Saturday 2026-11-14 19:30 Madrid, and three model fakes (always 503, hang, 429). Turn by turn: "Hola Lola quería cortarme el pelo y hacerme un degradado" → the First_Offer for `corte-hombre+degradado` ("… son cincuenta minutos y veinticuatro euros. ¿Te viene bien el martes a las diez? …"); "sí" → the name ask; "Me llamo Ana" → the phone ask (the pack requires the phone); "612 345 678" → the read-back with the total price; "sí" → `booked`. One booking row from 10:00 to 10:50 Madrid on `chair-1` with the Combo_Id; one Message, outcome `booked`, `modelFailed: true`; one `turn_fallback` line with `path: "brain"` per Turn; no reply is the Fallback_Message; `complete: false` until the last Turn. The first reply is also compared once with a literal string.
  - [ ] 10.2 The English twin: "Hi Lola, I'd like a haircut and a fade", then "yes", "My name is Ann", "+34 612 345 678", "yes".
  - [ ] 10.3 The same call with a healthy scripted model whose `service` is "cortarme el pelo y un degradado": the same Combo_Id and First_Offer (the code's facts on the model path, 13.2).
  - Requirements: 15.1, 15.2, 7.1–7.5, 8.1, 8.4, 13.2

- [ ] 11. Prompt (`lib/receptionist/prompt.ts`, `schema.ts`)
  - [ ] 11.1 The `service` field's description asks for every service the caller named, joined with " y " / " and ". The system instruction lists the Categories, marks "desde" prices, and includes the FAQ answers as facts the model may repeat. Prompt tests: the Rich_Profile's prompt contains each FAQ answer and no digit-written price; the V1_Profile's prompt is unchanged except for the `service` description (pinned diff).
  - Requirements: 4.9, 13.1

- [ ] 12. Cache_Plan tier 6 (`lib/receptionist/cachePlan.ts`)
  - [ ] 12.1 Tier 6 as in design.md. Unit tests: tier 6 lines for the Rich_Profile in Spanish, none with a day, all cacheable.
  - [ ] 12.2 **[PBT] B14.** Tier 6 only appends. Validates 14.2. `numRuns: 30`, 120 s timeout.
  - [ ] 12.3 Size: the Rich_Profile's full plan (lines and estimated bytes) against `voiceCacheBudget.ts`, recorded in "As built in task 12". If it does not fit, stop and ask before trimming (14.3). No audio is built in this task.
  - Requirements: 14.1–14.4

- [ ] 13. Mutation proofs
  - [ ] 13.1 Make each mutation of design.md's table, run the named property or test, record the result and the shrunk counterexample in design.md ("Mutation proofs"), and restore the code. A mutation that no test catches is recorded as such, with the test added to catch it, never hidden.
  - Requirements: 15.5

- [ ] 14. Manual checklist and notes
  - [ ] 14.1 `.kiro/specs/front-desk-brain/manual-checklist.md` for the owner, written from the code as it is: run the seed (owner step), then on the deployed app (a) a call with `GEMINI_MODEL` set to an id that answers 404, so every Turn is the brain: the Real_Call_2026_11_16 books end to end by voice in Chrome; (b) five FAQ questions by voice and by typing; (c) "quiero hablar con Lola" mid-booking; (d) the same with the real models, timing each reply by ear (~3 s); (e) the Owner's machine shows "Corte de hombre + Degradado" on the Tape and in the Agenda, and moving it keeps both parts. Each check has a "Result / date" line.
  - [ ] 14.2 `NOTAS-KIRO.md`: one row for the spec itself (what the production log showed and what the design changed), and one row per property that caught a real bug or a wrong generator, and per doc that changed a choice in task 1.
  - Requirements: 15.5, and the working rules of the Introduction
