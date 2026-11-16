# Implementation Plan: Jury Polish

Follow `design.md`. Pure logic comes first, and each piece ships with its tests in the same task. No task is optional. Property-based tests are marked **[PBT]**; each one is its own sub-task and names the property and the requirements it validates. Every property runs at least 100 cases (`numRuns: 200` unless the design says otherwise; J3 runs 50 on PGlite and J6 runs 30, and say so), and each one asserts that its rare branches were reached.

Every task finishes only when `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass, and the real results are reported, failures included.

Never read, print or log `.env.local` or any secret. If a script needs it, run it with `node --env-file=.env.local`. **Do not touch the real database:** every database test runs on PGlite, and the Booking_MCP runs on PGlite only. Kiro never runs a migration, the seed, `scripts/build-voice-cache.ts` (real run) or `scripts/check-call.ts` against Neon; those are owner steps in the manual checklist (task 15). The files in `.kiro/specs/owner-machine/` are read only.

## Working beside the other specs

- **natural-voice** is still open. Tasks 4, 5, 7 and 8 edit files it wrote (`lib/voice/neuralVoice.ts`, `speechRequest.ts`, `speechPort.ts`, `components/call/callSession.ts`, `app/api/turn/handler.ts`, `app/api/speech/handler.ts`, `lib/receptionist/cachePlan.ts`, `lib/conversation/fallbackLog.ts`). Before each of them, re-read those files as they are; if a natural-voice session is changing them, stop and ask. Task 8 starts only after natural-voice task 2.4 has recorded the English voice.
- **owner-machine** code is reused by import only (`TapeReels`, `useReducedMotion`, `DemoNotice`, `controlButton`, `demo.ts`). Task 11 rewrites `app/page.tsx` only if the owner confirms open question 1 in design.md; owner-machine Requirement 3.1–3.4 keeps holding either way. If task 13's axe run finds a violation in `components/machine/`, record it and ask before changing it.

## Dependencies and parallel work

| Task | Needs | Can run in parallel with |
|---|---|---|
| 1 Spike and docs | none | none |
| 2 Hook evidence | 1.2 | 3, 4 |
| 3 Booking MCP server | 1.1 | 2, 4 |
| 4 Safari unlock regression test | none | 1, 2, 3 |
| 5 Browsers without recognition | 1.3, 3 | 6, 9 |
| 6 English parity | 3 | 5, 7, 9 |
| 7 Resting state and `tts_usage` | 1 | 6, 9, 10 |
| 8 English voice cache | 7, **natural-voice 2.4** | 9–14 |
| 9 Call_Visuals and hiss | 1 | 5, 6, 7, 10 |
| 10 Brand_Assets | 1.5 | 6, 7, 9 |
| 11 Landing page | 3, 10, open question 1 answered | 12 |
| 12 Claims | 11 | 13 |
| 13 Accessibility pass | 1.4, 5, 7, 9, 11 | 12 |
| 14 README for judges | 2, 3, 12 | none |
| 15 Manual checklist | 5–14 (8 may still wait) | none |
| 16 Notes | 15 | none |

## Tasks

- [ ] 1. Spike and docs (no app code)
  - [ ] 1.1 `@modelcontextprotocol/sdk`: from the registry and the package's own `package.json`, the newest version whose `engines` accepts Node 20.19, the zod major its `peerDependencies` accept (the app has zod 4.6.7), and from its current docs (Context7 or the README in the package) the stdio server, the tool-registration API with an input schema, and an in-memory transport for tests. Record versions, source and what changed the design in design.md, "Where current documentation changed my first choice". If the network is not available, say so and stop: do not guess versions.
  - [ ] 1.2 Kiro hooks: from the current Kiro docs (IDE and CLI), the hook file format and trigger names. Record whether `.kiro/hooks/booking-properties.json` and the `hooks` in `builder.json` are in a form each one reads. If not, write it in design.md and ask (open question 10); change nothing.
  - [ ] 1.3 `@mdn/browser-compat-data` (with `npm pack` into the git-ignored `.measurements/`, as natural-voice did; nothing added to the app): `SpeechRecognition`, `webkitSpeechRecognition` and `SpeechRecognition.available` in Safari, Safari on iOS, Firefox and Firefox for Android. Record the result, and answer open question 3 with the data next to it.
  - [ ] 1.4 `axe-core`: the newest version for Node 20.19, how to run it on a jsdom container, and which rules need layout (to be turned off in 13.1). Record.
  - [ ] 1.5 Next.js metadata files, from `node_modules/next/dist/docs`: `icon`, `apple-icon`, `opengraph-image` with `.alt.txt`, and how they are served under `cacheComponents`. Then, in a throwaway script under `.measurements/`, check whether `ImageResponse` from `next/og` runs in a plain Node 20 script and writes a PNG. Delete the script afterwards. Record the answer; if it does not run, write the fallback in design.md and ask (open question 7).
  - [ ] 1.6 GitHub's docs on Mermaid in Markdown. Record.
  - [ ] 1.7 Install `@modelcontextprotocol/sdk` and `axe-core` as dev dependencies at the versions from 1.1 and 1.4. Nothing else.
  - [ ] 1.8 Update every design decision a finding changes, and mark the remaining open questions.
  - Requirements: 1.1, 2.1, 6.1, 10.4, 13.1, 15.4, 15.8
  - Done when: `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass.

- [ ] 2. Hook evidence (`.kiro/hooks/scripts`, `NOTAS-KIRO.md`)
  - [ ] 2.1 Move the matcher of `guard-secrets.mjs` to `guardSecretsCore.mjs` as `isBlocked(input)`; the script imports it and keeps its exit codes and message. Unit tests: the script spawned with stdin JSON for `.env.local`, `.env.production`, `.env.example`, `node --env-file=.env.local x.mjs` and `src/my.env.ts` gives exit 2, 2, 0, 0, 0.
  - [ ] 2.2 **[PBT] J1.** The secrets guard blocks exactly the real env files. Validates 1.2.
  - [ ] 2.3 `session-brief` evidence: quote the brief of a real CLI session start (this spec's session is the first sample) with its date.
  - [ ] 2.4 `guard-secrets` evidence: search the earlier Kiro session records for a real block first. If none is found, in a builder session ask to read `.env.hooktest` (a file that does not exist) and record the hook's stderr and that the call did not run. No call names `.env.local`.
  - [ ] 2.5 `booking-properties` evidence: in a builder session, write the mutation "drop the fit check (step 5)" to `lib/booking/rules.ts`, record the hook's failing output (property and shrunk counterexample), restore the code, and record the hook's green output.
  - [ ] 2.6 One `NOTAS-KIRO.md` row per hook with the evidence. If a hook could not be made to fire, the row says so (1.6).
  - Requirements: 1.1–1.6
  - Done when: `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass, and `lib/booking/rules.ts` is unchanged against the last commit.

- [ ] 3. Booking MCP server (`mcp/phantom-booking`)
  - [ ] 3.1 `tools.ts`: the shared zod input schema, `toBookingRequest` (service id, name or alias through the core's matcher; local date and time in the Demo_Shop's zone; `now`), and the three answers from `checkBooking`, `findNearestSlots` and `evaluateBooking`. `explain` reads the step and facts with the helpers of `lib/booking/time.ts`, and contains no rule of its own. Unit tests: Saturday 14 November 2026 at 16:00 is `outside_hours` at step 4 with alternatives 17:00, 17:15, 17:30; a colour at 19:00 is `does_not_fit` at step 5; both chairs busy at 17:00 is step 7–8 with both resources in `facts`; an unknown service is step 1 with no alternatives.
  - [ ] 3.2 **[PBT] J2.** The booking tools say what the Booking_Rules say, over `allSectorPacks()` and `arbShop`. Validates 2.4, 2.5.
  - [ ] 3.3 `demoDb.ts`: in-memory PGlite, migrations applied as `tests/db/pglite.ts` does, the Demo_Shop seeded with no PIN, and `withBusy` in a transaction that always rolls back; an overlapping `busy` list is an input error.
  - [ ] 3.4 **[PBT] J3.** Tool calls never affect each other. `numRuns: 50`. Validates 2.6.
  - [ ] 3.5 `server.ts`: stdio transport and the three tools, in the API task 1.1 confirmed. In-process test through the SDK's in-memory transport: exactly three tools listed, one `check_slot` answered, an invalid input answered as an error with zod's path, code and message.
  - [ ] 3.6 Isolation test (`tests/mcp/isolation.test.ts`): importing `server.ts` with `@neondatabase/serverless` and `lib/db/client` mocked to throw succeeds; the server's sources contain no `process.env` and no `.env`. `scripts/check-client-bundle.mjs` refuses `@modelcontextprotocol` and `phantom-booking`.
  - [ ] 3.7 `mcp/phantom-booking/README.md`; register the server in `.kiro/settings/mcp.json` next to Context7 and add `@phantom-booking` to `builder.json` `tools`. Start it once from a real Kiro session, call each tool, and write the first lines of the MCP_Log below.
  - Requirements: 2.1–2.9, 15.2
  - Done when: `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass.

- [ ] 4. Safari unlock regression test (`tests/voice/neuralVoice.unlock.test.ts`)
  - [ ] 4.1 With a counting fake `Audio` constructor: `unlock()`, then two cached lines played to `ended`. Assert one construction, both `src` values set on that instance, three `play()` calls on it.
  - [ ] 4.2 Mutation: `startElement` builds a new element per line. The test must fail; record it in the mutation table and restore.
  - Requirements: 14.1, 14.2
  - Done when: `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass.

- [ ] 5. Browsers without speech recognition (`lib/voice/capability.ts`, `speechPort.ts`, `callSession.ts`, `components/call`). Needs 1.3.
  - [ ] 5.1 `capabilityMode` (pure) and `SpeechPort.capability(lang)` on the Web Speech port (constructor check plus the existing cached `available()`); the typed-only and fake ports implement it too. Unit tests for each `CapabilityInput`.
  - [ ] 5.2 `callSession.attach` asks for the capability of the selected language, and again on a language switch while idle, and re-creates the idle state with `recognition` from it. `callLoop.ts` does not change; S5 passes unchanged.
  - [ ] 5.3 `callCopy.ts` gains `noRecognition` in ES and EN (design.md wording). `CallScreen` shows it under the heading in `typed` mode and does not render `TypeInsteadButton` when `state.typed && !state.recognition` (only after the owner approves open question 4; until then, keep the button and say so in the report).
  - [ ] 5.4 **[PBT] J7.** The call starts typed exactly when it must, and no control is dead. Validates 6.2, 6.4, 6.5.
  - [ ] 5.5 DOM test (`tests/components/call/noRecognition.test.tsx`): a window with no `SpeechRecognition` and a fake `fetch`; the notice is shown before the Call; the Call button starts the Call and the text field gets focus; a typed line gets its reply in the Transcript; hang-up ends the Call. The same with `available()` answering `unavailable`. With recognition present, no notice.
  - Requirements: 6.1–6.7
  - Done when: `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass.

- [ ] 6. English parity (`tests/receptionist`, `tests/api`, `scripts/check-call.ts`). Needs 3.
  - [ ] 6.1 Ask `phantom-booking` for every booking outcome the English cases expect (Saturday 16:00, the alternatives, a colour at five and at seven) and log each call in the MCP_Log.
  - [ ] 6.2 `tests/receptionist/realCall.en.test.ts`: the five cases as `decideTurn` unit tests with the exact English lines (design.md, Part 3). If `names.ts` does not catch "idiot" or "darling", record it in the catch log, then fix `names.ts` with its own unit test.
  - [ ] 6.3 `tests/api/turn.realCall.en.test.ts`: the full English replay through the real route on PGlite with a scripted model, ending with one colour booking at five, no digit in anything spoken, and the model's own words never spoken. The Spanish test is not changed.
  - [ ] 6.4 **[PBT] J8.** The code decides the same in both languages. Validates 7.3.
  - [ ] 6.5 `scripts/lib/replyChecks.ts` (shared structural checks) and `scripts/check-call.ts`: `--base`, `--lang=es|en|both`, `--gap`, `--allow-remote`; one line per case and a total with the model requests made. Unit tests with a fake `fetch`: a passing and a failing reply per check; a remote base is refused before any request. Kiro does not run it against a server that writes to Neon (open question 6).
  - [ ] 6.6 DOM test: the ES / EN switch is found by name on the idle Call_Page at the 375 px media stub, before any press.
  - Requirements: 7.1–7.6
  - Done when: `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass.

- [ ] 7. Resting state and `tts_usage` (`lib/voice`, `lib/conversation`, `app/api/turn`, `app/api/speech`)
  - [ ] 7.1 `voiceStatus.ts` (pure). `NeuralVoicePort.onQuotaOut(listener)`, fired once by the existing `quotaOut` effect. `SpeechHintSchema` gains `{ kind: "browser", reason: "quota" }`, which the port treats as a quota answer. Unit tests in the existing neural-voice fakes.
  - [ ] 7.2 `speechFor`: on a cache miss only, read the `tts-exhausted:*` marks once; when every configured model is marked, return the `browser` hint. Route tests on PGlite: all marked gives `browser`; one free model gives `live`; a cached line is still `cached`; a failing marks read gives `live`.
  - [ ] 7.3 `callSession` keeps `voice` in its snapshot; `VoiceNotice` in `CallScreen` with its own `role="status"`, rendered empty from the start. `callCopy.ts` gains `voiceResting` (English wording pending open question 5). DOM test: a scripted 429 quota shows the notice once; a 503 does not; a new Call clears it.
  - [ ] 7.4 **[PBT] J4.** The voice is "resting" exactly after quota, until the next Call. Validates 3.1, 3.2, 3.4, 3.5.
  - [ ] 7.5 `ttsUsage.ts`: `ttsUsageLine` (pure) and the `tts-used:<model>` counter in `lib/db/ttsRepository.ts` (Pacific-day window in `rate_limits`, no new table). `/api/speech` increments it on a model's first chunk and writes the line in `after()` for every `say`. `.env.example` gains `TTS_MODEL_REQUESTS_PER_DAY`. Route tests on PGlite: one line per `say`; a 429 does not increment; a failing counter write still writes the line with `used: null`.
  - [ ] 7.6 **[PBT] J5.** The usage line is complete and carries nothing personal. Validates 5.1, 5.2, 5.4.
  - Requirements: 3.1–3.6, 5.1–5.5
  - Done when: `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass.

- [ ] 8. English voice cache (`lib/receptionist/cachePlan.ts`, `scripts/build-voice-cache.ts`). Starts only after natural-voice task 2.4.
  - [ ] 8.1 Re-read `cachePlan.ts`, `fixedPhrases.ts` and the hair-salon pack's English Voice_Profile as natural-voice left them. If the English voice is not recorded, stop and leave this task open.
  - [ ] 8.2 Include the English Fixed_Phrases in the plan; `--plan` reports English counts per tier and the estimated days. Unit test: the Spanish plan is unchanged line for line.
  - [ ] 8.3 **[PBT] J6.** English joins the cache plan without moving Spanish. `numRuns: 30`, 120 s timeout. Validates 4.2, 4.3.
  - [ ] 8.4 Run `--plan` (no API call, no database) and record its numbers in natural-voice's design.md next to the Spanish ones. The real run is an owner step (task 15).
  - Requirements: 4.1–4.5
  - Done when: `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass.

- [ ] 9. Call_Visuals and hiss (`lib/voice/callVisuals.ts`, `tapeHiss.ts`, `components/call`)
  - [ ] 9.1 `callVisuals` and `hissShouldPlay` (pure). Unit tests per phase.
  - [ ] 9.2 `CallVisuals.tsx` with `TapeReels` (imported, unchanged) and `LineLight.tsx` (the `light-blink` class, `data-light`, `aria-hidden`), placed above the Transcript.
  - [ ] 9.3 `tapeHiss.ts` on the neural port's unlocked AudioContext (structural types, no file, no dependency) and `HissToggle.tsx` (`aria-pressed`, "Ruido de cinta" / "Tape hiss", stored under `pl_hiss`, off by default). Unit tests with a fake AudioContext: starts and stops only when `hissShouldPlay` changes; nothing is created before the Caller turns it on.
  - [ ] 9.4 **[PBT] J9.** Reels and light follow the Call. Validates 9.1, 9.2, 9.7.
  - [ ] 9.5 **[PBT] J10.** The hiss never plays by itself. Validates 9.5, 9.6.
  - [ ] 9.6 DOM test: `data-reels` and `data-light` per phase with motion allowed and with reduced motion; every Transcript line carries `ghost-in` and is in the DOM at once; the hiss toggle's name and state.
  - [ ] 9.7 `contrast.test.ts`: the hiss toggle label and the Call_Visuals panel text.
  - Requirements: 9.1–9.8
  - Done when: `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass.

- [ ] 10. Brand_Assets (`assets/brand`, `scripts/build-brand-assets.ts`, `app/`). Needs 1.5.
  - [ ] 10.1 `assets/brand/icon.svg` and `og.svg` with the design.md tokens only. If text is drawn from a font file, add the font and its OFL licence to `assets/brand/fonts/` (after open question 7 is answered).
  - [ ] 10.2 `scripts/build-brand-assets.ts` writes `app/icon.svg`, `app/apple-icon.png` (180 × 180), `app/opengraph-image.png` (1200 × 630) and `app/opengraph-image.alt.txt`, in the form task 1.5 confirmed. Commit the PNGs. Unit test: running it twice gives byte-identical files.
  - [ ] 10.3 Delete `app/favicon.ico` and the default SVGs in `public/` after a search shows nothing references them; list the search in the report. `app/layout.tsx` metadata gets the one-line description of design.md.
  - [ ] 10.4 `contrast.test.ts` reads the OG image's text and background fills from `og.svg` and checks them.
  - Requirements: 10.1–10.6
  - Done when: `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass, and the build output lists the icon and OG image routes as static.

- [ ] 11. Landing page (`app/page.tsx`, `lib/landing`, `components/landing`). Needs 3, 10, and open question 1 answered.
  - [ ] 11.1 `lib/landing/copy.ts` (ES and EN: the problem line, the demo card, the three steps, Built with Kiro, Roadmap, `ROADMAP_TERMS`) and `lib/landing/repo.ts` (`REPO_URL`, `specLinks`).
  - [ ] 11.2 Ask `phantom-booking` for the example the three steps use (if one is shown) and log it in the MCP_Log.
  - [ ] 11.3 `app/page.tsx` stays static: the 6-digit PIN rule as now, `allSectorPacks()` names, then `LandingContent` (client island with the ES / EN switch, `lang` on `<main>`), `HowItWorks`, `BuiltWithKiro`, `RoadmapList`.
  - [ ] 11.4 DOM tests: both languages; the PIN shown for 6 digits, absent for 4 digits or unset, never placeholder digits; the Demo_Notice next to it; the two buttons' names and targets; the available packs equal the registry.
  - [ ] 11.5 `contrast.test.ts`: every new landing pair.
  - Requirements: 8.1–8.7, owner-machine 3.1–3.4
  - Done when: `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass, and the build lists `/` as static.

- [ ] 12. Claims (`tests/design/claims.test.ts`)
  - [ ] 12.1 `findUnlabelledClaims(doc)` (pure) and the test over the landing copy (both languages) and `README.md`.
  - [ ] 12.2 **[PBT] J12.** Unlabelled claims are always found. Validates 12.3.
  - [ ] 12.3 List every other place in the repository that names a Roadmap_Item as available (steering, spec introductions, NOTAS-KIRO.md) and propose wording to the owner in the report. Edit steering only after approval; never edit owner-machine spec files.
  - Requirements: 12.1–12.4
  - Done when: `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass.

- [ ] 13. Accessibility pass. Needs 1.4, 5, 7, 9 and 11.
  - [ ] 13.1 `tests/components/a11y/axe.test.tsx`: axe on the Landing_Page (ES and EN), CallScreen (idle voice, idle typed with the No_Recognition_Notice, typing, speaking with the Resting_Notice, ended), PinGate and MachineScreen; the rules turned off listed in the file with the reason. Any violation in `components/machine/` is recorded and asked about.
  - [ ] 13.2 Names: CallButton in its three modes, TypeInsteadButton, HissToggle, both language switches and the landing links, by role and name. Add `aria-label`s only where the visible text is not the name.
  - [ ] 13.3 Order and ring on the Landing_Page and the Call_Page with the `tabbables` helper: the visual order listed in the test, no `tabindex` above 0, `focus-ring` on every tabbable.
  - [ ] 13.4 `contrast.test.ts` covers both notices.
  - Requirements: 13.1–13.6
  - Done when: `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass.

- [ ] 14. README for judges (`README.md`, `scripts/readme-kiro.ts`, `scripts/lib`). Needs 2, 3 and 12.
  - [ ] 14.1 `scripts/lib/kiroTable.ts`: `parseNotas`, `renderKiroTable`, `splice`. Unit tests: escaped pipes, placeholder rows skipped, a missing or duplicated marker fails and changes nothing.
  - [ ] 14.2 **[PBT] J11.** The Kiro table copies the log faithfully. Validates 11.3, 11.6.
  - [ ] 14.3 `scripts/lib/projectNumbers.ts`: properties by id from each spec's Correctness Properties section, catch-log bugs (generator and oracle faults excluded), mutation rows (as open question 9 decides), tests from the Vitest JSON report. Unit tests on fixture specs. Every number is printed with its source and date.
  - [ ] 14.4 `scripts/readme-kiro.ts` writes both blocks between their markers. Unit test: two runs give the same README.
  - [ ] 14.5 The README itself: Try it in 30 seconds (`DEMO_URL`), GIF placeholders with alt text and a visible note, the Mermaid diagram of design.md, the generated blocks, Roadmap, then the existing sections unchanged. The claims test passes on it.
  - Requirements: 11.1–11.6, 12.1
  - Done when: `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass.

- [ ] 15. Manual checklist. Write it to `.kiro/specs/jury-polish/manual-checklist.md`; the owner runs it and records pass or fail per line. Kiro does not run it against the real database.
  - [ ] 15.1 Safari on macOS, Safari on iOS and Firefox: the No_Recognition_Notice before the Call, a whole typed Call, replies spoken where the browser can speak.
  - [ ] 15.2 The Resting_Notice with `GEMINI_TTS_MODEL` set to a model with no free quota; the `tts_usage` line in the Vercel logs.
  - [ ] 15.3 Owner steps: the English voice cache run (after natural-voice 2.4 and the owner's Neon approval) and the Call_Check_Script against `next dev`, recording its output.
  - [ ] 15.4 An English booking call by voice in Chrome.
  - [ ] 15.5 Call_Visuals: reels and light during a call; the hiss on, off and remembered after reload; everything still under reduced motion.
  - [ ] 15.6 375 px in Chrome's device mode and on a real phone for `/`, `/call/peluqueria-lola` and `/machine/peluqueria-lola`, with screenshots saved to `docs/screenshots/`.
  - [ ] 15.7 VoiceOver on Safari: a typed Call, both notices read once.
  - [ ] 15.8 The OG image and icon in a link preview and a browser tab; Lighthouse accessibility on `/` and `/call/peluqueria-lola`, both scores recorded.
  - [ ] 15.9 The hooks and the Booking_MCP from a fresh Kiro session: each fires or answers once.
  - Requirements: 1.3, 3, 4.5, 6, 7.4, 7.5, 9, 10, 13.5
  - Done when: the checklist is written, every line has a "Result / date" field, and `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` pass. Sub-tasks are ticked when the owner records a pass.

- [ ] 16. Notes for the jury in `NOTAS-KIRO.md`
  - [ ] 16.1 One row per property-test catch from the catch log, and one per mutation check result, including any mutation no property caught.
  - [ ] 16.2 One row per place the docs changed a first choice (task 1).
  - [ ] 16.3 One row for the Booking_MCP from the MCP_Log: what it confirmed and what it caught.
  - [ ] 16.4 Re-run `scripts/readme-kiro.ts` so the README table includes these rows.
  - Requirements: 1.3, 2.9, 15.5
  - Done when: `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass.

## MCP_Log

Each call to `phantom-booking` made while building a task: what was asked, what it answered, and whether it matched the expectation. A mismatch also gets a catch-log line.

| Task | Tool | Question | Answer | Matched the expectation? |
|---|---|---|---|---|

## Catch log

When a property test fails and the failure shows a real bug (not a broken generator), add one line here before fixing it: task, property, smallest counterexample, cause, fix. If the generator was wrong, say so and fix the generator; never weaken a property to make it pass. Task 16 turns these lines into `NOTAS-KIRO.md` rows.

| Task | Property | Counterexample | Cause | Fix |
|---|---|---|---|---|

### Mutation checks

Before a property sub-task is ticked, break the code on purpose as listed, run the suite, record what failed and the shrunk counterexample, and restore the code (suite green again). If no property catches a mutation, write that down; do not adjust the property to catch it after the fact without saying so.

| Task | Mutation | Expected to fail | What failed | Smallest counterexample |
|---|---|---|---|---|
| 2 | `guardSecretsCore` lets `.env.production` through | J1 | | |
| 2 | Drop the fit check (step 5) in `lib/booking/rules.ts` | the `booking-properties` hook (P3) | | |
| 3 | `explain` checks resources before the fit | J2 | | |
| 3 | `withBusy` commits instead of rolling back | J3 | | |
| 4 | `startElement` builds a new `Audio` per line | the unlock test | | |
| 5 | `capabilityMode` ignores `unavailable` | J7 and the no-recognition DOM test | | |
| 6 | `decideTurn` reads the opening-time offer from the English template in Spanish | J8 | | |
| 7 | `OTHER_FALLBACK` sets `resting` | J4 | | |
| 7 | An expired mark counts as exhausted | J5 | | |
| 8 | English lines inserted before Spanish tier 3 | J6 | | |
| 9 | Reels spin while `listening` | J9 | | |
| 9 | Hiss default read as on when storage throws | J10 | | |
| 12 | `findUnlabelledClaims` matches only lowercase | J12 | | |
| 14 | `parseNotas` drops rows with an escaped pipe | J11 | | |
