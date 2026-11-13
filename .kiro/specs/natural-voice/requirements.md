# Requirements Document

## Introduction

The core call loop works: Chrome recognises the caller well and the booking is confirmed. The owner rejected two things after a real call. The receptionist's voice is the browser's robotic `speechSynthesis`, and its words do not sound like the person who runs a hair salon in Madrid: it says "a las 17:15" and "Entonces, cita de corte el viernes 13 a las 19:30. ¿Te lo confirmo?" where a real owner says "a las cinco y cuarto" and "Te apunto un corte mañana a las siete y media, ¿vale?".

This feature, **natural voice**, fixes both. Part A gives the receptionist a neural voice generated on the server with the Gemini API we already use, with a fallback chain that never leaves the caller in silence. Part B makes every word the receptionist says sound like the salon: times, days, prices and phone numbers spoken the way people say them, warm colloquial Spanish from Spain (tú), and English with the same warmth. Times, days and numbers are turned into words by code, never by the model. The receptionist always says it is the salon's virtual assistant.

Out of scope: a new speech recogniser (Chrome's recognition stays), the owner's machine (spec `owner-machine`), channels other than voice, and languages other than `es` and `en`.

## Glossary

Terms already defined in `.kiro/specs/core-call-loop/requirements.md` (Call_Page, Turn_API, Conversation_Core, Receptionist, Gemini_API, Shop_Profile, Sector_Pack, Turn, Call, Fallback_Message, Typed_Mode, Speech_Synthesis, Time_Zone, Rate_Limit, Visitor) keep their meaning.

- **Neural_Voice**: Speech audio generated on the server by a Gemini text-to-speech model from the text of one reply.
- **TTS_API**: The `POST /api/speech` server endpoint that returns Neural_Voice audio for one reply. It is the only place that calls a Gemini text-to-speech model.
- **TTS_Model**: The Gemini text-to-speech model id(s) used by the TTS_API, configured by environment variable as an ordered list, like `GEMINI_MODEL`.
- **Voice_Profile**: The voice name, language code and short style prompt used for one language, e.g. a warm voice with "a friendly hairdresser in Madrid, relaxed, natural pace, smiling". It lives in the Sector_Pack, and a Shop_Profile may override it.
- **Browser_Voice**: Speech produced by the browser's Speech_Synthesis, used only as a fallback.
- **Fixed_Phrase**: A reply whose text does not depend on the caller: the greeting of each Shop and language, the end Fallback_Message, the retry Fallback_Message, the Typed_Mode notice, and the rate-limited-start line.
- **Phrase_Cache**: Stored Neural_Voice audio for the Fixed_Phrases, keyed by the exact text and Voice_Profile, so a Fixed_Phrase never waits on the TTS_Model.
- **Time_To_First_Audio**: The time from the moment the Call_Page has the reply text until the first sound of that reply plays.
- **TTS_Deadline**: The longest the Call_Page waits for the first audio of a reply before it speaks it with the Browser_Voice. Chosen from the spike measurements.
- **Spoken_Form**: The text of a time, day, number, price or phone number written in words as a person says it, with no digits ("a las cinco y cuarto", "mañana", "quince euros").
- **Period_Of_Day**: The words added to a Spanish time when the hour alone is ambiguous: "de la mañana", "del mediodía", "de la tarde", "de la noche". In English: "in the morning", "in the afternoon", "in the evening", "at night", plus "noon" and "midnight".
- **Phrase_Template**: A code-owned line of the Receptionist (greeting, asking a field, read-back, confirmation, rejection with alternatives, booking not found, fallback, goodbye), from `lib/receptionist/phrases.ts`.
- **Phrase_Variant**: One of several approved wordings of the same Phrase_Template.
- **Variant_Seed**: The Call id plus the Turn number, used to pick a Phrase_Variant deterministically.
- **AI_Disclosure**: The words in the greeting that tell the caller they are talking to the Shop's virtual assistant, an AI.
- **Spike**: Task 1 of this spec: real, spaced calls to the Gemini text-to-speech models with the project's free-tier key, to measure latency, streaming behaviour and quota before any design depends on them.

## Requirements

### Requirement 1: Neural voice from the server

**User Story:** As a Caller, I want the receptionist to sound like a warm person, so that I feel I am talking to the salon and not to a robot.

#### Acceptance Criteria

1. WHEN the Call_Page has a reply to speak and the Call is in voice mode, THE Call_Page SHALL request Neural_Voice audio for that reply from the TTS_API and play it.
2. THE TTS_API SHALL call the Gemini text-to-speech model only from the server, with the existing `GEMINI_API_KEY`, and SHALL never send the key, or any value derived from it, to the browser.
3. THE TTS_API SHALL accept a POST body validated with zod, containing the shopId, the language, and either the reply text (at most 600 characters) with the speech token the Turn_API issued for it, or the key of a Fixed_Phrase. Any other key SHALL fail validation with a 400.
4. THE TTS_API SHALL produce audio only for text that the Receptionist itself produced: a reply the Turn_API returned (proved by its speech token, which binds the shop, the language and the exact text and expires after a few minutes) or a Fixed_Phrase of that Shop. A request for any other text SHALL be refused, so the endpoint cannot be used as a free text-to-speech service.
5. WHEN the Call_Page receives a reply, THE Call_Page SHALL show its text in the transcript at once, before any audio arrives.
6. THE TTS_API SHALL return audio in a format that Chrome on desktop and Android plays without plug-ins.
7. THE TTS_API SHALL use the default Node.js runtime, and SHALL count against the same per-Visitor and global Rate_Limits as the Turn_API, with its own configurable caps.
8. Speech recognition SHALL start only after the reply has finished playing, whichever voice played it, so the receptionist's own voice is never transcribed (as in core-call-loop 2.9).

### Requirement 2: Latency first

**User Story:** As a Caller, I want the receptionist to start speaking quickly, so that the call feels like a conversation and not like waiting on hold.

#### Acceptance Criteria

1. THE Spike SHALL measure the Time_To_First_Audio of each available TTS_Model on the free tier, with and without streaming, and record the median, the 90th percentile and the maximum in design.md.
2. WHERE the TTS_Model streams audio in more than one chunk, THE TTS_API SHALL forward each chunk to the browser as it arrives, and THE Call_Page SHALL start playing before the last chunk arrives.
3. THE Fixed_Phrases SHALL be served from the Phrase_Cache and SHALL never wait on the TTS_Model during a Call.
4. WHEN the text of a Fixed_Phrase or its Voice_Profile changes, THE Phrase_Cache SHALL treat it as a new entry, so a stale recording is never played for a new text.
5. IF no audio for a reply has started playing within the TTS_Deadline, THEN THE Call_Page SHALL speak the reply with the Browser_Voice and SHALL ignore any audio for that reply that arrives later.
6. THE TTS_Deadline SHALL be a named constant chosen from the Spike measurements, recorded with its reasoning in design.md.

### Requirement 3: Voice and style live in configuration

**User Story:** As a developer, I want the voice and its style in the sector pack or the shop profile, so that a new shop or sector changes how it sounds without code.

#### Acceptance Criteria

1. THE Sector_Pack SHALL define a Voice_Profile for each language it supports: a voice name, a language code (`es-ES`, `en-US`) and a style prompt of at most 200 characters.
2. A Shop_Profile MAY override the voice name and style prompt per language. WHEN it does, THE TTS_API SHALL use the Shop_Profile's values.
3. THE Voice_Profile SHALL be validated with zod when the Sector_Pack registry loads and whenever a Shop_Profile is read.
4. THE hair-salon Sector_Pack SHALL ship a Voice_Profile per language chosen in the Spike, with a style prompt in the spirit of "a friendly hairdresser in Madrid, relaxed, natural pace, smiling".
5. THE style prompt SHALL change only how the text is said. THE TTS_API SHALL never let the style prompt or the TTS_Model change the words that are spoken, and the audio's words SHALL be the reply text shown in the transcript.

### Requirement 4: Never silence

**User Story:** As a Caller, I want to always hear the reply, so that a failing voice service never leaves me in silence.

#### Acceptance Criteria

1. IF the TTS_API fails, answers that the quota is exceeded, is over a Rate_Limit, or the first audio does not play within the TTS_Deadline, THEN THE Call_Page SHALL speak the reply with the Browser_Voice.
2. WHEN choosing a Browser_Voice, THE Call_Page SHALL prefer, for the selected language, a voice whose name marks it as natural, neural, enhanced, premium or Google, over the first voice found, and SHALL fall back to the first voice for the language when none is marked.
3. IF neither Neural_Voice nor a Browser_Voice is available, THEN THE Call_Page SHALL show the reply in the transcript and continue the Call, as in core-call-loop 2.8.
4. WHEN the TTS_API answers the quota is exceeded (HTTP 429), THE TTS_API SHALL NOT retry, and THE Call_Page SHALL use the Browser_Voice for the rest of the Call without asking the TTS_API again.
5. WHEN the TTS_API falls back for any reason, THE server SHALL write one `tts_fallback` JSON line to the server log with the reason, the TTS_Model, the HTTP status, the SDK error class, the error message truncated to 300 characters and with the API key redacted, the latency, and whether the text was a Fixed_Phrase.
6. WHEN the Call_Page falls back on its own (deadline or playback error), THE Call_Page SHALL report the reason to the server in a small, rate-limited request so it reaches the same `tts_fallback` log.
7. THE `tts_fallback` line SHALL never contain the API key, the reply text, the caller's words, a name, a phone number or the visitor key.
8. A TTS failure SHALL never end the Call or change what the Conversation_Core decided.

### Requirement 5: Free-tier limits, measured

**User Story:** As the demo operator, I want to know whether the free tier can carry a demo call, so that the demo does not fail halfway through.

#### Acceptance Criteria

1. THE Spike SHALL run real calls to each available TTS_Model with the project's key, spaced in time, and record in design.md: which models answer, the per-minute and per-day limits reported by the API, the latency figures of 2.1, the audio format and sample rate returned, and whether streaming delivers more than one chunk.
2. THE Spike SHALL never print or log the API key or `.env.local`, and SHALL store any audio samples only in a git-ignored folder.
3. THE Spike SHALL count how many TTS requests one demo booking call needs, and compare it with the measured limits.
4. IF the measured free-tier limits cannot carry one full demo booking call, THEN design.md SHALL say so plainly with the numbers and SHALL propose the best alternative that needs no new account and no card.
5. THE TTS_API SHALL have its own global cap per hour and per day, configurable without code, set below the measured TTS quota, so the Gemini text model keeps its own quota.

### Requirement 6: Times spoken as people say them

**User Story:** As a Caller, I want to hear "a las cinco y cuarto", not "a las diecisiete quince", so that I understand the time at once.

#### Acceptance Criteria

1. THE Receptionist SHALL turn every time it speaks into a Spoken_Form with a pure function, `speakTime`, never with the model.
2. IN Spanish, `speakTime` SHALL use the 12-hour clock with "en punto" omitted: "a las diez", "a las diez y cuarto", "a las diez y media", "a las once menos cuarto", "a las diez y veinte", "a las once menos veinte", "a la una y media", "a las doce del mediodía".
3. IN Spanish, `speakTime` SHALL say "la una" for the hours 1 and 13 and "las N" for every other hour, and SHALL say "las doce" for the hours 0 and 12, never "las cero" or "las 0".
4. IN Spanish, minutes 1 to 30 SHALL be said after "y" ("y cinco", "y cuarto", "y media") and minutes 31 to 59 SHALL be said as "menos" before the next hour ("menos veinticinco", "menos cuarto").
5. `speakTime` SHALL add the Period_Of_Day only when it is needed to remove ambiguity. WHEN the time is given with the Shop's opening sessions of that day, the Period_Of_Day SHALL be left out if and only if the time itself falls inside an open session and the other reading of the same clock words (12 hours earlier or later, on the same day) does not. WHEN no opening sessions are given, the Period_Of_Day SHALL always be added. 12:00 SHALL always be "a las doce del mediodía" and 00:00 "a las doce de la noche".
6. IN English, `speakTime` SHALL say "at ten", "at quarter past five", "at half past seven", "at quarter to eleven", "at ten past ten", "at twenty to eleven", "at noon", "at midnight", with "in the morning", "in the afternoon", "in the evening" or "at night" added under the same rule as 6.5.
7. THE Spoken_Form of a time SHALL never contain a digit.
8. FOR ALL minutes of the day and both languages, parsing the Spoken_Form back with the same opening sessions SHALL give the same time (round trip).
9. THE hours in the system instruction (opening hours) SHALL be written in Spoken_Form, so the model reads and repeats words, not digits.

### Requirement 7: Days spoken relative to today

**User Story:** As a Caller, I want to hear "mañana" or "este sábado", so that I do not have to work out which date "el viernes 13" is.

#### Acceptance Criteria

1. THE Receptionist SHALL turn every day it speaks into a Spoken_Form with a pure function, `speakDay`, that takes the date, today's date and the language, with both dates in the Shop's Time_Zone.
2. IN Spanish, `speakDay` SHALL say "hoy" for today, "mañana" for tomorrow, "pasado mañana" for the day after, "este sábado" for a day 3 to 6 days ahead in the same Monday-to-Sunday week, "el sábado que viene" for a day 3 to 6 days ahead in the next week, and "el sábado veinte" for any other day, adding "de diciembre" when its month differs from today's month.
3. IN English, `speakDay` SHALL say "today", "tomorrow", "the day after tomorrow", "this Saturday", "next Saturday", and "Saturday the twentieth" under the same rules, adding "of December" when the month differs.
4. WHEN the read-back or the confirmation names a day that is today, tomorrow or the day after, THE Receptionist SHALL also say the weekday ("mañana viernes", "tomorrow, Friday"), so the caller can catch a mistake.
5. THE Spoken_Form of a day SHALL never contain a digit.
6. `speakDay` SHALL compute "today" from the current instant in the Shop's Time_Zone, never the server's, and SHALL give the right word on both sides of a daylight-saving change and around midnight.
7. FOR ALL pairs of dates within 60 days of each other, parsing the Spoken_Form of a day back with the same today's date SHALL give the same date.

### Requirement 8: Prices, numbers and phone numbers spoken

**User Story:** As a Caller, I want prices and my phone number read the way people say them, so that I can check them by ear.

#### Acceptance Criteria

1. THE Receptionist SHALL speak prices in words with a pure function: "quince euros", "cuarenta y cinco euros", "quince euros con cincuenta"; "fifteen euros", "fifteen euros fifty".
2. THE Receptionist SHALL speak whole numbers from 0 to 999 999 in words in both languages, with the Spanish forms correct ("veintiún euros", "veintiuno", "cien", "ciento uno", "quinientos").
3. WHEN the Receptionist reads back a phone number, THE Receptionist SHALL read its digits one by one in groups, the Spanish way for a Spanish number ("seis, uno, dos; tres, cuatro, cinco; seis, siete, ocho"), and SHALL never read a stored Booking's phone number to anyone who has not passed the Booking_Match.
4. THE prices in the system instruction SHALL be written in Spoken_Form.
5. FOR ALL whole numbers from 0 to 999 999, parsing the Spoken_Form back SHALL give the same number and the Spoken_Form SHALL contain no digit.

### Requirement 9: Talk like the salon

**User Story:** As the Owner, I want the receptionist to talk like me, warm and short, so that my customers feel at home.

#### Acceptance Criteria

1. EVERY Phrase_Template SHALL be rewritten in natural colloquial Spanish from Spain using tú, short and warm, and in natural English with the same tone: the greeting, asking for each field, the read-back, the confirmation, the rejection with alternatives, the service not offered, the booking not found, the fallbacks, the goodbye, and the reschedule and cancel lines.
2. THE read-back SHALL say the service, the day and the time, and SHALL ask for a yes in a natural way, e.g. "Te apunto un corte mañana viernes a las siete y media, ¿vale?".
3. THE rejection with alternatives SHALL sound like a person offering times, e.g. "A las nueve ya hemos cerrado. ¿Te viene bien a las siete y media? También tengo a las siete y cuarto o a las siete.", with the reason in plain words and the nearest alternative first.
4. A Phrase_Template MAY have several Phrase_Variants. THE Receptionist SHALL pick one with the Variant_Seed, so the same Call and Turn always gets the same wording and consecutive Turns do not always repeat the same opener.
5. EVERY Phrase_Variant SHALL keep the facts of its template: the same service, day, time, alternatives and next step.
6. THE Phrase_Templates SHALL use the Sector_Pack's vocabulary for what is booked and SHALL avoid gendered words about the receptionist itself, so the voice can change without changing the text.
7. Every Phrase_Template output SHALL contain no digit, no markdown and no emoji, and SHALL have at most 3 sentences of at most 25 words each. The model's own replies keep the limit of 2 sentences (Requirement 11.3). This amends core-call-loop 4.11 for code-owned lines only.

### Requirement 10: Honesty about being an AI

**User Story:** As a Caller, I want to know I am talking to a virtual assistant, so that I am not deceived (EU AI Act, Article 50).

#### Acceptance Criteria

1. THE greeting SHALL say, in a natural way and before any question, that the caller is talking to the Shop's virtual assistant, in every Phrase_Variant and both languages.
2. THE Receptionist SHALL never say it is the Owner, a named person, or a human, in any Phrase_Template or model reply.
3. WHEN the Caller asks whether they are talking to a person or a machine, THE Receptionist SHALL answer honestly that it is the Shop's virtual assistant and that the Owner will see the message.
4. THE Fixed_Phrase greeting in the Phrase_Cache SHALL contain the AI_Disclosure, so the cached audio and the shown text say the same.

### Requirement 11: The model's own words follow the same style

**User Story:** As a Caller, I want the answers to my questions to sound the same as the rest of the call, so that the receptionist feels like one person.

#### Acceptance Criteria

1. THE system instruction SHALL tell the model to use the same style as the Phrase_Templates (colloquial Spanish from Spain with tú, or natural English), to say times, days, prices and numbers in words, and SHALL include short examples of the target style.
2. THE system instruction SHALL tell the model to say it is the virtual assistant if asked, and never to claim to be the Owner or a person.
3. A model reply SHALL keep the core-call-loop limit of at most 2 sentences of at most 25 words each.
4. `toSpokenReply` SHALL, as a safety net, convert any remaining digit times ("17:15", "a las 17:15h"), prices ("15 €", "15 euros", "€15") and other numbers in a reply into Spoken_Form in the reply's language, so no reply reaches the caller with a digit.
5. `toSpokenReply` SHALL stay idempotent: a second pass SHALL change nothing.
6. Booking facts (availability, confirmed times, alternatives) SHALL still come only from code, as in core-call-loop 5.8.

### Requirement 12: What is shown is what is said

**User Story:** As a Caller who reads the screen, I want the transcript to match what I hear, so that nothing is confusing.

#### Acceptance Criteria

1. THE transcript on the Call_Page SHALL show exactly the reply text the TTS_API speaks, in Spoken_Form.
2. THE text the Call_Page sends back as conversation history SHALL be the same Spoken_Form text, so the model sees what the caller heard.
3. THE Owner's Message (agreed, suggested reply) MAY keep digits, because the Owner reads it; it SHALL not be spoken.

### Requirement 13: Correctness properties

**User Story:** As a developer, I want property-based tests over every minute, day and number, so that a single wrong word never reaches a caller.

#### Acceptance Criteria

1. THE property tests SHALL check, for every minute of the day (all 1 440) in both languages and for random opening sessions: no digit in the Spoken_Form, round trip back to the same time, "la una" exactly for hours 1 and 13 in Spanish, and never "las cero" or "las 0".
2. THE property tests SHALL check `speakDay` over random today's dates in 2026 (both Madrid daylight-saving weekends included) and targets up to 60 days away: no digit, round trip, and the right relative word for 0, 1 and 2 days ahead.
3. THE property tests SHALL check that every Phrase_Variant of every Phrase_Template, for random services, slots and seeds, has no digit, keeps its facts, and fits the limits of Requirement 9.7.
4. THE property tests SHALL check that variant choice is deterministic for the same Variant_Seed and always returns one of the approved variants.
5. THE property tests SHALL check that `toSpokenReply` output never contains a digit and stays idempotent for all strings, extending core-call-loop property S4 without weakening it.
6. Existing tests that assert the old wording SHALL be updated to the new wording with assertions at least as strict, never deleted.
