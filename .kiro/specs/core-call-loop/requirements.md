# Requirements Document

## Introduction

Phantom Line is the complete front desk of a small business. Today it answers missed calls by voice; tomorrow the same conversation core will also serve WhatsApp and web chat. Every channel leaves its message on the same tape and books into the same agenda. This feature, the **core call loop**, implements the voice channel end to end: a caller opens a web page, presses one button, speaks naturally, and the receptionist replies by voice while a live transcript scrolls. The server builds each reply from the shop's own information using Gemini, enforces booking rules in pure TypeScript (the model proposes, the code decides), and at the end of the call leaves the owner a structured message. The conversation core is channel-agnostic: one function handles a turn for any channel; `/api/turn` is the voice adapter. The whole loop must work in Chrome in Spanish and English, must never confirm a booking outside opening hours or in the past, and must degrade gracefully when the AI fails.

## Glossary

- **Phantom_Line**: The application as a whole — the complete front desk of a small business, not only a voice agent.
- **Channel**: The medium through which a Caller reaches the Receptionist (browser voice now, WhatsApp and web chat planned).
- **Conversation_Core**: The channel-agnostic server function that processes a Turn for any Channel and returns a reply plus Structured_State.
- **Call_Page**: The caller-facing web page served at `/call/[shopId]`.
- **Turn_API**: The `POST /api/turn` server endpoint — the voice Channel adapter that wraps the Conversation_Core.
- **Receptionist**: The server-side logic that builds the prompt from the Shop_Profile, calls the Gemini_API, validates the output, and produces the reply and Structured_State.
- **Gemini_API**: Google Gemini Flash model, called only from server routes.
- **Booking_Rules**: The pure TypeScript functions in `lib/booking/` that decide whether a Requested_Time is valid, with no I/O. Existing bookings are passed as a parameter so overlap can be checked without I/O inside the function.
- **Call_End_Handler**: The logic that persists a finished Call and creates a Message for the owner.
- **Seed_Script**: The script that inserts the demo Shop and Shop_Profile into the database.
- **Speech_Recognition**: The browser's Web Speech `SpeechRecognition` API used to transcribe the Caller's voice.
- **Speech_Synthesis**: The browser's Web Speech `speechSynthesis` API used to speak the Receptionist's reply.
- **Shop**: A registered local business.
- **Shop_Profile**: The Shop's name, owner name, address, Time_Zone, Opening_Hours, Sector_Pack, and the list of Services with durations and prices.
- **Time_Zone**: The IANA time zone of a Shop (e.g., `Europe/Madrid`). All Opening_Hours evaluation happens in this zone, never the server's.
- **Sector_Pack**: A plain typed configuration describing a business sector: what a Resource is, which fields a Booking needs, and sector-specific rules. New sectors require only a new config, no code.
- **Resource**: The bookable unit in a sector (e.g., chair, therapist, table, oven slot). Each Shop_Profile lists its Resources; Peluquería Lola has 2 chairs. A Booking occupies exactly one Resource.
- **Typed_Mode**: The Call_Page mode in which the Caller types each line into a text field instead of speaking. Typed lines go to the same Turn_API as spoken ones.
- **Visitor**: One browser client of the Call_Page, identified for rate limiting by the client IP address reported by the hosting platform.
- **Rate_Limit**: The configurable caps on Turns: a per-Visitor cap per minute and a global cap per hour for the whole application.
- **Caller**: A customer who calls the Shop.
- **Owner**: The person who runs the Shop and receives Messages.
- **Call**: One conversation session between a Caller and the Receptionist.
- **Turn**: One exchange: a Caller utterance plus the Receptionist's reply.
- **Intent**: The classification of the Caller's goal for a Turn: `booking`, `reschedule`, `cancel`, `question`, `order`, or `other`.
- **Booking**: An appointment for a Service on a Resource at a Requested_Time.
- **Existing_Booking**: A confirmed, not cancelled Booking for the Shop. The Booking_Rules receive all of the Shop's Existing_Bookings to check which Resources are busy; reschedule and cancel look up the Caller's own Existing_Booking through the Booking_Match.
- **Booking_Match**: The check that an Existing_Booking belongs to the Caller: the Caller's phone number equals the Booking's phone number (both normalized to E.164) AND the Caller's name equals the Booking's customer name, compared case-insensitively and accent-insensitively after trimming and collapsing spaces.
- **Message**: The record left for the Owner at the end of a Call: caller name, phone, reason, Urgency, what was agreed, and a suggested reply.
- **Urgency**: One of `low`, `normal`, or `urgent`.
- **Opening_Hours**: The days and time ranges a Shop is open, expressed as day-of-week plus start and end times; a Shop may have more than one session per day. All times are in the Shop's Time_Zone.
- **Service**: A service a Shop offers, with a duration in minutes and a price.
- **Requested_Time**: A date and start time the Caller asks to book, reschedule, or cancel a Service. Evaluated in the Shop's Time_Zone.
- **Structured_State**: The JSON returned by the Conversation_Core: the Intent, the collected fields (name, phone, service, Requested_Time), and a boolean indicating whether the Call is complete.
- **Fallback_Message**: The reply spoken when the Gemini_API fails, times out, or reports that its quota is exceeded, or when a Rate_Limit is exceeded.

## Requirements

### Requirement 1: Call Page UI

**User Story:** As a Caller, I want a single screen with one big button to start talking, so that I can reach the shop without knowing how to use an app.

#### Acceptance Criteria

1. WHEN a Caller opens `/call/[shopId]`, THE Call_Page SHALL display the Shop name and a single "Call" button as the only primary call-to-action, centered horizontally on the page.
2. THE Call_Page SHALL render the "Call" button as the gold pill described in the Marfil & Oro design (gold gradient, ink text, arrow).
3. THE Call_Page SHALL apply the Marfil & Oro visual tokens (ivory background, gold accents, ink headings, and body text with a contrast ratio of at least 4.5:1 against its background).
4. THE Call_Page SHALL display a visible ES / EN language switch that defaults to the browser's language, so the Caller can choose the conversation language before and during the Call.
5. WHILE the Call is in progress, THE Call_Page SHALL display a transcript in which each completed Turn — the Caller utterance followed by the Receptionist's reply — appears in chronological order.
6. THE Call_Page SHALL keep all content, the "Call" button, and the language switch visible and functional without horizontal scrolling at a 360px-wide viewport.
7. WHERE the user's browser supports visible keyboard focus, THE Call_Page SHALL show a gold focus ring on every interactive control.
8. WHILE `prefers-reduced-motion` is set, THE Call_Page SHALL disable all animated transitions, fade effects, and decorative motion so that all content remains fully visible without animation.
9. IF the shopId does not correspond to an existing Shop, THEN THE Call_Page SHALL display a message indicating the shop was not found and SHALL not display a "Call" button.

### Requirement 2: Speech Recognition and Synthesis

**User Story:** As a Caller, I want to speak and hear the receptionist reply, so that I can have a hands-free conversation.

#### Acceptance Criteria

1. WHEN the Caller presses the "Call" button, THE Call_Page SHALL start Speech_Recognition in the language selected on the ES / EN switch.
2. WHEN Speech_Recognition produces a final Caller utterance, THE Call_Page SHALL send the utterance, the conversation so far, the shopId, and the selected language to the Turn_API.
3. WHEN the Turn_API returns a reply, THE Call_Page SHALL speak the reply using Speech_Synthesis in the selected language.
4. THE Call_Page SHALL support Speech_Recognition and Speech_Synthesis for the `es-ES` and `en-US` locales.
5. WHILE the selected language is Spanish, THE Call_Page SHALL use a Spanish voice for Speech_Synthesis.
6. WHILE the selected language is English, THE Call_Page SHALL use an English voice for Speech_Synthesis.
7. WHEN the Caller asks to switch language during the Call, THE Call_Page SHALL update the language switch, restart Speech_Recognition in the new language, and send the new language to the Turn_API on the next Turn.
8. IF Speech_Recognition or Speech_Synthesis is unavailable in the browser, or the Caller denies microphone access, THEN THE Call_Page SHALL continue the Call in Typed_Mode: a text field sends each line to the same Turn_API, and the reply is shown in the transcript and, WHERE Speech_Synthesis is available, also spoken.
9. WHEN Speech_Synthesis finishes speaking the Receptionist's reply, THE Call_Page SHALL restart Speech_Recognition so the Caller may continue the conversation.
10. IF the Turn_API does not respond within 15 seconds, THEN THE Call_Page SHALL display an error message to the Caller and stop the Call.
11. THE Call_Page SHALL always display a visible "type instead" control, also in browsers where voice works, that switches the Call to Typed_Mode without ending it.
12. THE Call_Page SHALL never end a Call because a browser speech capability is missing, denied, or failing.

### Requirement 3: Turn API Endpoint

**User Story:** As a developer, I want a single endpoint that takes the conversation and returns the next line and state, so that the call loop is one simple request per Turn.

#### Acceptance Criteria

1. WHEN a `POST /api/turn` request is received, THE Turn_API SHALL validate the request body with zod before processing.
2. THE Turn_API SHALL accept the shopId (max 100 characters), the Caller's latest utterance (max 500 characters), the conversation so far (max 20 Turns), and the selected language.
3. IF the utterance exceeds 500 characters or the conversation exceeds 20 Turns, THEN THE Turn_API SHALL return a 400 status.
4. WHEN the request is valid, THE Turn_API SHALL delegate to the Conversation_Core and return the Receptionist's next line plus the Structured_State.
5. THE Structured_State SHALL contain the Intent, the collected fields (name, phone, service, Requested_Time), and a boolean indicating whether the Call is complete.
6. THE Intent SHALL be one of `booking`, `reschedule`, `cancel`, `question`, `order`, or `other`.
7. IF the request body fails zod validation, THEN THE Turn_API SHALL return a 400 status and an error message indicating which field(s) failed validation.
8. IF the shopId does not correspond to an existing Shop in the database, THEN THE Turn_API SHALL return an error response indicating the Shop was not found.
9. THE Turn_API SHALL limit each Visitor to 12 Turns per minute and the whole application to a global number of Turns per hour. Both limits SHALL be configurable without code changes.
10. IF a Turn exceeds a Rate_Limit, THEN THE Turn_API SHALL return the Fallback_Message and save a Message for the Owner, following the same path as a Gemini_API timeout. THE Call_Page SHALL never show an error screen in this case.
11. THE Turn_API SHALL NOT trust collected fields, booking decisions, or an "accepted" flag sent by the browser. Requests that contain such fields SHALL fail validation.

### Requirement 4: Receptionist and Gemini Integration

**User Story:** As a developer, I want the Receptionist to reply from the shop's own information only, so that Callers never hear invented facts.

#### Acceptance Criteria

1. THE Receptionist SHALL call the Gemini_API only from server routes.
2. THE Receptionist SHALL keep the Gemini_API key server-side only.
3. WHEN building a reply, THE Receptionist SHALL construct the prompt from the Shop_Profile (name, owner name, address, Time_Zone, Opening_Hours, and Services with durations and prices) and SHALL include today's date and weekday in the Shop's Time_Zone so relative expressions like "tomorrow at five" resolve correctly.
4. THE Receptionist SHALL validate the Gemini_API output with zod before using it.
5. WHEN the Gemini_API returns valid output, THE Receptionist SHALL return the next line and the Structured_State.
6. IF the Gemini_API returns output that fails zod validation, THEN THE Receptionist SHALL speak the Fallback_Message and continue the Call so the Caller may speak again.
7. IF the Gemini_API call fails, answers that its quota is exceeded, or does not return within 8 seconds, THEN THE Receptionist SHALL return the Fallback_Message indicating that a Message will be taken for the Owner, and signal that the Call should end with a Message saved.
8. WHEN a Call begins, THE Receptionist SHALL greet the Caller using the Shop name.
9. THE Receptionist SHALL reply in the language indicated by the Call_Page's language selection.
10. WHEN the Caller asks to switch language during the Call, THE Receptionist SHALL reply in the newly selected language for all subsequent Turns.
11. THE Receptionist SHALL speak one or two sentences per Turn, each at most 25 words, with no lists, emojis, or markdown.
12. WHEN the Intent is a booking, THE Receptionist SHALL ask for one field at a time: what the Caller needs, then when, then name, then phone.
13. WHEN the Receptionist is about to confirm a Booking, THE Receptionist SHALL repeat back the day, time, and Service to the Caller.
14. WHEN the Caller asks something not in the Shop_Profile, THE Receptionist SHALL say so and offer to take a Message.
15. WHEN a Call ends, THE Receptionist SHALL tell the Caller what happens next.
16. WHEN the Intent is a reschedule, THE Receptionist SHALL look up the Caller's Existing_Booking with the Booking_Match (phone and name), read back its details, ask for a new Requested_Time, and pass the new time to the Booking_Rules.
17. WHEN the Intent is a cancel, THE Receptionist SHALL look up the Caller's Existing_Booking with the Booking_Match (phone and name), read back its details, and ask the Caller to confirm the cancellation.

### Requirement 5: Booking Rules

**User Story:** As a developer, I want booking validation in pure TypeScript, so that the model can never confirm an invalid appointment and the rules are fully testable.

#### Acceptance Criteria

1. THE Booking_Rules SHALL be pure functions with no I/O. Existing bookings SHALL be passed as a parameter so overlap can be checked without I/O inside the function.
2. WHEN a Requested_Time is proposed for a Service, THE Booking_Rules SHALL accept the time only if the day is an open day, the start time falls inside an Opening_Hours session, and the Service duration fits before that session closes — all evaluated in the Shop's Time_Zone.
3. IF the Requested_Time is in the past relative to the current time in the Shop's Time_Zone, THEN THE Booking_Rules SHALL reject the Requested_Time.
4. IF, for every Resource of the Shop, the Requested_Time plus the Service duration overlaps an Existing_Booking on that Resource, THEN THE Booking_Rules SHALL reject the Requested_Time.
5. IF the Booking_Rules reject a Requested_Time, THEN THE Booking_Rules SHALL return up to 3 valid slots, searching both before and after the requested time and skipping slots that overlap Existing_Bookings, that the Booking_Rules would accept.
6. IF a Requested_Time falls outside Opening_Hours, THEN THE Booking_Rules SHALL reject the Requested_Time.
7. IF the Caller requests a Service the Shop does not offer, THEN THE Booking_Rules SHALL return a rejection indicating the Shop does not offer the requested Service.
8. WHEN the model proposes a Requested_Time, THE Receptionist SHALL pass the proposal to the Booking_Rules and use the Booking_Rules' decision.
9. WHEN a Call ends with a Booking, THE server SHALL re-validate the final Requested_Time and Service with the Booking_Rules before persisting the Booking, regardless of the conversation history sent by the browser. The browser sends the conversation, but THE server SHALL never trust collected fields or an "accepted" flag coming from the browser: before persisting a Booking, a reschedule, or a cancellation, it SHALL re-derive the fields on the server and re-run the Booking_Rules against the Existing_Bookings read from the database at that moment.
10. WHEN the Intent is a reschedule, THE Booking_Rules SHALL check the new Requested_Time using the same rules as a new Booking, and the old Booking SHALL be cancelled only after the new one is confirmed.
11. A Booking SHALL occupy exactly one Resource. Two Bookings MAY overlap in time only if they occupy different Resources.
12. WHEN the Booking_Rules accept a Requested_Time, THE Booking_Rules SHALL assign a free Resource to the Booking. THE Booking_Rules SHALL reject a Requested_Time for being busy only when every Resource of the Shop is busy at some point during the Service.
13. Bookings SHALL be stored in a `bookings` table.

### Requirement 6: Call End and Message Creation

**User Story:** As an Owner, I want a clear message after every call, so that I can understand what happened in under 10 seconds.

#### Acceptance Criteria

1. WHEN the Call is complete, THE Call_End_Handler SHALL save the Call record.
2. WHEN the Call is complete, THE Call_End_Handler SHALL create and save a Message for the Owner containing the caller name, phone, reason, Urgency, what was agreed, and a suggested reply.
3. THE Urgency SHALL be one of `low`, `normal`, or `urgent`.
4. IF the Gemini_API failed, timed out, or was over quota during the Call, or a Rate_Limit was exceeded, THEN THE Call_End_Handler SHALL save a Message for the Owner that contains the fields collected from the Caller before the failure and an indication that the Gemini_API failed.
5. THE only personal data collected about the Caller SHALL be the Caller's name and phone.
6. WHEN the Caller ends the Call before it is complete, THE Call_End_Handler SHALL save a Message for the Owner containing the caller fields collected before the Call ended.

### Requirement 7: Demo Shop Seeding

**User Story:** As a demo operator, I want one seeded shop, so that I can show a full booking call end to end.

#### Acceptance Criteria

1. THE Seed_Script SHALL create exactly one demo Shop named "Peluquería Lola".
2. THE demo Shop SHALL have Opening_Hours of Tuesday through Saturday, 10:00–14:00 and 17:00–20:00.
3. THE demo Shop SHALL offer the Services: haircut 30 min 15 €, colour 90 min 45 €, beard 20 min 10 €.
4. THE demo Shop SHALL have owner name "Lola", address "Calle Mayor 12, Madrid", and Time_Zone "Europe/Madrid" in its Shop_Profile.
5. THE demo Shop SHALL use the hair-salon Sector_Pack.
6. IF a demo Shop named "Peluquería Lola" already exists, THEN THE Seed_Script SHALL not create a duplicate.
7. THE demo Shop SHALL have 2 chairs as its Resources.

### Requirement 8: End-to-End Call and Error Behavior

**User Story:** As a Caller, I want the call to keep working even when something goes wrong, so that I am never left in silence.

#### Acceptance Criteria

1. WHEN a full booking Call is performed in Chrome, THE Call_Page and Turn_API SHALL complete a Booking in Spanish and in English, WHERE completion is indicated by the Receptionist confirming the day, time, and Service to the Caller and the Structured_State marking the Call as complete.
2. IF the Gemini_API fails or does not respond within 8 seconds, THEN THE Receptionist SHALL speak the Fallback_Message to the Caller.
3. IF the Gemini_API fails or does not respond within 8 seconds, THEN THE Call_End_Handler SHALL save a Message so the Owner has a record.
4. THE build SHALL exclude the Gemini_API key from any client-side bundle or browser response.
5. IF the Caller asks something not in the Shop_Profile, THEN THE Receptionist SHALL take a Message instead of inventing information.

### Requirement 9: Booking Rule Correctness Properties

**User Story:** As a developer, I want property-based tests over random dates and times, so that I can prove a booking is never confirmed outside opening hours.

#### Acceptance Criteria

1. WHEN a Requested_Time falls outside Opening_Hours, THE Booking_Rules SHALL reject the Requested_Time.
2. WHEN a Requested_Time falls on a day-of-week not listed in Opening_Hours, THE Booking_Rules SHALL reject the Requested_Time.
3. WHEN the Booking_Rules accept a Requested_Time for a Service, THE Booking_Rules SHALL guarantee that the Service end time (the Requested_Time plus the Service duration) falls on or before the closing time of the session the Requested_Time falls within.
4. WHERE the Shop has at least one Opening_Hours session per week, IF the Booking_Rules reject a Requested_Time, THEN THE Booking_Rules SHALL return at least one valid slot (a slot the Booking_Rules would accept) whose start time has the smallest absolute time difference from the Requested_Time, searching within 14 days before and after the Requested_Time (never before the current time) and skipping slots where every Resource is busy. Offered slots SHALL start on the Sector_Pack's slot grid: every `slotStepMin` minutes from the opening of each session, which is 15 minutes for the hair-salon Sector_Pack (10:00, 10:15, 10:30 …). "Smallest absolute time difference" is measured among grid slots. A Requested_Time off the grid is still accepted when it is valid; the grid applies only to the slots offered as alternatives.
5. WHEN a Requested_Time is in the past relative to the current time in the Shop's Time_Zone, THE Booking_Rules SHALL reject the Requested_Time.
6. WHEN, on every Resource of the Shop, a Requested_Time plus the Service duration overlaps an Existing_Booking, THE Booking_Rules SHALL reject the Requested_Time.
7. WHEN a Booking is accepted and the Booking_Rules are applied again to the same Requested_Time and Service, THE Booking_Rules SHALL return the same accept verdict as the first application.
8. WHERE property-based tests are run against the Booking_Rules, THE tests SHALL generate at least 100 random Requested_Times whose dates span at least 7 consecutive days and whose times are at minute granularity, and every other acceptance criterion of this requirement SHALL be verified for each generated Requested_Time to which it applies.
9. FOR ALL sequences of Bookings accepted by the Booking_Rules, no two accepted Bookings SHALL share a Resource and overlap in time.

### Requirement 10: Channel-Agnostic Conversation Core

**User Story:** As a developer, I want one conversation function that works for any channel, so that voice, WhatsApp, and web chat all share the same booking logic and message tape.

#### Acceptance Criteria

1. THE Conversation_Core SHALL be a single server function that takes a Caller utterance, the conversation so far, the Shop_Profile, the selected language, and the Channel, and returns a reply plus Structured_State.
2. THE Turn_API SHALL be the voice Channel adapter that calls the Conversation_Core and is the only entry point for the Call_Page.
3. WHEN a new Channel is added, THE Channel adapter SHALL call the same Conversation_Core so that booking logic, Booking_Rules, and message creation are shared across all Channels.
4. WHEN a Call ends on any Channel, THE Call_End_Handler SHALL save the Message to the same tape as every other Channel.
5. WHEN a Booking is made on any Channel, THE Booking SHALL be saved to the same agenda as every other Channel.

### Requirement 11: Sector Packs

**User Story:** As a developer, I want shops configured by sector packs, so that new business types need only a config file, not new code.

#### Acceptance Criteria

1. THE Sector_Pack SHALL be a plain typed configuration that defines what a Resource is, which fields a Booking requires, and any sector-specific rules.
2. THE Shop_Profile SHALL reference exactly one Sector_Pack.
3. WHEN a new sector is added, THE Sector_Pack SHALL be a new config file with no new code required for booking logic.
4. THE hair-salon Sector_Pack SHALL define a Resource as a chair and Booking fields as caller name, phone, service, and Requested_Time.
5. THE Booking_Rules SHALL use the Sector_Pack to determine which fields a Booking needs and how Resources are allocated.

### Requirement 12: Reschedule and Cancel

**User Story:** As a Caller, I want to reschedule or cancel my booking, so that I don't need to call the shop directly.

#### Acceptance Criteria

1. WHEN the Caller's Intent is a reschedule or a cancel, THE Receptionist SHALL ask for the Caller's phone number and name and identify the Caller's Existing_Booking with the Booking_Match: both the phone and the name must match, the name compared case-insensitively and accent-insensitively ("maria jose" matches "María José").
2. WHEN an Existing_Booking passes the Booking_Match, THE Receptionist SHALL read back its day, time, and Service to the Caller. THE Receptionist SHALL never read back any detail of a Booking that does not pass the Booking_Match.
3. WHEN the Caller proposes a new Requested_Time, THE Receptionist SHALL pass it to the Booking_Rules using the same rules as a new Booking.
4. WHEN the new Requested_Time is accepted, THE Receptionist SHALL confirm the rescheduled Booking with the Caller and the old Booking SHALL be replaced.
5. WHEN the Caller's Intent is a cancel and an Existing_Booking passes the Booking_Match, THE Receptionist SHALL read back its details and ask the Caller to confirm the cancellation.
6. WHEN the Caller confirms the cancellation, THE Booking SHALL be marked as cancelled.
7. IF no Existing_Booking passes the Booking_Match (no Booking for that phone, or the name does not match), THEN THE Receptionist SHALL say it cannot find the Booking and offer to take a Message. The reply SHALL be the same in both cases, so it does not reveal whether a Booking exists for that phone.
