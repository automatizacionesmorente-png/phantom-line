# Implementation Plan: Natural Voice

Follow `design.md`. Pure logic comes first, and each piece ships with its tests in the same task. No task is optional. Property-based tests are marked **[PBT]** and name the property and the requirements they validate.

Every task finishes only when `npx vitest run`, `npm run lint` and `npm run build` all pass. Never read, print or log `.env.local` or the value of any key; load it only with `node --env-file=.env.local`. Never touch the real database from a test. Tests that assert the old wording are updated to the new exact wording in the same task, with assertions at least as strict, never deleted (Requirement 13.6).

TTS quota is 10 requests per model per day and resets at 09:00 Madrid. A task that spends it says how many requests, and spends no more.

## Dependencies

| Task | Needs | Can run in parallel with |
|---|---|---|
| 1 Spike | none | none |
| 2 Voice audition | 1, a new day's quota, the owner's ears | 3, 4, 5, 11 |
| 3 Configuration and pace | 1 (option 1 of the pace needs a day's quota) | 4, 5, 11 |
| 4 Spoken forms | none | 3, 5, 11 |
| 5 Variants | none | 3, 4, 11 |
| 6 Phrase templates and honesty | 3, 4, 5 | 7 |
| 7 Prompt and safety net | 4 | 6 |
| 8 TTS server | 2, 3 | 11 |
| 9 Voice cache | 3 (the pace decision, because the style is in the key), 6, 8 | 10 |
| 10 Browser voice and playback rate | 3, 8 | 9 |
| 11 Local neural voice spike | 1 | 2–10 |
| 12 Manual check and notes | 9, 10, 11 | none |

## Tasks

- [x] 1. Verification spike: Gemini text-to-speech on the free tier
  - [x] 1.1 Read the installed `@google/genai` 2.32.0 types for TTS: models, `speech_config`, audio `response_format`, streaming `AudioDelta`, `voices.list`, the `speech_metadata` annotation. Record what changed the first choice in design.md.
  - [x] 1.2 Write `scripts/check-tts.mjs` (plain JavaScript for Node 20.19). It never prints the key or `process.env`, passes every error message through `redact()`, and saves audio only to the git-ignored `.measurements/tts/`. Checks: `models`, `voices`, `once`, `style`, `formats`, `repeat` (spaced, streamed, with time to first audio, underruns and chunk gaps), `burst`, `live`.
  - [x] 1.3 Run it against the real free tier with spaced calls. Record per model: whether it answers, whether it streams, the per-day and per-minute limits from the 429 messages, the reset time, time to first audio (p50 / p90 / max), underruns, the formats accepted, and which voices each model accepts.
  - [x] 1.4 Measure how the style prompt can be passed without being read aloud.
  - [x] 1.5 Count the TTS requests one demo booking call needs, compare them with the limits, and write the verdict plainly in design.md, with the best alternative that needs no new account.
  - Requirements: 2.1, 2.6, 3.5, 5.1–5.4
  - Done when: `npx vitest run`, `npm run lint` and `npm run build` all pass.

- [ ] 2. Voice audition (needs the owner, and a fresh day's quota after 09:00 Madrid)
  - [x] 2.1 The owner listens to the Spanish samples listed in design.md, review point 10, and picks a voice and a model order. Answer: `es-es-commercial-3` on `gemini-3.8-flash-tts` and `gemini-3.8-flash-lite-tts`, about 10 % faster (the pace is handled in tasks 3 and 10).
  - [ ] 2.2 Run `check-tts.mjs once --lang=en --save` with 2 or 3 English candidates (`Callirrhoe`, `Achird`, and one more from the catalog), and `style --styles=none,annotation` in English. Measure the same figures as task 1 and save the samples. At most 8 TTS requests.
  - [x] 2.3 Record the Spanish choice in design.md ("Voice_Profile" table): the default Spanish voice of the hair-salon pack and of the demo shop. The pack and seed change itself is code, in task 3.6.
  - [ ] 2.4 The owner picks the English voice. Record it, and its numbers, in design.md ("Voice_Profile" table) and in the hair-salon pack.
  - Requirements: 3.4, 5.1
  - Done when: both voices are chosen and recorded, and `npx vitest run`, `npm run lint` and `npm run build` pass.

- [ ] 3. Configuration and pace (`lib/sectors`, `lib/conversation/shopProfile.ts`, `scripts/check-tts.mjs`)
  - [x] 3.1 `VoiceProfile` type and `VoiceProfileSchema`. `SectorPack` gains `voice: Record<Lang, VoiceProfile>` and `vocabulary[lang].place`. The registry validates them when it loads.
  - [x] 3.2 `ShopProfileSchema` gains an optional `voice` override per language and an optional `spokenName: { es, en }` per service. Lola's seed gets "un corte", "un tinte", "un arreglo de barba" / "a haircut", "a colour", "a beard trim". Existing stored profiles stay valid.
  - [x] 3.3 `resolveVoiceProfile(pack, shop, lang)`. Unit tests: the override wins, field by field; an invalid voice or a style over 200 characters fails validation.
  - [x] 3.4 `.env.example` gains `GEMINI_TTS_MODEL`, `SPEECH_TOKEN_SECRET`, `TTS_LIMIT_PER_VISITOR_PER_MINUTE`, `TTS_LIMIT_GLOBAL_PER_HOUR`, `TTS_LIMIT_GLOBAL_PER_DAY` and `VOICE_CACHE_MAX_BYTES`, without values. Propose the `tech.md` line for `GEMINI_TTS_MODEL` to the owner, and edit steering only after approval.
  - [x] 3.5 `ShopProfileSchema` gains `speechRate` (zod: a number from 0.8 to 1.25, default 1.0), one value per shop for both languages. Unit tests: the default, both bounds, a value outside them fails, and an existing stored profile without it stays valid.
  - [x] 3.6 The hair-salon pack's Spanish Voice_Profile is `es-es-commercial-3` with `classicVoice: "Kore"`, and Lola's seed uses it. Lola's `speechRate` is set by 3.8.
  - [ ] 3.7 Pace option 1 (needs quota after 09:00 Madrid): add a `pace` check to `check-tts.mjs` that runs the offer sentence, not streamed, spaced 20 s apart, on `gemini-3.8-flash-tts` and `gemini-3.8-flash-lite-tts`: 2 runs with the current style and 3 with "Una peluquera simpática de Madrid, relajada, a un ritmo algo ágil, natural, y sonriendo." per model, **10 TTS requests in total**, and no retries. It saves `.measurements/tts/<model>-pace-base-<n>.wav` and `…-pace-agil-<n>.wav` and writes durations and median pitch to `.measurements/tts/pace.json`. Record the medians, the change and the pitch change in the "Pace" table in design.md. If the quota is exhausted, leave this sub-task unticked for the next day and go on with 3.8 using option 2.
  - [ ] 3.8 Decide with the rule in design.md ("Pace", accepted when 5–15 % shorter on both models, no pace run longer than the baseline median, pitch within 3 %, and the owner does not hear it as rushed). If option 1 is accepted: the pace words go into the pack's Spanish style and Lola's `speechRate` is 1.0. Otherwise, or while 3.7 waits for quota: the style stays and Lola's `speechRate` is 1.1 (option 2, built in task 10). Record the decision in the table. Never both.
  - Requirements: 3.1–3.5, 5.5
  - Status (2026-11-13, 00:40 Madrid): 3.1–3.6 done. The `pace` check is written (`--plan` lists exactly 10 requests; `--offline` measured the spike files with no API call) but has not run, because the TTS quota is exhausted until 09:00 Madrid. 3.8 holds the interim branch (style unchanged, Lola `speechRate: 1.1`) and stays open until 3.7 has run and the owner has listened. Audited again at 00:55 Madrid: 3.1–3.6 and the `pace` check kept as they were, `pace --plan` still lists exactly 10 requests, 47 test files / 341 tests pass, and lint, `tsc --noEmit` and build are clean. No TTS request was made. Audited a third time at 00:57 Madrid with the same result (47 files / 341 tests, lint, `tsc --noEmit`, build and the client-bundle check clean; `.measurements/tts/` still has no `pace-base-*`, `pace-agil-*` or `pace.json`). Task 3 stays open: 3.7 and 3.8 cannot be finished before 09:00 Madrid. Fourth audit at 00:57 Madrid (13 Nov): same tree kept, `pace --plan` still lists 10 requests, 47 files / 341 tests, lint, `tsc --noEmit` and build (with the client-bundle check) clean; no TTS request made.
  - Done when: 3.7 has been measured (not only skipped for quota), the decision in 3.8 is recorded, and `npx vitest run`, `npm run lint` and `npm run build` all pass.

- [ ] 4. Spoken forms (`lib/receptionist/spoken`, pure)
  - [ ] 4.1 `numbers.ts`: `speakNumber` (0–999 999, with Spanish apocope), `speakPrice`, `speakDigits`, `speakPhone`. `parse.ts`: `parseNumber`, `parsePrice`, `parsePhone`. Unit tests with the exact forms in design.md.
  - [ ] 4.2 `time.ts`: `speakTime`, `clockWords`, `periodOf`, following the omission rule. `parseSpokenTime`. Unit tests: every example in Requirement 6, and Lola's times (10:00, 13:30, 17:15, 19:30, 21:00, 12:00, 00:00) in both languages.
  - [ ] 4.3 `day.ts`: `speakDay` with `withWeekday`, and `parseSpokenDay`. Unit tests: every row of the table in design.md, a year boundary, and the two 2026 Madrid DST weekends.
  - [ ] 4.4 **[PBT] N1.** Times have no digits and round-trip, over all 1 440 minutes, both languages, random sessions and no context. Validates 6.7, 6.8, 13.1.
  - [ ] 4.5 **[PBT] N2.** "la una" / "las N", never "cero". Validates 6.3, 13.1.
  - [ ] 4.6 **[PBT] N3.** The period appears exactly when it is needed. Validates 6.5.
  - [ ] 4.7 **[PBT] N4.** Days: relative words, no digits, round trip, `today` in the shop's zone across DST and local midnight. Validates 7.2–7.7, 13.2.
  - [ ] 4.8 **[PBT] N5.** Numbers 0–999 999 round-trip with no digits. Validates 8.2, 8.5.
  - [ ] 4.9 **[PBT] N6.** Prices and Spanish phones round-trip, with phones in 3 groups of 3. Validates 8.1, 8.3.
  - Requirements: 6, 7, 8
  - Done when: `npx vitest run`, `npm run lint` and `npm run build` all pass.

- [ ] 5. Variants (`lib/receptionist/variants.ts`, pure)
  - [ ] 5.1 `fnv1a32` and `pickVariant(seed, key, variants)`. When no seed is given, variant 0 is used.
  - [ ] 5.2 **[PBT] N8.** The choice is deterministic, always an approved variant, and reaches every variant. Validates 9.4, 13.4.
  - Requirements: 9.4
  - Done when: `npx vitest run`, `npm run lint` and `npm run build` all pass.

- [ ] 6. Phrase templates and honesty (`phrases.ts`, `decide.ts`, `handleTurn.ts`)
  - [ ] 6.1 Rewrite every template in Spanish and English from the table in design.md, with spoken times, days, prices and phones, the reason words chosen by the day's sessions, and nearest-first alternatives. `phrases(lang, pack, shop, seed?)`.
  - [ ] 6.2 Field asks become templates in a booking whose time has been accepted (`timeAccepted + askName`, `askPhone`). The model's line is kept for questions and `outOfProfile`. The read-back includes the phone in groups. Update `decide.test.ts`, `turn.booking.test.ts` and the phrase snapshots to the new exact strings, then extend S8 so that in a booking with an accepted time, a missing name or phone is asked by a template.
  - [ ] 6.3 `handleTurn` passes `{ callId, turn }` as the Variant_Seed, the greeting included.
  - [ ] 6.4 Templates go through `toSpokenReply(text, lang, { maxSentences: 3 })`. Model text keeps 2.
  - [ ] 6.5 Every rendered line carries `cacheable`, decided by the template: false for any template with `{name}` or `{phone}` and for model text, true otherwise (design.md, "What may be cached").
  - [ ] 6.6 Propose the new greeting for `receptionist-voice.md` to the owner, and edit steering only after approval.
  - [ ] 6.7 **[PBT] N7.** Every variant keeps its facts and its limits. Validates 9.1–9.3, 9.5, 9.7, 13.3.
  - [ ] 6.8 **[PBT] N10.** Honesty: the disclosure is in every greeting, and no line claims to be the owner or a person. Validates 10.1, 10.2, 10.4.
  - Requirements: 7.4, 8.3, 9, 10, 12.1, 12.2
  - Done when: `npx vitest run`, `npm run lint` and `npm run build` all pass.

- [ ] 7. Prompt and safety net (`prompt.ts`, `speech.ts`)
  - [ ] 7.1 A "CÓMO HABLAS" / "HOW YOU TALK" block with the style rules, the honesty rule and short examples. Hours and prices in Spoken_Form. Update the prompt snapshot.
  - [ ] 7.2 `toSpokenReply(text, lang?, opts?)`: when `lang` is given, convert leftover digit times, prices, digit runs, English ordinals and other numbers, in the order in design.md. With no `lang`, behaviour is unchanged.
  - [ ] 7.3 `handleTurn` passes the Call's language to every `toSpokenReply`.
  - [ ] 7.4 Run `scripts/check-turn.ts --repeat=3 --gap=20000` on the 21:00 line and on "¿Cuánto cuesta un tinte?". Record in design.md how many model replies contained digits before the safety net and whether any reached the caller.
  - [ ] 7.5 **[PBT] N9.** No digits after the safety net, and idempotent. S4 stays as it is. Validates 11.4, 11.5, 13.5.
  - Requirements: 6.9, 8.4, 11
  - Done when: `npx vitest run`, `npm run lint` and `npm run build` all pass.

- [ ] 8. TTS server (`ttsClient.ts`, `speechToken.ts`, `ttsLimits.ts`, `app/api/speech/route.ts`)
  - [ ] 8.1 `ttsClient.ts` (`server-only`): a streamed `interactions.create` with the `speech_metadata` style annotation, a catalog or classic voice per model, the top-level `signal`, no SDK retries, and errors rethrown as `GeminiCallError` with the key redacted. Unit tests with a fake SDK: streaming, the real 429 and 400 shapes, and a hang.
  - [ ] 8.2 `speechToken.ts`: `signSpeech` / `verifySpeech` with HMAC-SHA256 and `timingSafeEqual`, binding shop, language, expiry, the `cacheable` flag and the text's hash. **[PBT] N11.** Validates 1.4.
  - [ ] 8.3 `ttsLimits.ts`: `checkTtsLimits` and model selection that skips exhausted models; `tts-exhausted:<model>` rows that expire at midnight Pacific. **[PBT] N13.** Validates 4.4, 5.5.
  - [ ] 8.4 `tts_fallback` in `fallbackLog.ts`. **[PBT] N14:** no text, token, name, phone or visitor key in the log, and the key only as `***`. Validates 4.5, 4.7.
  - [ ] 8.5 `app/api/speech/route.ts`: the zod schema from design.md, `say` streaming PCM, `report` returning 204, statuses before the first chunk, and limits. `/api/turn` returns `speech: { kind: "live", token, rate }`, with `rate` from the shop's `speechRate`. Route tests with a fake TTS client and PGlite.
  - [ ] 8.6 Check the client bundle with `scripts/check-client-bundle.mjs` (no key, no secret, no `ttsClient`).
  - Requirements: 1.2–1.4, 1.6, 1.7, 4.4–4.8, 5.5
  - Done when: `npx vitest run`, `npm run lint` and `npm run build` all pass.

- [ ] 9. Voice cache (every line without caller data, in Postgres, plus pre-generation for the demo shop)
  - [ ] 9.1 Check the docs before writing code, and record what changed in design.md: Neon's free-tier storage (0.5 GB) and transfer limits on Neon's pricing page; whether the installed `drizzle-orm` 0.45 has a `bytea` column or needs `customType`, and how the Neon HTTP driver and PGlite return it; how a GET Route Handler with params behaves under `cacheComponents` in the bundled Next.js docs; and whether Vercel's CDN caches a function response with `s-maxage`.
  - [ ] 9.2 `voiceCacheKey.ts` (pure): `cacheKey(model, voiceUsed, style, languageCode, text)`, 32 hex characters, with no rate input. `fixedPhrases.ts`: the Fixed_Phrases per shop and language, all variants.
  - [ ] 9.3 The `voice_cache` table (design.md) as a Drizzle migration, and `voiceCacheRepository.ts`: `findKeys(keys)` that reads no audio, `get(key)`, `insert(row)` with `on conflict (key) do nothing`, and `evict(maxBytes)` that deletes the least recently used unpinned rows. PGlite tests for each. Propose the `voice_cache` line for `tech.md` to the owner, and edit steering only after approval.
  - [ ] 9.4 `/api/turn` looks up the reply's keys for each model that uses the primary voice, in `GEMINI_TTS_MODEL` order, and returns `speech: { kind: "cached", url: "/api/voice/<key>", rate }` on a hit or `{ kind: "live", token, rate }` on a miss. Unit tests: a cached greeting is a hit, a read-back is always live, and a line with a different style is a miss.
  - [ ] 9.5 `app/api/voice/[key]/route.ts`: GET, the key checked against `^[0-9a-f]{32}$` before any query, the bytes with their `mime` and `Cache-Control: public, max-age=31536000, s-maxage=31536000, immutable`, a 404 cached for 60 s on a miss, and `last_used_at` refreshed only when it is more than a day old. Route tests on PGlite.
  - [ ] 9.6 `/api/speech` stores a live line in `after()` when its token says `cacheable`, the stream ended cleanly, and the voice used is the primary voice; then runs `evict(VOICE_CACHE_MAX_BYTES)`. A failed write logs one `voice_cache_write_failed` line with the key and error class only. Route tests: a clean cacheable stream is stored once, an aborted or non-cacheable one is not.
  - [ ] 9.7 `cachePlan.ts` (pure): the tiers in design.md, rendered by the real `phrases()` with the empty agenda for each of the next 7 days as "today", deduplicated by key, in the order tiers 1–2 in both languages, then tiers 3–5 in Spanish, then English. English is left out until task 2.4 has chosen its voice.
  - [ ] 9.8 **[PBT] N16.** Cache keys change with every input, never with the rate; lines with a name or phone and model text are never cacheable. Validates 2.4.
  - [ ] 9.9 **[PBT] N17.** The plan is deterministic, has no duplicates, keeps the tier order, holds only cacheable lines that `phrases()` really says; eviction keeps the cap, keeps pinned rows and removes the least recently used. Validates 2.3, 2.4.
  - [ ] 9.10 `scripts/build-voice-cache.ts` (`node --env-file=.env.local --import tsx`): `--plan` prints the list sizes and the estimated days with no API call. A real run requests non-streamed MP3 for the missing keys only, uses for each language only the models of its primary voice, spaces calls by `--gap` (default 20 000 ms), stops on a model after `10 − --reserve` successes in the Pacific day (default reserve 2), writes `tts-exhausted:<model>` on a 429 and moves to the next model, never retries the same model, pins tiers 1–2, and on the last allowed model's stop writes where it stopped to `.measurements/voice-cache-run-<date>.json` and exits 0. Tests on PGlite with a fake TTS client: it skips existing keys, and after a fake 429 a second run resumes at the next missing line.
  - [ ] 9.11 Run `--plan` and record its numbers in design.md. Then, **only after the owner approves writing to the Neon database** and after task 3.8 has fixed the style, run it once a day after 09:00 Madrid until tiers 1–3 are built in Spanish (and in English once 2.4 is done). After the first real run, record the size per line in design.md (min, median and max bytes and seconds per tier) and the total size of `voice_cache`.
  - Requirements: 2.3, 2.4, 10.4
  - Done when: tiers 1–3 are in the cache for Spanish, the sizes are recorded, and `npx vitest run`, `npm run lint` and `npm run build` all pass.

- [ ] 10. Browser voice and playback rate (`lib/voice`, `components/call`)
  - [ ] 10.1 `voiceDecision.ts`: the pure deadline, buffer, stall and fallback reducer, with `TTS_DEADLINE_MS = 2500`, a 300 ms start buffer counted in output audio, and `STALL_LIMIT_MS = 3000`. **[PBT] N12.** Validates 1.8, 2.5, 4.1, 4.3.
  - [ ] 10.2 `pickVoice` ranks natural / neural / enhanced / premium / online, then Google, then network, then the first voice. Unit tests with voice lists from Chrome on macOS, Windows and Android.
  - [ ] 10.3 Check against MDN, before writing the player: `HTMLMediaElement.preservesPitch` and `playbackRate` in Chrome desktop and Android; whether Media Source Extensions accept raw PCM or WAV; whether `playbackRate` has any effect on an element playing a `MediaStream`. Record the answers in design.md ("Pace"). If a native path keeps the pitch for streamed PCM, use it and drop 10.4.
  - [ ] 10.4 `timeStretch.ts` (pure): streaming WSOLA (20 ms frames, 50 % overlap, ±5 ms search) that keeps its state across chunks and is a no-op at 1.0. **[PBT] N15.** Output length is input length / rate within one frame, the dominant period stays within 2 %, the result does not depend on how the input is chunked, and rate 1.0 is the identity.
  - [ ] 10.5 `neuralVoice.ts`: the same `SpeechPort` interface; cached lines through an `HTMLAudioElement` with `preservesPitch = true` and `playbackRate = hint.rate`; live PCM chunks through `timeStretch` at `hint.rate` into one `AudioContext` with `AudioBufferSourceNode.playbackRate` left at 1; the browser fallback at rate 1.0; `quotaOut` for the rest of the Call; and `report` on every fallback the browser decides.
  - [ ] 10.6 The `speak` effect of `callLoop` carries the `speech` hint with its `rate`, the transcript shows the reply at once, and S5 still passes unchanged.
  - [ ] 10.7 Pace option 2, measured with no quota: run `timeStretch` at 1.1 over the spike's `es-es-commercial-3` offer samples of both 3.8 models, write `.measurements/tts/<model>-pace-rate-1.10.wav`, and record the durations before and after and the change in median pitch in the "Pace" table in design.md. The owner listens to both files.
  - Requirements: 1.1, 1.5, 1.8, 2.2, 2.5, 3.5, 4.1–4.3, 4.6, 12.1
  - Done when: `npx vitest run`, `npm run lint` and `npm run build` all pass.

- [ ] 11. Local neural voice spike (measure only, do not integrate)
  - [ ] 11.1 Check the current README, model card and licence of each candidate in design.md ("Local neural voice spike"): Piper with `es_ES` and `en_US` voices (browser on `onnxruntime-web`, Node through `sherpa-onnx` or `onnxruntime-node`), and Kokoro-82M through `kokoro-js` (WebGPU or WASM in the browser, and Node), including whether it supports Spanish. Record in design.md what changed the candidates, and each licence, the phonemizer's included.
  - [ ] 11.2 Set up `.measurements/local-tts/` (git-ignored) with its own `package.json`. Nothing is added to the app's `package.json`, and no app code imports it. Models are downloaded from public pages that need no account.
  - [ ] 11.3 A Node script there synthesizes the same Spanish offer sentence as the Gemini spike, and the English one, with each engine and voice: download size (model, runtime, phonemizer data), cold and warm time to first audio (5 warm runs, median and max), real-time factor and audio length, on this Mac (chip, macOS and Node versions recorded). It writes `.measurements/tts/local-<engine>-<voice>.wav` (Spanish) and `…-en.wav`, and the numbers to `.measurements/tts/local-tts.json`.
  - [ ] 11.4 A local HTML page in the same folder runs the browser builds (WASM, and WebGPU where supported) and shows the same timings. The owner opens it in Chrome and reads the numbers back; record them with the Chrome version.
  - [ ] 11.5 For a Node route, record the unpacked size of model plus runtime against Vercel's function size limit (checked in Vercel's docs), and the cold start measured here as a lower bound. Nothing is deployed.
  - [ ] 11.6 Fill in the results table in design.md and list the sample files for the owner. The owner listens and decides; no integration in this spec.
  - Requirements: 4.1, 4.2 (the fallback chain this tier would join)
  - Done when: the samples and numbers are in design.md, the app's `package.json` is unchanged, and `npx vitest run`, `npm run lint` and `npm run build` pass.

- [ ] 12. Manual check and notes
  - [ ] 12.1 Add to the manual checklist: time to first sound on a real Spanish and English call in Chrome desktop and Android (measured with the DevTools performance panel); the deadline fallback with throttled network; the quota fallback with `GEMINI_TTS_MODEL=gemini-2.5-pro-preview-tts`; the AI disclosure heard in the greeting; the transcript matching the audio; a cached and a live line played at Lola's rate, timed with the DevTools panel and listened to for pitch; and a second call that hears the same lines from the cache (no `/api/speech` request in the network panel).
  - [ ] 12.2 Record the real numbers in design.md, and tick this task.
  - Requirements: 2.1, 4, 10, 12
  - Done when: the checklist has been run, and `npx vitest run`, `npm run lint` and `npm run build` pass.
