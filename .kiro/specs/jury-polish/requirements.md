# Requirements Document

## Introduction

**Jury polish** is the fourth spec. Its input is `.kiro/specs/JURY-REVIEW.md`, a judge's review of Phantom Line scored on the five Kiroween criteria. This spec covers items 3, 4, 5, 6, 7, 8, 9, 12 and 13 of that review, plus one regression test for the Safari audio fix of 2026-11-16 (commit 1839ce4). Items 1 (deploy), 2 (owner machine), 10 (CI), 11 (impact evidence), 14 (demo hygiene) and 15 (video) are out of scope here.

Five rules shape it:

1. **Real use, not decoration.** Hooks and MCP count only when they really ran. Every claim about them in `NOTAS-KIRO.md` or the README points at evidence: a hook's own output, a test, or a logged MCP call.
2. **Honest on screen.** When something is missing (the neural voice is out of quota, the browser cannot recognise speech, a feature is not built), the page says so in one plain line instead of failing silently or promising it.
3. **English is a first-class language.** Most judges will hear the English side first. Every Spanish real-call fix has an English twin, tested the same way.
4. **The theme never costs usability.** Every new motion stops with `prefers-reduced-motion`, every new text pair meets 4.5:1 (3:1 for large text), and every new control works by keyboard.
5. **The same working rules as owner-machine.** No env files are read or written, every database test runs on PGlite, no test is weakened, the docs are checked before memory, and each finding gets its `NOTAS-KIRO.md` row. The files in `.kiro/specs/owner-machine/` are read, never changed.

Out of scope: building WhatsApp, web chat or any new sector pack (they are labelled Roadmap instead, Requirement 12); a second text-model provider; the English voice audition itself (natural-voice task 2, which needs the owner's ears); deploying.

## Glossary

Terms already defined in `core-call-loop/requirements.md`, `natural-voice/requirements.md` and `owner-machine/requirements.md` keep their meaning: Phantom_Line, Call_Page, Turn_API, Receptionist, Booking_Rules, Shop, Sector_Pack, Caller, Owner, Call, Turn, Typed_Mode, Demo_Shop, Demo_Notice, Machine_Page, PIN_Gate, Landing_Page, Neural_Voice, Browser_Voice, Voice_Cache, Fixed_Phrase, Cache_Plan, Speech_Hint, Message_Light. New terms:

- **Kiro_Hook**: A hook defined in `.kiro/hooks/` (IDE) or in the `hooks` list of `.kiro/agents/builder.json` (CLI): `guard-secrets`, `booking-properties` and `session-brief`.
- **Hook_Evidence**: A dated record that a Kiro_Hook ran in a real Kiro session: the session kind (IDE or CLI), the tool call that triggered it, the hook's own output, and what it changed.
- **Booking_MCP**: The project's own MCP server at `mcp/phantom-booking/`, speaking stdio, exposing the pure Booking_Rules over an in-memory PGlite database seeded with the Demo_Shop.
- **Booking_Tool**: One of the Booking_MCP's tools: `check_slot`, `nearest_slots`, `explain_rejection`.
- **MCP_Log**: The table in `tasks.md` where each Booking_MCP call made while building a later task is recorded with what it caught or confirmed.
- **Voice_Status**: What the Call_Page tells the Caller about the voice: `neural`, or `resting` once the Neural_Voice is out of quota for the rest of the Call.
- **Resting_Notice**: The visible line shown while the Voice_Status is `resting`: "La voz natural descansa; te atiende la voz del navegador." / "The natural voice is resting; your browser's voice is answering."
- **TTS_Usage_Line**: One `tts_usage` JSON line in the server log with the current Pacific day's TTS use per model.
- **Capability_Mode**: How a Call starts in this browser: `voice` when speech recognition is available for the Call's language, `typed` otherwise.
- **No_Recognition_Notice**: The line shown before the Call when the Capability_Mode is `typed`: "La voz funciona en Chrome; aquí puedes escribir." / "Voice works in Chrome; here you can type."
- **Real_Call_Cases**: The five cases from the owner's real Spanish call of 2026-11-13, replayed in `tests/api/turn.realCall.test.ts`: (1) the honest greeting, (2) a time written with digits outside opening hours ("las 4:00 de la tarde"), (3) a corrected time with an insult ("a las cinco no a las 17 Pánfilo"), (4) a service asked in the caller's words ("pintar el pelo de rosa"), (5) an endearment given as the name ("Mi amor").
- **Call_Check_Script**: `scripts/check-call.ts`, a scripted HTTP check that plays the Real_Call_Cases against a running app's `/api/turn`.
- **Call_Visuals**: The haunted details on the Call_Page: the tape reels, the line light, the ghost fade on Transcript lines, and the optional Tape_Hiss.
- **Tape_Hiss**: A faint noise sound generated in the browser on the Call_Page while a Call is live, off by default.
- **Brand_Assets**: The favicon, the app icon (`apple-icon`) and the Open Graph image.
- **Kiro_Table**: The "How we used Kiro" table in `README.md`, generated from `NOTAS-KIRO.md` by a script.
- **Project_Numbers**: The counts shown in the README (tests, correctness properties, mutation proofs, bugs caught), each computed by a script from a named source.
- **Roadmap_Item**: A capability that is described in the product but not built: WhatsApp, web chat, and every Sector_Pack not in the registry (`lib/sectors`).
- **Repo_URL**: The public GitHub URL of the repository, kept in one constant until it exists.
- **DEMO_URL**: The placeholder for the deployed demo's URL in the README.

## Requirements

### Requirement 1: Evidence that the Kiro hooks really fire

**User Story:** As a judge, I want to see that the hooks ran in real sessions and what they changed, so that I can score them as used, not as configuration.

#### Acceptance Criteria

1. BEFORE any evidence is recorded, THE task SHALL check the current Kiro documentation for the hook file formats and trigger names of the IDE and the CLI, and SHALL record whether `.kiro/hooks/booking-properties.json` and the `hooks` of `builder.json` are in the form each one reads. IF a file is not in a form Kiro reads, THEN the task SHALL say so and ask before changing it.
2. THE `guard-secrets` matcher SHALL live in a function that a test can call without spawning a process, and the hook script SHALL keep its current behaviour: exit 2 with its message for a real env file name, exit 0 otherwise, `.env.example` and `--env-file=.env.local` allowed.
3. `NOTAS-KIRO.md` SHALL get one Hook_Evidence row per Kiro_Hook: `guard-secrets` blocking a tool call that named an env file, `booking-properties` failing after a deliberately broken write to `lib/booking/` (and going green after the restore), and `session-brief` printing the brief at session start.
4. THE `guard-secrets` evidence SHALL be produced without any secret being read: either found in an earlier session's record, or produced by a call that names a non-existent env file (for example `.env.hooktest`). No tool call SHALL name `.env.local` to produce evidence.
5. THE `booking-properties` evidence SHALL quote the hook's own failing output, name the mutation, and show that the code was restored and the booking properties pass again.
6. IF a Kiro_Hook cannot be made to fire in this environment, THEN `NOTAS-KIRO.md` SHALL say so plainly, and no row SHALL claim it fired.

### Requirement 2: Our own MCP server for the booking core

**User Story:** As the builder, I want to ask the real booking rules a question while I write tests and copy, so that expectations come from the code that decides, not from my memory of it.

#### Acceptance Criteria

1. BEFORE writing the server, THE task SHALL check the current `@modelcontextprotocol/sdk` documentation and `package.json` (engines, peer dependencies, zod version, stdio transport, tool registration, in-memory transport for tests), and SHALL record what changed the first choice.
2. THE Booking_MCP SHALL live in `mcp/phantom-booking/`, speak MCP over stdio, and start with `node --import tsx mcp/phantom-booking/server.ts`.
3. THE Booking_MCP SHALL run on an in-memory PGlite database with the project's migrations applied and the Demo_Shop seeded, and SHALL NOT import the Neon driver, read `DATABASE_URL`, read any env file, or open a network connection.
4. THE Booking_MCP SHALL expose exactly three Booking_Tools, each with a zod input schema:
   - `check_slot`: a service, a local date and a local time in the Demo_Shop's Time_Zone, an optional `now`, and optional `busy` bookings; it answers accept (with the resource, start and end) or reject (with the reason and up to 3 alternatives), exactly as `checkBooking`.
   - `nearest_slots`: the same input; it answers the nearest valid slots, exactly as `findNearestSlots`.
   - `explain_rejection`: the same input; it answers which step of the Booking_Rules' evaluation order decided, the reason, and the facts that step used (the day's sessions, the service's duration and end, the busy resources).
5. THE Booking_Tools SHALL answer only through the pure Booking_Rules in `lib/booking`; no Booking_Tool SHALL contain a booking rule of its own.
6. THE `busy` bookings of one call SHALL be written to PGlite inside a transaction that is rolled back before the answer, so calls never affect each other, and a `busy` list that the no-overlap constraint rejects SHALL be answered as an input error.
7. THE Booking_MCP SHALL be registered in `.kiro/settings/mcp.json` next to Context7, and SHALL be available to the builder agent.
8. EVERY later task of this spec that writes an expected booking outcome (a rejection, an alternative, an accepted slot) SHALL ask the Booking_MCP for it first, and SHALL record the call and its result in the MCP_Log, including any case where the Booking_MCP disagreed with the expectation.
9. `NOTAS-KIRO.md` SHALL get one row for the Booking_MCP with what it caught or confirmed, from the MCP_Log.

### Requirement 3: An honest state when the neural voice is out of quota

**User Story:** As a judge testing the demo late in the day, I want to be told when the natural voice has run out, so that I do not think the product always sounds robotic.

#### Acceptance Criteria

1. WHEN the Neural_Voice gets a quota answer during a Call, THE Call_Page SHALL set the Voice_Status to `resting` for the rest of that Call.
2. WHEN the Turn_API finds, for a reply that would be spoken live, that every configured TTS model is marked exhausted, THE Turn_API SHALL say so in the Speech_Hint instead of issuing a live token, and THE Call_Page SHALL set the Voice_Status to `resting` without requesting `/api/speech`.
3. WHILE the Voice_Status is `resting`, THE Call_Page SHALL show the Resting_Notice in the Call's language, in a polite live region, announced once per Call.
4. THE Voice_Status SHALL go back to `neural` only when a new Call starts.
5. A Neural_Voice fallback that is not caused by quota (deadline, stall, network) SHALL NOT show the Resting_Notice.
6. THE Resting_Notice SHALL meet the contrast rules of Requirement 13.3 and SHALL NOT move or blink.

### Requirement 4: The English half of the voice cache plan

**User Story:** As an English-speaking judge, I want the receptionist's fixed English lines to sound natural even after the day's live quota is gone.

#### Acceptance Criteria

1. THIS requirement SHALL start only after natural-voice task 2.4 has recorded the English voice. Until then, the task SHALL stay open and say so.
2. THE Cache_Plan SHALL include the English Fixed_Phrases of tiers 1–5, rendered by the real `phrases("en", …)`, after the Spanish lines, deduplicated by key.
3. THE Spanish part of the Cache_Plan SHALL stay exactly as it is now, line for line and in the same order.
4. THE pre-generation script's `--plan` output SHALL report the English line counts per tier and the estimated days, with no API call.
5. THE real pre-generation run for English SHALL be an owner step, run only after the owner approves writing to Neon; Kiro SHALL NOT run it.

### Requirement 5: A server log line with the day's TTS use

**User Story:** As the owner, I want one log line that tells me how much of each TTS model's daily quota is gone, so that I can tell judges' traffic from a bug.

#### Acceptance Criteria

1. WHEN `/api/speech` finishes a `say` request, whatever the outcome, THE server SHALL write one TTS_Usage_Line.
2. THE TTS_Usage_Line SHALL contain the Pacific day, and for each model in `GEMINI_TTS_MODEL` order: the model id, the requests it answered that Pacific day, the configured per-model daily limit, whether it is marked exhausted, and when its mark expires. It SHALL also contain the global daily TTS count and its limit.
3. THE per-model answered count SHALL be kept in the existing `rate_limits` table, in windows of one Pacific day, so it holds across server instances.
4. THE TTS_Usage_Line SHALL NOT contain the text spoken, the speech token, a name, a phone, the visitor key, the IP address or the API key.
5. THE per-model daily limit SHALL be configurable without code changes and SHALL default to the measured 10.

### Requirement 6: Browsers without speech recognition

**User Story:** As a judge on Safari or Firefox, I want the call page to tell me plainly that voice input works in Chrome and to let me type, so that I never press a button that does nothing.

#### Acceptance Criteria

1. BEFORE writing code, THE task SHALL check MDN's browser compatibility data for `SpeechRecognition`, `webkitSpeechRecognition` and `SpeechRecognition.available()` in current Safari, Safari on iOS and Firefox, and SHALL record the result.
2. THE Capability_Mode SHALL be `typed` WHEN the browser has no speech recognition constructor, or WHEN `available()` answers `unavailable` for the Call's language; otherwise it SHALL be `voice`.
3. WHEN the Capability_Mode is `typed`, THE Call_Page SHALL show the No_Recognition_Notice in the selected language before the Call starts, visible without scrolling at a 375 px-wide viewport.
4. WHEN the Capability_Mode is `typed`, pressing the Call button SHALL start the Call in Typed_Mode and move focus to the text field once it is shown; the Call button SHALL never be disabled and SHALL never do nothing.
5. WHEN the Capability_Mode is `typed`, THE Call_Page SHALL NOT show any control whose only effect is to switch from voice to typing.
6. WHEN the Capability_Mode is `typed` and the browser can speak, THE Receptionist's replies SHALL still be spoken, with the Neural_Voice or the Browser_Voice as in natural-voice.
7. THE Capability_Mode SHALL be decided by a pure function, and its behaviour SHALL be tested in the DOM with a window that has no `SpeechRecognition`, through a whole typed Call: notice, Call, a typed line, the reply, hang-up.

### Requirement 7: English parity for the real-call cases

**User Story:** As an English-speaking judge, I want the receptionist to handle my call as well as it handles a Spanish one.

#### Acceptance Criteria

1. EACH of the five Real_Call_Cases SHALL have an English twin with the same intent: (1) the greeting names the salon's virtual assistant and never claims to be a person; (2) "at 4:00 pm tomorrow" outside opening hours gets the opening time and the nearest times in words, with no digits; (3) "five, not 17" with an insult is accepted as five o'clock, the insult is never repeated, and nothing says "I'll put you down" before the read-back; (4) "dye my hair pink" reaches the colour service with its length and price in words, and the longer service is re-checked against closing time; (5) "darling" given as the name is asked again once, then accepted.
2. EACH English twin SHALL be a unit test on `decideTurn` or `phrases("en", …)` with the exact expected line, and SHALL be part of a full English replay through the real Turn_API route on PGlite with a scripted model, like the Spanish one.
3. THE code's booking decisions SHALL not depend on the Call's language: for the same fields, shop, agenda and time, `decideTurn` SHALL decide the same outcome, fields and booking in Spanish and English.
4. THE Call_Check_Script SHALL play the Real_Call_Cases in Spanish and English against a running app's `/api/turn`, check each reply with the same structural checks as the unit tests (no digits, sentence limits, outcome, fields), and print one line per case.
5. THE Call_Check_Script SHALL refuse any base URL that is not `localhost` unless `--allow-remote` is given, SHALL never read an env file, and SHALL print how many model requests it made. Running it against a server that writes to Neon SHALL be an owner step.
6. THE ES / EN switch SHALL be visible on the Call_Page before the Call starts, at 375 px, and a DOM test SHALL check it.

### Requirement 8: A real landing page

**User Story:** As a judge opening the link from Devpost, I want to understand the product in seconds and reach the demo in one tap.

#### Acceptance Criteria

1. THE Landing_Page at `/` SHALL follow `design.md` (Marfil & Oro, Newsreader with one gold phrase per heading, Inter, Caveat for the handwritten note, no dark screen, Lucide icons), and SHALL be laid out mobile first, with no horizontal scroll at 375 px.
2. THE Landing_Page SHALL state the problem in one line.
3. THE Landing_Page SHALL have a primary "Call Peluquería Lola" button to the Demo_Shop's Call_Page, and a secondary "Open the owner's machine" button to the Demo_Shop's Machine_Page with the demo PIN shown next to it, keeping owner-machine Requirement 3.1–3.4 (the PIN only when it is exactly 6 digits, never placeholder digits, and the Demo_Notice next to it).
4. THE Landing_Page SHALL explain how it works in 3 steps: the caller calls and the receptionist answers; the code checks the booking against the shop's rules; the owner's machine blinks with the message.
5. THE Landing_Page SHALL have a "Built with Kiro" section that links to the specs, the steering and `NOTAS-KIRO.md` on GitHub, through the single Repo_URL constant.
6. THE Landing_Page SHALL be available in Spanish and English, with an ES / EN switch, and SHALL mark the language of its content with `lang`.
7. THE Landing_Page SHALL stay a static page that prerenders, with no request data read on the server.

### Requirement 9: The theme on screen

**User Story:** As a judge, I want to see the haunted answering machine while I call, so that the Halloween idea is in the product and not only in the CSS.

#### Acceptance Criteria

1. THE Call_Page SHALL show two tape reels that turn while the Receptionist is speaking and are still otherwise.
2. THE Call_Page SHALL show a terracotta line light: blinking slowly while the Receptionist is listening for the Caller, lit steadily while the Call is live otherwise, and off before and after the Call. Its state SHALL also be in the existing status text, never by the light alone.
3. THE line light SHALL use the existing blink keyframes, so it never flashes more than 3 times in any one second.
4. EACH new Transcript line on the Call_Page SHALL fade in like a voice from far away (opacity and slight blur, 600 ms), as it does now, and SHALL be readable at once by screen readers.
5. THE Call_Page SHALL offer a Tape_Hiss toggle, off by default, remembered in the browser; WHEN it is on, a faint noise SHALL play only while a Call is live, below the Receptionist's voice, and SHALL stop at hang-up. THE Machine_Page SHALL never play the Tape_Hiss (owner-machine 7.11).
6. THE Tape_Hiss SHALL be generated in the browser with no audio file and no new dependency, and SHALL never start without the Caller turning it on.
7. WHILE `prefers-reduced-motion` is set, THE reels SHALL not turn, the light SHALL not blink, and Transcript lines SHALL appear at once.
8. EVERY new text and background pair SHALL meet the contrast rules of Requirement 13.3.

### Requirement 10: Favicon, app icon and social image

**User Story:** As a judge or a LinkedIn reader, I want the tab and the shared link to look finished.

#### Acceptance Criteria

1. THE app SHALL have its own favicon, app icon and Open Graph image in the Marfil & Oro style (ivory, gold, an espresso reel or the terracotta light), replacing Next.js's defaults.
2. THE Brand_Assets SHALL be generated from SVG sources in the repository by a script, and the generated PNG files SHALL be committed, so the build needs no network.
3. THE Open Graph image SHALL be 1200 × 630, with the product name in a serif heading, one gold phrase, and alt text; its text SHALL meet 4.5:1 (or 3:1 for large text).
4. THE Brand_Assets SHALL use the Next.js file conventions checked in the bundled docs, and `app/layout.tsx` metadata SHALL describe the product in one honest line.
5. THE default Next.js files in `public/` and `app/favicon.ico` SHALL be removed once nothing references them.
6. ANY font file used to draw text into the images SHALL be committed with its licence.

### Requirement 11: README for judges

**User Story:** As a judge, I want to try the demo and understand how it was built in under a minute of reading.

#### Acceptance Criteria

1. THE README SHALL start with a "Try it in 30 seconds" block: the DEMO_URL placeholder, the demo PIN rule, the call page and machine page paths, and the browser note of Requirement 6.
2. THE README SHALL include an architecture diagram in Mermaid: channels (voice built; WhatsApp and web chat as Roadmap) → `handleTurn` → Booking_Rules → Postgres, with "the model proposes, the code decides" visible on the diagram.
3. THE README SHALL include the Kiro_Table, generated from `NOTAS-KIRO.md` by a script that writes only between two marker comments; rows with an empty date or description SHALL be left out.
4. THE README SHALL show the Project_Numbers, each generated by a script from a named source (the Vitest JSON report, the correctness properties in the specs' `design.md` files, the mutation rows, the catch logs), with the date they were computed. No number SHALL be typed by hand.
5. THE README SHALL have GIF placeholders for a call and for the machine, each with alt text and a visible "placeholder" note until the owner records them.
6. RUNNING the generator twice SHALL give the same README as running it once, and SHALL not change anything outside the markers.

### Requirement 12: Claims match the product

**User Story:** As a judge, I want every feature I read about to exist, so that I can trust the rest of the presentation.

#### Acceptance Criteria

1. EVERY user-facing surface written by this spec (the Landing_Page, the README, the Open Graph image, the app metadata) SHALL label WhatsApp, web chat and every Sector_Pack not in the registry as "Roadmap" / "Próximamente".
2. A Sector_Pack MAY be shown as available only when it is in `allSectorPacks()`; the Landing_Page SHALL take the list of available packs from the registry, not from a hand-written list.
3. A test SHALL fail WHEN a Roadmap_Item is named on the Landing_Page or in the README outside a Roadmap section.
4. THE task SHALL list every other place in the repository that names a Roadmap_Item as available (steering, spec introductions, NOTAS-KIRO.md) and SHALL propose the wording to the owner; steering SHALL be edited only after approval, and owner-machine spec files SHALL not be edited.

### Requirement 13: Accessibility pass

**User Story:** As a judge using a screen reader, a keyboard or a small phone, I want every page to work for me.

#### Acceptance Criteria

1. THE DOM tests SHALL run `axe-core` on the Landing_Page, the Call_Page (idle, voice Call, typed Call, ended, with the No_Recognition_Notice and with the Resting_Notice) and the PIN_Gate, and SHALL report no violation. Rules that jsdom cannot evaluate (colour contrast) SHALL be turned off in axe and covered by Requirement 13.3 instead, and the test SHALL list them.
2. EVERY control on the Call_Page and the Landing_Page SHALL have an accessible name; CallButton, TypeInsteadButton, the Tape_Hiss toggle and both ES / EN switches SHALL be checked by name in a DOM test.
3. `tests/design/contrast.test.ts` SHALL cover every new text and background pair of this spec (Landing_Page, Call_Visuals, both notices, the Open Graph image's text) at 4.5:1 for normal text and 3:1 for large text.
4. THE tab order of the Landing_Page and the Call_Page SHALL follow the visual order, with no `tabindex` above 0 and the gold `focus-ring` on every focusable element, checked in a DOM test.
5. THE manual checklist SHALL include the Landing_Page, the Call_Page and the Machine_Page at 375 px in Chrome's device mode and on a real phone, a VoiceOver pass on Safari (typed Call), and screenshots at 375 px saved for the README.
6. IF axe finds a violation in a component of `components/machine/`, THEN the task SHALL record it and ask before changing that component.

### Requirement 14: Regression test for the Safari audio unlock

**User Story:** As the builder, I want the Safari fix of 2026-11-16 pinned by a test, so that nobody brings back one audio element per line.

#### Acceptance Criteria

1. A unit test of `createNeuralVoicePort` SHALL call `unlock()` and then speak two cached lines, and SHALL assert that exactly one `Audio` element was constructed and that both lines played through it.
2. THE test SHALL fail WHEN `startElement` constructs a new element per line (checked by a mutation, recorded in the mutation table).

### Requirement 15: Working rules

**User Story:** As the owner, I want this spec built under the same rules as the earlier ones, so that polishing never costs correctness.

#### Acceptance Criteria

1. No task SHALL read, print, write or log `.env.local` or any secret; a script that needs it SHALL be run with `node --env-file=.env.local`.
2. EVERY database test SHALL run on PGlite; no task SHALL run a migration, a seed, the voice cache build or the Call_Check_Script against Neon. Those are owner steps in the manual checklist.
3. No test SHALL be weakened or deleted to make it pass; IF a test is wrong, THEN the task SHALL say so and explain the change.
4. BEFORE using a library API or a platform behaviour, THE task SHALL check the docs installed in `node_modules` or the current online docs, and SHALL record in `design.md` where the docs changed the first choice. IF the docs cannot be reached, THEN the task SHALL say so and leave the question open instead of guessing.
5. EVERY finding worth telling the jury SHALL get a `NOTAS-KIRO.md` row.
6. THE files in `.kiro/specs/owner-machine/` SHALL be read only. Owner-machine Requirement 3 and its tests SHALL keep passing unchanged.
7. EVERY task SHALL finish with `npx vitest run`, `npm run lint`, `npx tsc --noEmit` and `npm run build`, and SHALL report the real results, failures included.
8. A new dependency SHALL be a dev dependency unless the running app needs it, SHALL support Node 20.19, and SHALL be named in `design.md` with the reason.
