# Requirements Document

## Introduction

**Front desk brain** is the fifth spec. Its input is a real public call of 2026-11-16 (production log). The caller said "Hola Lola quería cortarme el pelo y hacerme un degradado". Gemini answered 503 "high demand" after 6.6 s, the hedged attempt timed out, the 8-second Turn budget ran out, the Receptionist said the Fallback_Message ("Perdona, ahora mismo no puedo atenderte bien. Le dejo tu mensaje a Lola y te llama, ¿vale?") and the Call ended. The owner called this unacceptable: a front desk that hands every model hiccup to the owner is worthless.

Six rules shape this spec:

1. **A model failure is never the caller's problem.** When the model fails or is late, the Code_Brain answers the same Turn from the Shop_Profile, and the Call goes on. Only the Caller ends a Call (goodbye, hang-up), or a finished booking, reschedule or cancel, or the Turn limit.
2. **The model proposes and the code decides, now on both paths.** The Code_Brain reads the Caller's words with rules and feeds the same `decideTurn` and the same Booking_Rules as the model path. Nothing the Code_Brain says is a fact that is not in the Shop_Profile or decided by the Booking_Rules.
3. **The owner gets a message only when the shop cannot answer.** A question the Shop_Profile does not cover, or an explicit request to speak to the owner, becomes an Owner_Note, and even then the Receptionist keeps the Call alive and offers what it can do.
4. **A real salon, not a toy.** The demo profile has the services, prices, durations and everyday answers of a real Spanish salon, and a caller can book two services in one sentence.
5. **The caller hears something one second after they stop talking.** When the Code_Brain is sure, the model is not called at all. When it is not sure, the model gets at most 1.6 s. A short filler covers any wait, and the reply's audio comes in the same response as its text (Requirements 17–22, the Latency group).
6. **The same working rules as before.** No env file is read, every database test runs on PGlite, no test is weakened, current docs come before memory, every finding gets its `NOTAS-KIRO.md` row, and the files in `.kiro/specs/owner-machine/` are never changed (owner-machine *code* gets one small, listed change: Requirement 16.5).

The Latency group comes from the owner after a real call on 2026-11-16: "the call works very well, but it is far too slow; I want the answer to start 1 second after I stop talking". Measured that day on Vercel `fra1`: `/api/turn` 1.65 s, `/api/speech` first byte 0.72 s, plus Chrome's own end-of-speech delay and the 300 ms start buffer: 3 to 4 s of silence per Turn.

Out of scope: a second text-model provider; WhatsApp and web chat (the Code_Brain is channel-agnostic, so they get it for free later); new sector packs (the lexicon is sector-neutral and the shop words come from the profile); a different speech recognition engine (the Latency group changes only how the app uses Chrome's results).

## Amendments to earlier specs

This spec changes requirements of `core-call-loop` that the owner's call showed to be wrong. Each change is listed here so it is deliberate, and the tests that pinned the old behaviour are rewritten to the new requirement (Requirement 15.4), never deleted.

| Earlier requirement | Old behaviour | New behaviour (this spec) |
|---|---|---|
| core-call-loop 4.7 | A model timeout, quota or unavailable answer says the Fallback_Message and ends the Call with outcome `fallback` | The Code_Brain answers the Turn and the Call goes on (Requirement 1) |
| core-call-loop 4.6 | Two invalid model outputs in a row end the Call | An invalid output is a model failure like any other; the Code_Brain answers (Requirement 1.2) |
| core-call-loop 4.7, `tech.md` | A Turn has an 8-second model budget (`MODEL_TIMEOUT_MS`), 2.5 s per attempt | The model is not called on a Sure_Reading; otherwise it waits at most 1.6 s, with attempt deadlines chosen from measurements (Requirements 2, 12, 19) |
| core-call-loop 4.3 (`DEFAULT_GEMINI_MODELS`) | Two default models | Three: `gemini-3.5-flash` is added third (Requirement 12.1) |
| core-call-loop 5.x | The service is asked for by the model; the day and time are asked for with "¿Qué día y a qué hora te viene bien?" | Once the service is known, the code offers the nearest free slot (Requirement 8) |
| core-call-loop 2.x (speech port) | A Turn is sent when Chrome delivers its final result | The app ends the Turn after a Silence_Cut, and a later final is merged, never sent twice (Requirement 17) |
| natural-voice 8.x and 10.x | A reply's live audio needs a second request, `POST /api/speech`; playback starts with 300 ms buffered | The audio comes in the `/api/turn` response itself; `/api/speech` stays for retries; playback starts with 150 ms buffered while the stream is steady (Requirements 20, 21) |
| owner-machine 5.3 (code only, spec files unchanged) | An urgent term anywhere in a Caller line makes the Message urgent | An urgent term inside one of the pack's Not_Urgent_Phrases ("prueba de alergia") does not count; every other urgent term still does (Requirement 16.5) |

owner-machine's requirements keep holding except the one listed change to 5.3, which the reviewer asked for on 2026-11-16 and which lives in this spec, not in `.kiro/specs/owner-machine/` (Requirement 16).

## Glossary

Terms already defined in `core-call-loop`, `natural-voice`, `owner-machine` and `jury-polish` keep their meaning: Phantom_Line, Call_Page, Turn_API, Receptionist, Booking_Rules, Shop, Shop_Profile, Sector_Pack, Caller, Owner, Call, Turn, Typed_Mode, Demo_Shop, Fallback_Message, Message, Tape, Agenda, Urgency_Rules, Final_Urgency, Spoken_Form, Fixed_Phrase, Cache_Plan, Voice_Cache, Phrase_Variant. New terms:

- **Code_Brain**: The pure, deterministic reader in `lib/conversation/brain/` that turns one Caller utterance, the Call's state and the Shop_Profile into a Reading. It does no I/O and never calls the model.
- **Reading**: What the Code_Brain understood in one utterance: the Intents it found, the Service_Request, a day, a time, a name, a phone, a yes or a no, a Profile_Topic, an Owner_Request, a Sensitive_Hit, a language switch, and the words it could not place.
- **Turn_Source**: Which reader decided the Turn's words: `model` (a valid model answer arrived within the Model_Wait) or `brain` (the model failed, was late, or was not called).
- **Model_Wait**: The longest a Turn waits for a valid model answer, `MODEL_TIMEOUT_MS`, at most 1600 ms of server time from the start of the model call (Requirement 12).
- **Sure_Reading**: A Reading that the code can answer completely without the model (Requirement 19.2): the model is not called for it.
- **Add_On**: A service that is only booked together with a base service (its `addOnTo` list): the fade is an Add_On of the men's cut.
- **Not_Urgent_Phrase**: A phrase in the Sector_Pack's vocabulary, per language, inside which an urgent term does not count ("prueba de alergia", "test de alergia", "allergy test").
- **End_Of_Speech**: The moment of the caller's last interim recognition result in a Turn, on the browser's clock. Every latency in the Latency group is measured from it.
- **Silence_Cut**: The app's decision that the caller's Turn is over: `endOfSpeechMs` (default 600 ms) after End_Of_Speech with no new result.
- **Filler**: A short acknowledgement the Receptionist says while the reply is not ready ("Vale, mira…", "A ver, déjame que mire…", "Mm, un segundito…" / "Okay, let me see…"), from the Voice_Cache, preloaded at Call start.
- **Reply_Audible**: The moment the reply's audio (cached or live) starts playing in the browser.
- **Inline_Audio**: The reply's audio sent in the `/api/turn` response, after its text, instead of by a second request.
- **Start_Buffer**: The live audio the browser queues before it starts playing a streamed reply: 150 ms while the Call's stream is steady, 300 ms after an underrun (Requirement 21).
- **Latency_Script**: `scripts/measure-latency.ts`, which drives scripted Turns against a base URL and prints p50 and p90 per stage.
- **Timing_Panel**: A Call_Page view, shown only with `?timing=1`, that records each Turn's stage times in the browser (durations only, no words) and shows their p50 and p90.
- **Intent**: One of: `booking`, `reschedule`, `cancel`, `question`, `owner_request`, `greeting`, `thanks`, `goodbye`, `yes`, `no`, `language_switch`, `unknown`.
- **Service_Alias**: A word or phrase a Caller may use for a catalog service ("degradado", "fade", "cortarme el pelo"), stored in the service's `aliases`.
- **Service_Request**: The services a Caller asked for in one utterance, in the order said: a list of 0 to 3 catalog services, or a Service_Choice.
- **Service_Choice**: An alias that fits more than one service equally well ("un corte" fits Corte de mujer, Corte de hombre and Corte infantil), with the candidates the Receptionist must ask about.
- **Service_Combo**: Two or three different catalog services booked as one appointment on one resource, back to back. Its duration and price are the sums of its parts.
- **Combo_Id**: The Service_Combo's id: its parts' ids in catalog order, joined with `+` ("corte-hombre+degradado"). A plain service id is a Combo_Id of one part.
- **Goes_With**: A service's optional list of services it is usually combined with. It breaks a Service_Choice tie: in "corte y degradado", Corte de hombre goes with Degradado.
- **Category**: A named group of services in the Shop_Profile ("cortes", "color", "peinados", "tratamientos", "barbería"), used to name the catalog in one short sentence and to answer questions about a group ("¿cuánto tarda el color?").
- **Profile_Topic**: A question the Shop_Profile answers: `hours` (in general, for a day, or "now"), `address`, `services` (the catalog), `price` and `duration` (of a service, a Service_Choice, a Service_Combo or a Category), or one FAQ_Entry.
- **FAQ_Entry**: A Shop_Profile item with a topic id, Spanish and English aliases, and a Spanish and English answer in Spoken_Form.
- **First_Offer**: The nearest free slot the code offers once the services are known and no time was asked for: "¿Te viene bien el martes a las diez?".
- **Owner_Request**: The Caller asks for the owner or a person ("quiero hablar con Lola", "que me llame la dueña", "can I talk to a person").
- **Owner_Note**: Something the Receptionist could not do and noted for the Owner during the Call: an Owner_Request, a question no Profile_Topic answers, or a Sensitive_Hit. It goes into the Call's Message.
- **Sensitive_Hit**: The Caller mentions one of the pack's sensitive topics or urgent terms outside a matched FAQ alias ("me ha dado alergia el tinte", "me pica").
- **Keep_Alive_Line**: A templated line that says what the Receptionist noted or could not do and, in the same breath, what it can do now ("Se lo apunto a Lola para que te llame. Mientras, ¿te doy cita o te cuento horarios y precios?").
- **Real_Call_2026_11_16**: The regression case: "Hola Lola quería cortarme el pelo y hacerme un degradado", with a model that always fails.
- **Rich_Profile**: The new demo Shop_Profile of Peluquería Lola (Requirement 11), seeded by `lib/db/seed.ts`.
- **V1_Profile**: The three-service Lola profile in `tests/fixtures/lola.ts`, kept unchanged for the tests that pin its texts.

## Requirements

### Requirement 1: A model failure never ends a Call

**User Story:** As a Caller, I want the receptionist to keep helping me when the AI service has a bad moment, so that I can still book without calling again.

#### Acceptance Criteria

1. WHEN the model call of a `say` Turn ends with `timeout`, `quota`, `unavailable` or `invalid_output`, THE Conversation_Core SHALL answer that Turn with the Code_Brain's Reading through `decideTurn`, and the Turn SHALL return `complete: false` unless `decideTurn` itself completes the Call (a goodbye, the Turn limit, or a confirmed booking, reschedule or cancel).
2. THE Conversation_Core SHALL NOT end a Call, set the Call's status to `failed`, or write a Message with outcome `fallback`, because of a model failure. The `invalid_output` retry line and the consecutive-invalid counter SHALL no longer end a Call.
3. WHEN the model failed or was late in a Turn, THE Receptionist SHALL NOT say the Fallback_Message or any line that says it cannot help right now.
4. THE Fallback_Message and outcome `fallback` SHALL remain only for the per-visitor rate limit (core-call-loop 3.10), which protects the service from abuse and is not a model failure.
5. WHEN the global hourly rate limit is reached, THE Conversation_Core SHALL skip the model call and answer the Turn with the Code_Brain, and the Call SHALL go on.
6. WHEN a Turn was answered with Turn_Source `brain` because the model failed, THE Call's state SHALL record it (`modelFailed: true`, and a count of brain Turns), so the Message keeps owner-machine's `model_failed` flag and Urgency_Rule 5.6.
7. A Call SHALL be completable, from greeting to a confirmed booking, with every Turn answered by the Code_Brain.

### Requirement 2: The Code_Brain answers first

**User Story:** As a Caller, I want an answer as soon as I stop talking, so that the call feels like talking to a person.

*Changed 2026-11-16 by the reviewer's answers 1 and 2: the model is skipped when the Code_Brain is sure, and otherwise waits at most 1.6 s (was 2.6 s).*

#### Acceptance Criteria

1. THE Conversation_Core SHALL compute the Code_Brain's Reading of every `say` Turn before the model is called, so the brain's answer never waits for the model.
2. WHEN the Reading is a Sure_Reading (Requirement 19.2), THE Conversation_Core SHALL NOT call the model in that Turn, and SHALL answer with the Code_Brain. This is not a model failure: no `turn_fallback` line is written and `modelFailed` is not set.
3. WHEN the Reading is not a Sure_Reading, THE Conversation_Core SHALL wait for a valid model answer for at most the Model_Wait (1600 ms), measured from the start of the model call, and SHALL then answer with the Code_Brain. Every model attempt still running SHALL be aborted.
4. WHEN the model fails before the Model_Wait ends (a 429, a 5xx with no attempt left, a network error, an invalid output), THE Conversation_Core SHALL answer with the Code_Brain at once, without waiting for the rest of the Model_Wait.
5. WHEN a valid model answer arrives within the Model_Wait, THE Conversation_Core SHALL use it as Requirement 13 says. A model answer that arrives after the Code_Brain answered SHALL be dropped and SHALL NOT change the Call's state.
6. THE Code_Brain SHALL read one utterance of up to 500 characters in under 20 ms on the test machine, measured in a unit test over the longest utterances of the test pools.
7. THE bookings read that a Turn needs SHALL start in parallel with the model call when the times involved are already known from the Call's state or the Reading.

### Requirement 3: Intent by rules

**User Story:** As a Caller, I want the receptionist to understand what I want from my own everyday words, so that I do not have to say it a special way.

#### Acceptance Criteria

1. THE Code_Brain SHALL find the Intents of an utterance with rules over the normalized text (lower case, no accents, punctuation removed), in Spanish and English, from three sources: a sector-neutral lexicon per language in `lib/conversation/brain/lexicon.ts`, the Sector_Pack's vocabulary, and the Shop_Profile (service aliases, Categories, FAQ aliases, the owner's name).
2. THE Code_Brain SHALL recognise: booking (a service, a booking word such as "cita", "hora", "hueco", "reservar", "pedir", "book", "appointment", or a day or time while no other Intent applies); reschedule ("cambiar", "mover", "aplazar", "reschedule", "move"); cancel ("anular", "cancelar", "no puedo ir", "cancel"); the Profile_Topics; greeting; thanks; goodbye ("adiós", "nada más", "eso es todo", "bye", "that's all"); yes ("sí", "vale", "perfecto", "de acuerdo", "me viene bien", "yes", "sure", "okay", "that works"); no ("no", "mejor otro", "no me viene bien", "no thanks"); a language switch ("¿hablas inglés?", "in English please", "en español"); and an Owner_Request.
3. WHEN an utterance has more than one Intent, THE Code_Brain SHALL decide in this order: Owner_Request, Sensitive_Hit, language switch, yes or no while a read-back or a First_Offer waits for an answer, cancel, reschedule, booking, Profile_Topic, goodbye, thanks, greeting, unknown. A Profile_Topic found together with a booking, reschedule or cancel SHALL be answered first and the flow SHALL continue in the same reply (Requirement 9.6).
4. A goodbye SHALL count only when the utterance has no booking, reschedule, cancel or Profile_Topic content ("gracias, adiós" ends; "adiós, y ¿abrís el sábado?" does not).
5. A yes or a no SHALL count only when it is the first word or phrase of the utterance. A yes followed by a new service, day or time is a change, not a confirmation (core-call-loop's S2 rule still applies).
6. THE lexicon SHALL be sector-neutral: no word in it names a service, a resource or a sector. A new Sector_Pack SHALL need no change to the lexicon.

### Requirement 4: Service matching through aliases

**User Story:** As a Caller, I want the receptionist to know which service I mean when I say it my way, misspell it, or ask for two at once.

#### Acceptance Criteria

1. THE Code_Brain SHALL match services on their id, their names in both languages and their Service_Aliases, ignoring case, accents and punctuation, and treating a plural as its singular ("mechas" and "mecha", "fades" and "fade").
2. THE Code_Brain SHALL tolerate one typo (insertion, deletion, substitution or swap of adjacent letters) in each alias word of 5 to 8 letters and two in a word of 9 or more letters, but SHALL NOT fuzzy-match a word of 4 letters or fewer, and SHALL NOT fuzzy-match a said word that is exactly another alias word or a lexicon word.
3. WHEN alias matches overlap in the utterance, THE longest match SHALL win ("arreglo de barba" over "barba").
4. WHEN one alias fits several services equally well, THE Code_Brain SHALL return a Service_Choice, unless the context decides it, in this order: (a) a candidate is itself matched elsewhere in the same utterance ("un corte para mi hijo" → Corte infantil); (b) exactly one candidate Goes_With another service matched in the same utterance ("corte y barba" → Corte de hombre); (c) exactly one candidate Goes_With, or is, a service already in the Call's services from an earlier Turn. Only when nothing decides it SHALL the Receptionist ask "¿De mujer, de hombre o infantil?" (Requirement 9; reviewer's answer 4).
5. WHILE a Service_Choice waits for an answer, THE Code_Brain SHALL match the next utterance against the candidates only ("de hombre", "para mi hijo", "el de mujer", "for a man"), and an utterance that names none of them SHALL leave the choice open and be read normally.
6. A service named right after a negation ("sin", "no", "nada de", "without", "no", "not") SHALL NOT be requested.
7. THE Service_Request of an utterance SHALL replace the Call's services, unless the utterance adds to them ("y también", "además", "y un", "also", "and a", "plus"), in which case the new services SHALL be added, up to 3.
8. WHEN a Caller names a service that is not in the catalog ("manicura"), THE Receptionist SHALL say it is not offered and name the catalog by Category (Requirement 11.6), as core-call-loop 5.x already does.
9. WHEN the model path is used, THE service text the model returns SHALL be matched with the same matcher, and a Service_Request the Code_Brain found in the utterance SHALL take precedence over it (Requirement 13.2).
10. WHEN a Service_Request holds an Add_On and none of its base services (from the utterance or the Call's services), THE first service of its `addOnTo` list SHALL be added, so "un degradado" and "corte degradado" alone are Corte de hombre + Degradado (reviewer's answer 3). The Add_On SHALL never be booked alone, and removing the base ("sin el corte") SHALL remove the Add_On too and say so.

### Requirement 5: Day and time reading

**User Story:** As a Caller, I want to say the day and time the way I always do, so that the receptionist books what I meant.

#### Acceptance Criteria

1. THE Code_Brain SHALL read a day from: "hoy", "mañana", "pasado mañana", a weekday ("el martes", "este martes", "el martes que viene", "next Tuesday", "on Tuesday"), a day of the month ("el veinte", "el 20", "el 20 de noviembre", "the 20th", "November 20"), and the same forms the Receptionist says (`speakDay`), using the existing parsers of `lib/receptionist/spoken/parse.ts` where they apply, always in the Shop's Time_Zone.
2. THE Code_Brain SHALL read a time from digits ("a las 5", "17:30", "17.30", "5:30", "a las 17", "a las 4:00 de la tarde", "5pm", "17h") and from words ("a las cinco y media", "a las once menos cuarto", "a mediodía", "at half past five", "at noon"), with an optional period of the day ("de la tarde", "por la mañana", "in the evening", "am", "pm").
3. WHEN a time is said without a period and both readings are possible, THE Code_Brain SHALL choose the one inside the Shop's sessions for that day, as `parseSpokenTime` does; WHEN both or neither are inside, it SHALL take the afternoon reading for hours 1 to 7 and the morning reading for hours 8 to 11.
4. A period of the day alone ("por la tarde", "in the morning") SHALL NOT be read as a time. It SHALL narrow the First_Offer to that part of the day (Requirement 8.3).
5. A correction in the same utterance SHALL win: the last time and the last day said count ("a las cinco, no, a las seis" is 18:00 in the afternoon session).
6. WHEN a day is read without a time, or a time without a day, THE Code_Brain SHALL keep what it read, and the time without a day SHALL take the date of a just-offered slot with that time, as `mergeFields` already does.
7. THE Code_Brain SHALL NOT read a time or a day from words that are not a time or a day cue: numbers in a phone, a price or a duration, and words like "una" in "una cita", "dos" in "dos servicios".

### Requirement 6: Name and phone reading

**User Story:** As a Caller, I want to give my name and phone once, in my own way, so that the booking is under the right person.

#### Acceptance Criteria

1. THE Code_Brain SHALL read a name after a name cue ("me llamo", "soy", "mi nombre es", "a nombre de", "my name is", "I'm", "it's", "this is", "under"), up to 5 words, stopping at punctuation, a digit or the next cue ("y mi teléfono").
2. WHILE the next field the booking needs is the name, THE Code_Brain SHALL also take an utterance of 1 to 4 words with no cue as the name, if it passes `looksLikeName` and is not a yes, a no, a service alias or a lexicon word.
3. THE Code_Brain SHALL NOT take the shop's owner name or the shop's name as the Caller's name when it is only addressed ("Hola Lola, quería…").
4. THE Code_Brain SHALL read a phone from digits with any grouping and separators ("612 34 56 78", "612-345-678", "+34 612 345 678") and from number words read in groups of one, two or three digits ("seis uno dos, treinta y cuatro, cincuenta y seis, setenta y ocho", "seiscientos doce…"), and SHALL normalize it with the existing `normalizePhone`.
5. A phone reading that `normalizePhone` rejects SHALL be treated as no phone, and the Receptionist SHALL ask for it again with a templated line.

### Requirement 7: Combined appointments

**User Story:** As a Caller, I want to ask for a haircut and a fade in one sentence and get one appointment for both, so that I do not have to book twice.

#### Acceptance Criteria

1. WHEN a Service_Request has 2 or 3 different services, THE Call SHALL book them as one Service_Combo: one Combo_Id, one start, one resource, a duration equal to the sum of the parts' durations, and a price equal to the sum of their prices.
2. THE Booking_Rules SHALL accept a Combo_Id wherever they accept a service id. A Service_Combo SHALL be evaluated exactly as one service of the summed duration: inside a session, ending by the session's close, after `now`, on a resource with no overlapping booking, and through the pack's sector rules. Every rule SHALL come with a property-based test (Property B5).
3. THE Combo_Id SHALL list its parts in catalog order, so "degradado y corte" and "corte y degradado" are the same Service_Combo. A Combo_Id with an unknown part, a repeated part, more than 3 parts, or a summed duration over 480 minutes SHALL be rejected as `unknown_service`.
4. ONE booking row SHALL be written for a Service_Combo, with the Combo_Id in `service_id`, so the "one Booking per Call" index and the no-overlap constraint hold unchanged, and no migration is needed.
5. THE First_Offer, the read-back and the `booked` line of a Service_Combo SHALL name all its parts ("un corte de hombre y un degradado"), and the First_Offer and the read-back SHALL state the total duration and the total price ("son cincuenta minutos y dieciocho euros"). A part priced "from" makes the total "desde".
6. THE Owner's Agenda, Tape, move dialog and Message texts SHALL name a Service_Combo by its parts ("Corte de hombre + Degradado"), and the Owner's move SHALL check it with the same Booking_Rules (owner-machine 10.x keeps holding).
7. A reschedule of a Service_Combo SHALL keep all its parts; a cancel SHALL cancel the one row.
8. THE Caller SHALL be able to add or remove a part before the read-back ("y también barba", "mejor sin el degradado"), and the code SHALL re-check the new Service_Combo against the Booking_Rules before offering or reading it back.

### Requirement 8: The First_Offer, and accepting it

**User Story:** As a Caller, I want the receptionist to suggest a time, so that I only have to say yes.

#### Acceptance Criteria

1. WHEN the services of a booking are known and no time was asked for, THE code SHALL offer the nearest slot the Booking_Rules accept, starting from the later of `now` plus 30 minutes (rounded up to the pack's slot step) and the start of the day the Caller asked for, if any; and the reply SHALL say what the services take and cost and ask "¿Te viene bien {día} a las {hora}?" / "Does {day} at {time} work for you?", plus a short invitation to say another day.
2. THE First_Offer SHALL be built only from the Booking_Rules' slot search over the bookings read fresh in this request; it SHALL never come from the model.
3. WHEN the Caller gave a part of the day ("por la tarde", "in the morning") or a day, THE First_Offer SHALL be the nearest accepted slot inside it; WHEN there is none within the slot search's 14 days, THE Receptionist SHALL say so with the existing "no encuentro otro hueco" line and the Call SHALL go on.
4. WHEN the Caller says yes to a First_Offer or to an offered alternative, with no new day or time, THE requested time SHALL become that slot, and the flow SHALL go on to the next missing field. Accepting an offer SHALL NOT confirm a booking: the read-back and its own yes are still required (core-call-loop S2).
5. WHEN the Caller says no to a First_Offer, THE Receptionist SHALL offer the next accepted slot after it, at most twice in a row, and then ask "¿Qué día y a qué hora te viene bien?".
6. THE First_Offer SHALL apply on both Turn_Sources.

### Requirement 9: Answers from the profile, and nothing else

**User Story:** As a Caller, I want straight answers about the shop, so that I do not have to wait for a call back to know if they take Bizum.

#### Acceptance Criteria

1. THE Code_Brain SHALL answer every Profile_Topic from the Shop_Profile with a template in Spoken_Form: the opening hours (all days, one named day, today, tomorrow, or whether the shop is open now), the address (digits said as words), the catalog by Category, a service's price and duration, the prices and durations of a Service_Choice's candidates or of a Category's services (at most 3, then "y te cuento el resto si quieres"), a Service_Combo's totals, and each FAQ_Entry's own answer.
2. THE Code_Brain SHALL NOT state any fact that is not in the Shop_Profile or decided by the Booking_Rules. Every price, duration, day, time and slot in a Code_Brain reply SHALL be a profile value, a sum of profile values for a Service_Combo, or a slot the Booking_Rules accept (Property B6).
3. WHEN the model path answers a question that a Profile_Topic covers, THE Receptionist SHALL say the Profile_Topic's templated answer instead of the model's own words.
4. A Profile_Topic answer SHALL be at most 3 sentences of at most 25 words, with no digits, markup or emoji (core-call-loop 9.7), and SHALL be cacheable.
5. FAQ_Entry answers SHALL be spoken exactly as written in the Shop_Profile, in the Call's language.
6. WHEN a Profile_Topic is answered in the middle of a booking, reschedule or cancel, THE reply SHALL be the answer followed by the next question of the flow, in at most 3 sentences ("Aceptamos tarjeta, Bizum y efectivo. ¿Me dices tu nombre?").
7. WHEN a question names an FAQ alias that contains an urgent term ("prueba de alergia"), THE FAQ answer SHALL be given; a Sensitive_Hit is only an urgent term or sensitive topic outside a matched FAQ alias. The same phrases SHALL be the pack's Not_Urgent_Phrases, so the Message of such a Call is not urgent for that reason either (Requirement 16.5).

### Requirement 10: Owner requests and unknown questions keep the Call alive

**User Story:** As the Owner, I want the receptionist to do everything it can before passing anything to me, and to tell me clearly what it could not do.

#### Acceptance Criteria

1. WHEN the Caller makes an Owner_Request, THE Receptionist SHALL say a Keep_Alive_Line that the Owner will get the message and call back, and offer what it can do now; THE Call SHALL go on, and an Owner_Note SHALL be recorded.
2. WHEN the Code_Brain finds no Intent and no Profile_Topic in a question, THE Receptionist SHALL say a Keep_Alive_Line ("Eso no lo sé, pero se lo apunto a Lola. ¿Te ayudo con una cita, horarios o precios?"), record an Owner_Note, and the Call SHALL go on.
3. WHEN the Code_Brain finds nothing it can place in an utterance that is not a question, THE Receptionist SHALL ask again in a templated line that says what it can do; after 3 such Turns in a row, it SHALL record an Owner_Note and say that it noted the call for the Owner and that the Caller can also type, and the Call SHALL go on.
4. WHEN a Sensitive_Hit is found, THE Receptionist SHALL say it cannot advise on that, that the Owner will call back, record an urgent Owner_Note, and the Call SHALL go on (the pack's `sensitiveTopics` rule stays).
5. AN Owner_Note SHALL hold the kind (owner_request, unanswered, sensitive, not_understood) and, for an unanswered question, the Caller's words truncated to 160 characters, so the Owner can read it on the Tape. It SHALL never be written to the server log.
6. WHEN a Call with Owner_Notes ends without a booking, reschedule or cancel, its Message SHALL have outcome `message`; WHEN it ends with one, the outcome stays `booked`, `rescheduled` or `cancelled`. In both cases, the Message's reason SHALL list the Owner_Notes after the main reason.
7. THE Message's reason SHALL be built by code when the Call had brain Turns: the services asked for, the Profile_Topics answered, and the Owner_Notes, in the Call's language, at most 160 characters.

### Requirement 11: A rich hair-salon profile

**User Story:** As a judge, I want the demo salon to feel like a real Spanish salon, so that I can ask it anything a customer would.

#### Acceptance Criteria

1. THE Shop_Profile schema SHALL accept these optional fields, each validated with zod at startup: `faq` (FAQ_Entries), `categories` (id and Spanish and English plural names), and per service `category`, `goesWith` (service ids), `addOnTo` (service ids: the service is an Add_On of these) and `priceFrom` (a boolean: the price is a starting price).
2. AN FAQ_Entry SHALL have a unique id that is not a built-in Profile_Topic (`hours`, `address`, `services`, `price`, `duration`), 1 to 30 aliases per language, and an answer per language of 1 to 2 sentences of at most 25 words each, with no digits, markup or emoji. No alias SHALL repeat across FAQ_Entries or equal a Service_Alias after normalization.
3. Service ids SHALL be lowercase letters, digits and hyphens, so no id contains `+`. Every `category`, `goesWith` and `addOnTo` id SHALL exist in the profile, an `addOnTo` id SHALL NOT itself be an Add_On, and a service SHALL NOT be an Add_On of itself.
4. THE Rich_Profile SHALL have at least these services, each with Spanish and English names, a Spanish and English spoken name, aliases in both languages (common phrasings and STT spellings), and a typical price and duration for a Madrid neighbourhood salon in 2026 (reviewer's answer 7; the owner reads the table before the seed runs on Neon): corte de mujer, corte de hombre, degradado (fade), corte infantil, barba, arreglo de barba, lavar y peinar, peinado de evento, peinado de novia, tinte de raíz, tinte completo, mechas, balayage, matiz o baño de color, decoloración, alisado de keratina, tratamiento hidratante, permanente u ondas, recogido.
5. THE Rich_Profile SHALL have an FAQ_Entry for each of: payment methods (tarjeta, Bizum, efectivo), parking, accessibility, walk-ins without appointment, cancellation policy, how early to arrive, kids, products sold, gift vouchers, the allergy test for colour (48 hours before), whether they do men, whether they speak English, Wi-Fi, and how to get there (metro). How long colour takes SHALL be answered from the colour Category's durations (Requirement 9.1), not from FAQ text, so it can never disagree with the catalog.
6. THE catalog line ("Tenemos…" / "We have…") SHALL name the Categories when the profile has more than 5 services and has Categories, and SHALL fit in one sentence of at most 25 words.
7. THE Rich_Profile SHALL keep the Demo_Shop's id, name, owner, address, Time_Zone, opening hours, two chairs, voice and speech rate, so the owner-machine demo rules and the voice settings keep holding.
8. THE seed SHALL validate the Rich_Profile and the hair-salon pack before writing, as it does now (core-call-loop 7.6).

### Requirement 12: A faster and wider model path

**User Story:** As the Owner, I want the model to answer whenever it can, so that free conversation stays natural on good days.

#### Acceptance Criteria

1. `DEFAULT_GEMINI_MODELS` SHALL be `gemini-3.5-flash-lite, gemini-flash-lite-latest, gemini-3.5-flash`, after the task has checked the current Gemini model docs for the id, its free-tier limits and the request options the client sends (`thinking_level`, `max_output_tokens`).
2. THE Model_Wait (`MODEL_TIMEOUT_MS`) SHALL be at most 1600 ms (reviewer's answer 1). `ATTEMPT_TIMEOUT_MS`, `MIN_ATTEMPT_MS` and `MAX_MODEL_ATTEMPTS` SHALL be chosen from a measurement of the three default models with `scripts/check-turn.ts --repeat` (quota-aware, written to `.measurements/`), by the rule in design.md, and recorded there with the numbers.
3. A 429 SHALL still never be retried, a 5xx SHALL still start a fresh attempt at once while time and attempts are left, and attempt k SHALL still use entry k mod n of the model list.
4. `.kiro/steering/tech.md` SHALL be updated to the new Model_Wait, attempt constants and default list in the same task, so the steering and the code never disagree.
5. Every Turn answered with Turn_Source `brain` because of a model failure or the Model_Wait SHALL write one `turn_fallback` line with `path: "brain"`, plus the existing fields (reason, limit, HTTP status, SDK error class, truncated message, latency, attempts, zod issues). A Turn answered by the brain because it was a Sure_Reading SHALL write no `turn_fallback` line. No line SHALL contain the API key, the model's text, the Caller's words, a name, a phone or the visitor key (tech.md).

### Requirement 13: The model path and the Code_Brain together

**User Story:** As the Owner, I want the model's natural words on good days and the code's facts on every day.

#### Acceptance Criteria

1. WHEN the Reading is not a Sure_Reading and a valid model answer arrives within the Model_Wait, THE Turn_Source SHALL be `model`, and THE model's reply SHALL be used for free conversation as today (core-call-loop 4.x), with the model's name, phone, day, time, yes and goodbye.
2. ON the model path, THE Code_Brain's Reading SHALL still decide: the Service_Request (when the utterance named a service), the Profile_Topic answer (Requirement 9.3), an Owner_Request, a Sensitive_Hit, and the First_Offer.
3. WHEN the model says `outOfProfile` and the Code_Brain found a Profile_Topic, THE Profile_Topic's answer SHALL be said, and no Owner_Note SHALL be recorded.
4. WHEN the model's answer and the Code_Brain disagree on a fact this requirement gives to the code, THE code's fact SHALL be used; the disagreement SHALL NOT be logged with the Caller's words.
5. THE same `decideTurn` SHALL decide both Turn_Sources, so every Booking_Rule, read-back and confirmation rule applies to both in the same way.

### Requirement 14: Speech and the voice cache

**User Story:** As a Caller, I want the brain's answers to sound as natural and as quick as the rest.

#### Acceptance Criteria

1. Every new template (Keep_Alive_Lines, the Service_Choice question, the First_Offer, Profile_Topic answers, the re-ask lines) SHALL be in Spoken_Form and SHALL say whether it is cacheable by the same rule as natural-voice 6.5: not cacheable when it holds a name, a phone or the Caller's own words.
2. THE Cache_Plan SHALL get two new tiers, appended after the existing tiers so no existing tier changes: tier 6, pinned, holds every Filler variant (Requirement 18); tier 7, not pinned, holds the Fixed_Phrases added by this spec and every Profile_Topic answer of the Shop with no day in it (address, catalog, prices and durations, FAQ answers). Both are built for each language with a chosen voice.
3. THE new tiers SHALL fit the Voice_Cache budget of natural-voice; IF they do not, THEN the task SHALL say so with the numbers and ask before trimming. Tier 6 SHALL never be trimmed below one Filler per kind and language.
4. Fixed_Phrases with Phrase_Variants SHALL use the Variant_Seed as before.

### Requirement 15: Tests that prove it

**User Story:** As a judge, I want to see the real failing call replayed and passing, and properties that would catch a regression.

#### Acceptance Criteria

1. THE Real_Call_2026_11_16 SHALL be a regression test on PGlite with the Rich_Profile, run once with a model that always answers Gemini's 503 "high demand", once with a model that hangs, and once with a 429: the first reply SHALL offer a Service_Combo of Corte de hombre and Degradado with its total duration and price and "¿Te viene bien el … a las …?"; then "sí", the name, the phone and "sí" SHALL book one row with the Combo_Id at the offered start, on one chair, ending 50 minutes later. No reply SHALL be the Fallback_Message and the Call SHALL stay open until the booking. Because every Turn of this call is a Sure_Reading, the model SHALL NOT be called in it; a fourth run with three unplaceable words added to the first utterance SHALL call the failing model and get the same first reply.
2. THE same call SHALL pass in English ("Hi Lola, I'd like a haircut and a fade").
3. EVERY property of design.md SHALL be one fast-check test with the stated `numRuns`; none SHALL be lowered to make it pass.
4. Tests that asserted the old end-on-model-failure behaviour (`tests/api/turn.failures.test.ts`, the `fallback` cases of `tests/api/turn.urgency.test.ts`, and the `invalid_output` retry cases) SHALL be rewritten to the new requirement, each keeping what it protected: a Message is still written once per Call with `model_failed`, the urgency is still decided by the Urgency_Rules, and the log line is still written without secrets. The `fallback` outcome SHALL still be tested through the per-visitor rate limit. Each rewrite SHALL be listed in tasks.md with the old and the new assertion.
5. Each new rule SHALL be broken on purpose at least once (mutation proof), and the property or test that caught it SHALL be recorded in design.md and `NOTAS-KIRO.md`.

### Requirement 16: Working beside the other specs

**User Story:** As the builder, I want this spec to land without breaking what is done.

#### Acceptance Criteria

1. THE files in `.kiro/specs/owner-machine/` SHALL NOT be changed, and every owner-machine test SHALL still pass, except the urgency tests that Requirement 16.5 extends. Changes to owner-side code are limited to naming a Service_Combo (`serviceName`, the Agenda's labels) and to 16.5, and each SHALL keep its owner-machine requirement.
2. Tests that pin texts or counts of the three-service profile SHALL use the V1_Profile (they already do in `tests/fixtures/lola.ts`). Tests in `tests/owner/demo*.test.ts` that pin the seed's catalog texts SHALL switch to the V1_Profile with the same assertions, and new tests SHALL pin the Rich_Profile's own texts.
3. WHERE a jury-polish task edits a file this spec also edits (`cachePlan.ts`, `fallbackLog.ts`, `phrases.ts`, `app/api/turn/handler.ts`), THE task SHALL re-read the file as it is first, and stop and ask if another session is changing it.
4. THE suggested reply's language fix (jury-polish, reviewer defect of 2026-11-16) SHALL apply to the Messages of brain Turns too; this spec SHALL NOT duplicate it.
5. *(Reviewer's answer 5, 2026-11-16.)* THE Sector_Pack vocabulary SHALL accept an optional `notUrgent` list per language (Not_Urgent_Phrases). THE Urgency_Rules (`lib/messages/urgency.ts`, `terms.ts`) SHALL ignore an urgent term only where it lies inside a Not_Urgent_Phrase of any pack language in the same Caller line; the same term elsewhere in that line or in another line SHALL still count. The hair-salon pack SHALL list "prueba de alergia", "test de alergia", "prueba del tinte" and "allergy test", "patch test". "¿Hacéis la prueba de alergia?" SHALL NOT be urgent by rule; "me ha dado alergia el tinte", "me pica" and "he tenido una reacción" SHALL stay urgent, also when the same line names the allergy test. A regression test SHALL pin both, and owner-machine's M1–M3 SHALL keep their assertions, with the oracle and the generators extended to the new rule (no `numRuns` lowered).

### Requirement 17 (L1): The app decides the end of speech

**User Story:** As a Caller, I want the receptionist to notice that I have finished as soon as I stop, so that I do not wait for the browser to make up its mind.

#### Acceptance Criteria

1. WHILE listening, THE speech port SHALL end the caller's Turn when `endOfSpeechMs` has passed since the last interim or final result with no new result (the Silence_Cut), and SHALL send the text heard so far (the final parts plus the latest interim) as the utterance. It SHALL NOT wait for Chrome's own end of recognition.
2. `endOfSpeechMs` SHALL default to 600 ms and SHALL be configurable per Shop by an optional Shop_Profile field (`voice.endOfSpeechMs`, an integer from 300 to 1500, zod-validated), passed to the Call_Page with the public shop data.
3. WHEN a result arrives for the same recognition after the Silence_Cut, THE port SHALL merge it and SHALL NOT send a second Turn for it: the caller's Transcript line SHALL show the final text; IF the final text has words after the words already sent, THEN those words SHALL be kept and put in front of the caller's next utterance, so nothing the caller said is lost and nothing is sent twice.
4. WHEN a recognition ends with no interim result at all (some Android builds), THE port SHALL send Chrome's final result as today.
5. THE Silence_Cut SHALL stop recognition with `stop()` (so a final result can still arrive), not `abort()`, and recognition for the next Turn SHALL start only after the reply has been spoken (core-call-loop 2.9 keeps holding).
6. THE Silence_Cut logic SHALL be a pure reducer in `lib/voice/`, tested with fake timers (Property B16).

### Requirement 18 (L2): Something human within one second

**User Story:** As a Caller, I want to hear the receptionist react right after I speak, so that I know she heard me.

#### Acceptance Criteria

1. WHEN the reply is not Reply_Audible `fillerAfterMs` (700 ms) after End_Of_Speech, THE Call_Page SHALL play one Filler, and the Filler SHALL be audible at most 1000 ms after End_Of_Speech.
2. WHEN the reply is Reply_Audible within 700 ms of End_Of_Speech, no Filler SHALL be played in that Turn.
3. THE Filler SHALL be chosen by code from the caller's utterance with the Code_Brain's lexicon (pure, safe to import in the browser), by kind: `check` ("A ver, déjame que mire…" / "Let me check…") for a booking, day or time; `answer` ("Vale, mira…" / "Okay, so…") for a question; `wait` ("Mm, un segundito…" / "Just a second…") for anything else. Each kind SHALL have at least 2 variants per language.
4. THE same Filler variant SHALL never be played in two consecutive Turns of a Call, and at most one Filler SHALL be played per Turn.
5. Every Filler SHALL be a pinned line of the Voice_Cache (Cache_Plan tier 6), and THE Call_Page SHALL fetch every Filler of the Call's language when the Call starts (after the call button's gesture), and those of the other language when the caller switches. A Filler that is not loaded SHALL be skipped, never played late.
6. THE reply SHALL start only after the Filler has ended, with no gap longer than 150 ms between them, and SHALL never overlap it. A Filler SHALL be at most 900 ms of audio at the shop's speech rate, which the cache build checks.
7. A Filler SHALL never be shown in the Transcript and never be sent to the server as part of the conversation.
8. IN Typed_Mode, and when the browser voice speaks the Call (no neural voice), THE Call_Page SHALL play no Filler.

### Requirement 19 (L3): The code brain answers first

**User Story:** As a Caller, I want the everyday steps of a booking to be answered at once, so that only real questions take a moment.

#### Acceptance Criteria

1. THE Code_Brain's Reading and `decideTurn` together SHALL take under 50 ms of compute on the server for every Turn, measured in a unit test with an in-memory repository over the test pools (database round trips are measured separately by the Latency_Script, 22.2).
2. A Reading SHALL be a Sure_Reading when the code can answer it completely: a yes or a no while a read-back, a First_Offer or a Service_Choice waits; a name or a phone while that field is the next one asked for; a day, a time or both while the booking flow waits for them; a Service_Request in a booking utterance; a Profile_Topic hit; an Owner_Request; a Sensitive_Hit; a language switch; a goodbye or thanks with nothing else. In each case, no more than 2 normalized words SHALL be left unplaced, ignoring greetings, the owner's name and filler words of the lexicon ("pues", "vale", "oye", "mira", "well", "so").
3. Every other Reading (a question with no Profile_Topic, free conversation, unknown intent, more than 2 unplaced words) SHALL call the model, with the Model_Wait of 1600 ms.
4. THE Turn_API response SHALL carry a `Server-Timing` header with the stages `brain`, `db`, `model` (0 when skipped) and `total`, in milliseconds, so the Latency_Script can measure them; it SHALL contain no words.
5. ON the deployed demo, a Sure_Reading Turn SHALL have server time p90 at most 400 ms, database round trips included, measured by the Latency_Script.

### Requirement 20 (L4): One round trip

**User Story:** As a Caller, I want the reply's voice to start with no second wait.

#### Acceptance Criteria

1. WHEN the Call_Page asks for Inline_Audio (`audio: "inline"` in the `say` request), THE Turn_API SHALL answer with a stream: first one line of JSON with the TurnResponse (reply text, speech hint), then one line of JSON with the audio header (`{"audio":"pcm","sampleRate":N}`, `{"audio":"cached","url":…}` or `{"audio":"none","fallback":…}`), then, for `pcm`, the raw PCM of the same reply. Requests without `audio: "inline"` SHALL get today's JSON response, unchanged.
2. THE live audio SHALL be produced by the same code as `POST /api/speech` (token rules, TTS limits, model order with 429 marking, the voice cache write), moved to one shared function, so both paths behave the same.
3. THE Call_Page SHALL show the reply text as soon as the first line arrives, and SHALL start playback from the same response.
4. `POST /api/speech` SHALL stay: WHEN the Inline_Audio header says `none` with `unavailable`, or the stream ends before any audio, and less than `TTS_DEADLINE_MS` has passed, THE Call_Page SHALL try once more with `/api/speech` and the token of the first line; after that, the browser voice speaks, as today.
5. THE stream format SHALL be a pure encoder and decoder in `lib/voice/`, whose decoder reads any split of the bytes into chunks the same way (Property B18).

### Requirement 21 (L5): A shorter start buffer

**User Story:** As a Caller, I want the voice to start as soon as there is enough sound to play smoothly.

#### Acceptance Criteria

1. THE Start_Buffer SHALL be 150 ms while the Call's live audio has had no underrun, and 300 ms for the rest of the Call after one underrun (the scheduled audio ran out before the stream ended).
2. THE voice decision SHALL count underruns per reply and report the count; every rule of natural-voice's N12 SHALL keep holding with both buffer sizes.
3. THE Latency_Script and the Timing_Panel SHALL record underruns per reply, so stalls can be compared before and after the change (22.3).

### Requirement 22 (L6): Measured targets

**User Story:** As the Owner, I want numbers from the real deployed demo, not promises.

#### Acceptance Criteria

1. ON the deployed demo, measured with the Timing_Panel over at least 20 voice Turns in Chrome: a Filler or the reply SHALL be audible p90 ≤ 1.0 s after End_Of_Speech; the reply audio SHALL start p50 ≤ 1.5 s and p90 ≤ 2.5 s after End_Of_Speech.
2. THE Latency_Script SHALL drive scripted Turns (Sure_Readings and model Turns, in Spanish and English) against a base URL and print p50 and p90 for: server stages (`Server-Timing`), time to the reply text, time to the first audio byte, and time to the first 150 ms of audio. It SHALL refuse a remote base without `--allow-remote`, state the number of model and TTS requests before it runs, and write its output to `.measurements/latency/`.
3. THE before numbers SHALL be taken on the deployed demo before any Latency change is deployed, and the after numbers once all are deployed, with the same script and the same scripted Turns; both SHALL be recorded in `NOTAS-KIRO.md`, with underruns per reply.
4. A timing test harness (fake clock, fake speech port, fake Turn_API and fake audio) SHALL check the browser's part of the targets in tests: for scripted server and audio delays, the Filler and the reply start at the times Requirements 17, 18 and 21 say (Property B17 and unit tests).
5. THE Timing_Panel SHALL hold durations only (no utterance, reply, name or phone), and SHALL be off unless `?timing=1` is in the Call_Page URL.
6. IF a target is missed after the change, THEN the numbers SHALL be recorded as they are, with the slowest stage named; the target SHALL NOT be redefined to pass.
