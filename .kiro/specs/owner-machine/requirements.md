# Requirements Document

## Introduction

The **owner machine** is the Owner's side of Phantom Line: one answering-machine screen at `/machine/[shopId]` that holds the Tape (every Message from every Channel) and the Agenda (today and the next 7 days). It is the second spec. The first spec, `core-call-loop`, already stores Calls with their transcripts, Bookings with a no-overlap constraint, and one Message per Call in the `calls`, `bookings` and `messages` tables. This spec reads those tables, adds what the Owner needs to act on them, and changes how a Message's Urgency is decided.

Six rules shape it:

1. **The code decides, the model suggests.** The Urgency the model gives during a Call is only a suggestion. Pure TypeScript rules, with keywords per language kept in each Sector_Pack, decide the final Urgency, and it is never lower than the rules say.
2. **The owner goes through the same rules as a caller.** Moving a Booking from the Agenda can only pick a slot the Booking_Rules accept, and the write goes through the same database constraint as a caller's Booking.
3. **Nothing personal without the PIN.** The Machine_Page shows no caller data until the Owner_PIN is checked on the server. The PIN is stored hashed and its attempts are rate-limited. The demo shop's PIN is printed on the landing page so a jury can get in without an account.
4. **Every owner action leaves a record.** Confirm, move, cancel and erase are recorded with who and when, in the same atomic write as the change.
5. **The tape is the transcript.** No audio is ever recorded or stored.
6. **The public demo forgets; real shops keep everything.** Judging runs from mid December to late January, so a judge may open the demo weeks after it was recorded. Only for the Demo_Shop, old Messages leave the Tape after 24 hours, Calls and Messages are deleted after 7 days, and a nearly empty Tape is refilled with 3 fixed Sample_Messages, so a judge never finds an empty machine. Nothing is erased or deleted automatically for any other Shop.

Review decisions of 2026-11-13 are recorded at the end of `design.md`.

Out of scope: the WhatsApp and web-chat adapters (their Messages and Bookings will appear here through the same tables), sending replies from the machine (COPY REPLY copies the text; sending is the owner's own app), editing the Shop_Profile, multiple staff accounts, and the table and order units of the restaurant and bakery packs (the Agenda shows them once the sector-packs spec stores them).

## Glossary

Terms already defined in `core-call-loop/requirements.md` keep their meaning: Phantom_Line, Channel, Conversation_Core, Call_Page, Turn_API, Receptionist, Gemini_API, Booking_Rules, Call_End_Handler, Seed_Script, Shop, Shop_Profile, Time_Zone, Sector_Pack, Resource, Visitor, Rate_Limit, Caller, Owner, Call, Turn, Intent, Booking, Existing_Booking, Message, Urgency, Opening_Hours, Service, Requested_Time, Structured_State, Fallback_Message. New terms:

- **Owner_Machine**: The Owner's side of Phantom_Line as a whole: the Machine_Page, the Machine_API and the logic behind them.
- **Machine_Page**: The Owner-facing web page served at `/machine/[shopId]`. It contains the PIN_Gate or, after a valid Owner_Session, the Tape and the Agenda.
- **Machine_API**: The server endpoints the Machine_Page calls: PIN login and logout, the Poll, the slot list for a move, and the Owner_Actions. Every one of them except login checks the Owner_Session on the server.
- **Landing_Page**: The page served at `/`.
- **Demo_Shop**: The Shop created by the Seed_Script (Peluquería Lola), with the id `peluqueria-lola`. Its Owner_PIN is public by design and is shown on the Landing_Page. Every other Shop is a Real_Shop.
- **Real_Shop**: Any Shop that is not the Demo_Shop.
- **Demo_Notice**: The short line "Demo: do not leave real personal data" / "Demo: no dejes datos personales reales", in the page's selected language.
- **Sample_Message**: One of 3 fixed, code-defined Messages for the Demo_Shop (one urgent, one booking, one question), each with its own short Call and Transcript, marked "Sample" / "Ejemplo" on the Tape.
- **Demo_Retention**: The sweep that applies Requirement 16 to the Demo_Shop only.
- **Agreed_Text**: The "what was agreed" line shown for a Message. For a Message with a Booking, it is rendered at read time from the Booking as it is now, in the Machine_Page's selected label language; for a Message without a Booking, it is the stored text.
- **Idle**: The Machine_Page state after 15 minutes with no pointer, touch or key input on the page and no new Message arriving.
- **Owner_PIN**: A per-Shop 6-digit code that opens the Machine_Page for that Shop. It is stored only as a salted hash.
- **PIN_Gate**: The part of the Machine_Page shown without a valid Owner_Session: the Shop name and a PIN form, and nothing else about the Shop's Calls, Messages or Bookings.
- **Owner_Session**: The server-signed proof, kept in an `HttpOnly` cookie, that someone entered the right Owner_PIN for one Shop. It expires, and it stops being valid when the Owner_PIN changes.
- **Actor**: Who did an Owner_Action: the Owner_Session's id plus the label the person typed at login (for example "Lola"). With one shared PIN per Shop, the label is a name the person gives, not a verified identity.
- **Owner_Action**: One of `confirm`, `move` or `cancel` on a Booking, or `play` or `erase` on a Message, done from the Machine_Page.
- **Audit_Record**: The stored record of one Owner_Action that changed something: the action, the Actor, the time, the Booking or Message, and the values before and after. It never contains a caller's name or phone.
- **Tape**: The list of New Messages of a Shop from every Channel, in Tape_Order, each with its transcript.
- **Transcript**: The ordered lines of a Call that the server itself handled (`calls.transcript`). It is text only; there is no audio anywhere.
- **New_Message**: A Message that has not been erased.
- **Unheard_Message**: A New_Message that has not been played on the Machine_Page yet.
- **Heard**: The state of a Message after PLAY showed it for the first time (`messages.read_at` set).
- **Erased**: The state of a Message after ERASE (mark as handled). It is permanent: an Erased Message is never a New_Message again.
- **Tape_Order**: Unheard_Messages before Heard ones; inside each group, `urgent` before `normal` before `low`; inside each Urgency, newest first.
- **Message_Light**: The terracotta light on the machine. It blinks while there is at least one Unheard_Message, stays lit while there are New_Messages but none is unheard, and is off when there are no New_Messages.
- **Counter**: The large number of New_Messages on the machine, with the label "new messages" / "mensajes nuevos".
- **Suggested_Urgency**: The Urgency the Gemini_API returned in the last valid Turn of a Call. A suggestion only.
- **Urgency_Terms**: Per Sector_Pack and per language, two lists of words and phrases in the pack's vocabulary: `urgent` terms (for example "urgente", "emergencia", "dolor", "emergency") and `today` terms (for example "hoy", "esta tarde", "today").
- **Urgency_Rules**: The pure TypeScript functions in `lib/messages/` that compute the Rule_Urgency of a Message from the Caller's lines, the Urgency_Terms, the Requested_Time or Booking day, the outcome of the Call, and the current day in the Shop's Time_Zone.
- **Rule_Urgency**: The lowest Urgency the Urgency_Rules allow for a Message.
- **Final_Urgency**: The Urgency stored on a Message and shown to the Owner: the higher of the Rule_Urgency and the Suggested_Urgency, in the order `low` < `normal` < `urgent`.
- **Agenda**: The list of the Shop's Bookings whose start falls on today or one of the next 7 days in the Shop's Time_Zone, grouped by local day.
- **Agenda_Status**: How a Booking is shown in the Agenda: `booked` (active, not yet confirmed by the Owner), `confirmed` (active and confirmed by the Owner), or `cancelled`. In the database an active Booking has `status = 'confirmed'`; the Owner's confirmation is a separate field, so the words differ on purpose.
- **Move_Slots**: For a Booking and a local day, the start times on the Sector_Pack's slot grid that the Booking_Rules accept for that Booking's Service, ignoring the Booking itself, computed on the server against the Existing_Bookings read at that moment.
- **Machine_Version**: A number per Shop that changes on every write to that Shop's Messages or Bookings. The Poll compares it to decide whether anything changed.
- **Poll**: The Machine_Page's request to the Machine_API with the Machine_Version it last saw: every 5 seconds, or every 30 seconds while Idle.
- **Current_Reply**: The suggested reply shown and copied for a Message. It is the stored suggested reply, or, when the Owner later moved or cancelled the Message's Booking, a reply rebuilt from the Booking as it is now.

## Requirements

### Requirement 1: Owner access with a per-shop PIN

**User Story:** As an Owner, I want my machine to open with a short PIN on my phone, so that I can check messages between customers without an account, and nobody else can read my callers' details.

#### Acceptance Criteria

1. WHEN a person opens `/machine/[shopId]` without a valid Owner_Session for that Shop, THE Machine_Page SHALL show the PIN_Gate: the Shop name, a 6-digit PIN field, an optional "Your name" field (up to 30 characters, default "Owner" / "Dueño"), and an "Open the machine" button.
2. THE PIN_Gate SHALL NOT show any Message, Booking, Call, Transcript, caller name, caller phone, Counter value, or Message_Light state.
3. WHEN the PIN form is submitted, THE Machine_API SHALL compare the PIN with the Shop's stored hash on the server, in constant time.
4. WHEN the PIN is correct, THE Machine_API SHALL set an Owner_Session cookie for that Shop that is `HttpOnly`, `Secure`, `SameSite=Strict`, scoped to the path `/`, and valid for 12 hours, and THE Machine_Page SHALL show the machine without a full page reload.
5. IF the PIN is wrong, THEN THE Machine_API SHALL answer with the same message for every wrong PIN ("That PIN doesn't open this machine"), and THE PIN_Gate SHALL keep the name the person typed and clear the PIN field.
6. IF the shopId does not correspond to an existing Shop, THEN THE Machine_Page SHALL show the same "shop not found" message as the Call_Page and no PIN form.
7. IF a Shop has no Owner_PIN set, THEN THE PIN_Gate SHALL say that the machine is not set up yet, and THE Machine_API SHALL reject every login for that Shop.
8. THE Machine_API SHALL check the Owner_Session on every request except login, and SHALL answer `401` with no Shop data when it is missing, expired, signed for another Shop, or issued before the Shop's Owner_PIN last changed.
9. THE Machine_Page SHALL offer a "Lock the machine" control that ends the Owner_Session and returns to the PIN_Gate.
10. THE Machine_API SHALL reject every state-changing request whose `Origin` header is missing or differs from the application's own origin.

### Requirement 2: PIN storage and attempt limits

**User Story:** As an Owner, I want my PIN to be impossible to guess quickly and never stored in plain text, so that a short code is still safe enough.

#### Acceptance Criteria

1. THE Owner_PIN SHALL be stored only as a salted scrypt hash with a random salt per Shop, in a column outside `shops.profile`, so it never reaches a prompt, the Call_Page, or any Machine_API response.
2. THE Machine_API SHALL limit PIN attempts to 5 per Visitor per Shop in each 15-minute window for every Shop, and, for a Real_Shop only, also to 30 per Shop in each hour. THE Demo_Shop SHALL have no shop-wide cap, because its PIN is public and a shop-wide cap would only let one person lock every judge out. Both limits SHALL be configurable without code changes.
3. IF a PIN attempt exceeds a limit, THEN THE Machine_API SHALL answer `429` with "Too many tries, wait a few minutes" without checking the PIN, and the attempt SHALL count anyway.
4. THE Machine_API SHALL count attempts in the existing `rate_limits` table, so the limits hold across server instances.
5. THE server log SHALL record each rejected or rate-limited PIN attempt as one JSON line with the Shop id, the reason and the window counts, and SHALL never record the PIN, the hash, the session token, the Visitor key, or the IP address.
6. THE Seed_Script SHALL set the Demo_Shop's Owner_PIN from the `DEMO_OWNER_PIN` environment variable, which must be exactly 6 digits; IF it is missing or malformed, THEN THE Seed_Script SHALL leave the Shop without a PIN and print that it did.

### Requirement 3: Demo access from the landing page

**User Story:** As a jury member, I want to see the owner's side without asking anyone for an account, so that I can judge the whole product in one sitting.

#### Acceptance Criteria

1. THE Landing_Page SHALL link to the Demo_Shop's Call_Page and Machine_Page (`/machine/peluqueria-lola`) and SHALL show the Demo_Shop's Owner_PIN next to the machine link.
2. THE Landing_Page SHALL show the Demo_Notice next to the PIN.
3. THE Call_Page and the Machine_Page (both the PIN_Gate and the machine) of the Demo_Shop SHALL show the Demo_Notice in the selected language, visible without scrolling at a 360 px-wide viewport, and THE Call_Page SHALL show it before the Call starts. THE pages of a Real_Shop SHALL NOT show it.
4. IF `DEMO_OWNER_PIN` is not set, THEN THE Landing_Page SHALL show the machine link without a PIN and SHALL NOT show any placeholder digits.

### Requirement 4: The Owner's Message after every conversation

**User Story:** As an Owner, I want one clear message per conversation from any channel, so that I understand what happened in under 10 seconds.

#### Acceptance Criteria

1. WHEN a Call ends on any Channel, by any path (completed, fallback, rate limit, hang-up, stale-call sweep, or booking conflict), THE Call_End_Handler SHALL store exactly one Message for that Call containing: caller name, phone, Channel, reason (one line), Final_Urgency, what was agreed, and a suggested reply, as in `core-call-loop` Requirement 6.
2. THE Message SHALL link to its Call, so the Machine_Page can show the Call's Transcript.
3. THE Message SHALL store the Suggested_Urgency and the Urgency_Rules' basis (which rule fired and which term matched, if any) next to the Final_Urgency, so the Owner can see why a Message is urgent.
4. THE Message's "what was agreed" and suggested reply SHALL be written by code from the outcome and the Booking, never by the model.
5. THE Owner_Machine SHALL NOT make an additional Gemini_API request to summarize a finished Call.
6. WHEN the Message's Booking was later moved or cancelled from the Machine_Page, THE Machine_Page SHALL show and copy the Current_Reply, which describes the Booking as it is now.
7. THE Machine_Page SHALL show the Agreed_Text: for a Message with a Booking, rendered at read time from the Booking as it is now (Service, local day and time, Resource, cancelled or not) in the selected label language, using the same code templates that wrote the stored text; for a Message without a Booking, the stored text. The reason SHALL always be shown as stored.

### Requirement 5: Urgency decided by code

**User Story:** As an Owner, I want urgent calls to stand out reliably, so that an allergic reaction or a same-day request never waits behind routine bookings because the model misjudged it.

#### Acceptance Criteria

1. THE Urgency_Rules SHALL be pure functions in `lib/messages/` with no I/O; the Caller's lines, the Sector_Pack, the Shop's Time_Zone, the current time, the outcome and the Suggested_Urgency SHALL be parameters.
2. THE Urgency_Terms SHALL live in each Sector_Pack's vocabulary, per language, and SHALL be validated with zod with every other part of the pack. THE Urgency_Rules SHALL NOT contain any term of their own.
3. WHEN any Caller line of the Call contains an `urgent` term of the Sector_Pack, in any of the pack's languages, THE Rule_Urgency SHALL be `urgent`.
4. WHEN any Caller line contains a `today` term, or the Requested_Time or the Booking of the Call falls on the current day in the Shop's Time_Zone, AND the Call did not end with a Booking created, rescheduled or cancelled, THE Rule_Urgency SHALL be `urgent`.
5. WHEN the condition of 5.4 about today holds AND the Call did end with a Booking created, rescheduled or cancelled, THE Rule_Urgency SHALL be at least `normal`.
6. WHEN the Gemini_API failed during the Call, THE Rule_Urgency SHALL be at least `normal`.
7. OTHERWISE THE Rule_Urgency SHALL be `low`.
8. THE Final_Urgency SHALL be the higher of the Rule_Urgency and the Suggested_Urgency. WHEN there is no Suggested_Urgency, THE Final_Urgency SHALL be the Rule_Urgency.
9. THE Urgency_Rules SHALL match terms case-insensitively and accent-insensitively, on whole words ("hoy" matches "Hoy," and "HOY" but not "hoyo"), and a term of several words SHALL match the same words in sequence with any spacing.
10. THE Urgency_Rules SHALL only read the Caller's lines, never the Receptionist's, so a templated question such as "¿A qué hora te viene bien hoy?" does not raise Urgency.
11. THE Urgency_Rules SHALL treat a negated term ("no es urgente") like any other match: a false "urgent" costs the Owner a look, a missed one costs a customer.
12. THE hair-salon Sector_Pack SHALL ship `urgent` and `today` terms in Spanish and English.

### Requirement 6: The machine screen

**User Story:** As an Owner, I want the screen to look and feel like my old answering machine, so that I know at a glance whether anyone called.

#### Acceptance Criteria

1. THE Machine_Page SHALL follow `.kiro/steering/design.md`: Marfil & Oro tokens from `app/globals.css`, Newsreader for headings, Inter for body text, Caveat for the suggested reply and the handwritten note, and no dark screen, purple, neon or emoji icons.
2. THE machine SHALL have an ivory body with a 28 px radius, gold hairline trim and a soft brown translucent shadow, two espresso tape reels with gold hubs, the Message_Light, and the Counter.
3. THE Counter SHALL show the number of New_Messages in Newsreader, with the number phrase in gold ("You have *3 new messages*"), and the singular for one ("1 new message").
4. THE Message_Light SHALL blink slowly, with an occasional irregular flicker, while there is at least one Unheard_Message; SHALL stay lit without blinking while there are New_Messages and none is unheard; and SHALL be off when there are no New_Messages.
5. THE tape reels SHALL rotate only while a Message is being played.
6. THE Machine_Page SHALL show the Tape and the Agenda as two views of the same machine, switched by two clearly labelled tabs, and SHALL remember the last view during the Owner_Session.
7. THE Machine_Page SHALL work without horizontal scrolling at a 360 px-wide viewport, with every control at least 44 × 44 CSS pixels.
8. THE Machine_Page SHALL show its labels in the Shop's first language, with an ES / EN switch for the labels. The reason and the Current_Reply SHALL be shown as stored or rebuilt in the Call's language; only the Agreed_Text follows the label language (4.7).

### Requirement 7: The tape

**User Story:** As an Owner, I want to play my messages one after another, urgent first, so that I can deal with them in the few minutes I have.

#### Acceptance Criteria

1. THE Tape SHALL list the New_Messages of the Shop from every Channel in Tape_Order.
2. WHEN the Owner presses PLAY, THE Machine_Page SHALL show the first Message in Tape_Order: caller name, phone, Channel, reason, Final_Urgency with its basis, the Agreed_Text, the Transcript, and the Current_Reply in Caveat.
3. WHILE a Message is being played, THE Machine_Page SHALL reveal the Transcript line by line like a tape, and SHALL keep every line available as text from the start for keyboard and screen-reader users.
4. WHEN a Message is played for the first time, THE Machine_API SHALL mark it Heard, so it is no longer an Unheard_Message.
5. WHEN the Owner presses NEXT, THE Machine_Page SHALL play the next Message in the Tape_Order that was computed when PLAY was pressed, so a Message arriving during playback does not reshuffle the Owner's place.
6. WHEN the Owner presses ERASE, THE Machine_API SHALL mark the Message Erased, and THE Machine_Page SHALL remove it from the Tape and lower the Counter.
7. WHEN the Owner presses COPY REPLY, THE Machine_Page SHALL copy the Current_Reply to the clipboard and confirm it with visible text ("Copied") that is also announced to screen readers.
8. THE Urgency SHALL be shown as a text badge ("Urgent" / "Urgente"), never by colour alone; the `urgent` badge SHALL use `--light-text` with `--card` text.
9. THE Channel SHALL be shown as a Lucide icon with a text label (voice, WhatsApp, web chat).
10. WHEN there are no New_Messages, THE Tape SHALL say so in one line and SHALL show the Caveat note "they called while you were busy…" only when there is at least one.
11. THE Machine_Page SHALL never play, record or store audio.
12. A Sample_Message SHALL carry a visible text badge "Sample" / "Ejemplo" on its card and while it is played, so nobody mistakes it for a real customer.

### Requirement 8: Erase is permanent

**User Story:** As an Owner, I want a message I erased to stay erased, so that I never deal with the same customer twice by mistake.

#### Acceptance Criteria

1. WHEN a Message is Erased, THE Owner_Machine SHALL never count it as a New_Message again, whatever happens afterwards (repeated ERASE requests, a late hang-up or stale-call sweep for the same Call, a Poll, a reload, another device).
2. THE Machine_API SHALL make ERASE idempotent: erasing an Erased Message changes nothing and records no second Audit_Record.
3. THE Owner_Machine SHALL offer no "un-erase".
4. Erasing a Message SHALL NOT change its Booking.

### Requirement 9: The agenda

**User Story:** As an Owner, I want today's and this week's bookings in one simple list, so that I can plan the day between customers.

#### Acceptance Criteria

1. THE Agenda SHALL list the Shop's Bookings from every Channel whose start falls on today or one of the next 7 days in the Shop's Time_Zone, grouped by local day in time order, with a heading for each of the 8 days, including days with no Bookings ("Nothing booked" / "Sin citas").
2. EACH Agenda row SHALL show the local start time, the customer name, what was booked in the Sector_Pack's vocabulary (the Service for an `appointment` pack), the Resource name, the Agenda_Status as text, and the Channel.
3. THE Agenda SHALL show Bookings made by any Channel and Bookings moved from the Machine_Page in the same list.
4. THE Agenda SHALL show cancelled Bookings with their Agenda_Status, below the active Bookings of the same day.
5. WHEN a Booking was moved or cancelled from the Machine_Page, THE Agenda row SHALL say by whom (the Actor's label) and when, in the Shop's Time_Zone.

### Requirement 10: Owner actions on bookings

**User Story:** As an Owner, I want to confirm, move or cancel a booking with one tap, so that the agenda matches what I agreed with the customer, without ever creating an impossible booking.

#### Acceptance Criteria

1. THE Agenda SHALL offer, on each active Booking that has not started yet, the actions confirm (if not yet confirmed), move and cancel. A Booking that has started or is cancelled SHALL offer none.
2. WHEN the Owner confirms a Booking, THE Machine_API SHALL record the confirmation time and the Actor, and the Agenda_Status SHALL become `confirmed`. Confirming a confirmed Booking SHALL change nothing.
3. WHEN the Owner chooses move, THE Machine_Page SHALL let the Owner pick a local day within the next 14 days and SHALL list only the Move_Slots for that day, as returned by the server.
4. WHEN the Owner submits a move, THE Machine_API SHALL read the Existing_Bookings from the database again and re-run the Booking_Rules for the chosen start with the same Service, ignoring the Booking being moved. IF the Booking_Rules reject it, THEN THE Machine_API SHALL not change the Booking and SHALL return the fresh Move_Slots of that day.
5. THE Machine_API SHALL write a move through the same `bookings_no_overlap` constraint as a caller's Booking. IF the constraint rejects the write, THEN THE Booking SHALL stay as it was and THE Machine_Page SHALL say "That time was just taken" and show the fresh Move_Slots.
6. WHEN a move is accepted, THE Booking SHALL keep its customer, Service and Channel, SHALL prefer its current Resource when that Resource is free at the new time, and SHALL lose its Owner confirmation, because the customer has not agreed to the new time yet.
7. IF the Booking changed since the Machine_Page loaded it (moved, cancelled or rescheduled by the caller), THEN THE Machine_API SHALL reject the action with "This booking changed, here is the current one" and SHALL not apply it.
8. WHEN the Owner cancels a Booking, THE Machine_Page SHALL ask for one confirmation ("Cancel Ana's haircut on Friday the 13th at 7:30 pm?"), and THE Machine_API SHALL mark the Booking cancelled, recording that the Owner cancelled it.
9. THE Owner SHALL NOT be able to move a Booking into the past, outside Opening_Hours, onto a closed day, onto a time where the Service does not fit before closing, or onto a time where every Resource is busy.

### Requirement 11: Every owner action is recorded

**User Story:** As an Owner who works with one or two people, I want to see who changed a booking and when, so that we never argue about who moved Ana's appointment.

#### Acceptance Criteria

1. WHEN an Owner_Action changes a Booking or a Message, THE Machine_API SHALL store one Audit_Record in the same atomic write as the change.
2. THE Audit_Record SHALL contain the action, the Shop, the Booking or Message id, the Actor (session id and label), the time, and the values before and after (start, end, Resource, status, confirmation, erased).
3. IF the change is not applied (rejected by the Booking_Rules, by the constraint, or because the Booking changed), THEN no Audit_Record SHALL be stored.
4. THE Audit_Record SHALL NOT contain the caller's name or phone, the Transcript, or the PIN.
5. Caller actions (bookings, reschedules and cancellations made in a Call) SHALL keep being recorded as in `core-call-loop`: by Channel and Call, with a cancellation marked as done by the caller.

### Requirement 12: Live updates by cheap polling

**User Story:** As an Owner, I want a new message to appear while the screen is open, so that I see the light blink without reloading.

#### Acceptance Criteria

1. WHILE the Machine_Page is open and visible with a valid Owner_Session and not Idle, THE Machine_Page SHALL Poll every 5 seconds.
2. THE Poll SHALL send the last Machine_Version it saw. WHEN the Machine_Version has not changed, THE Machine_API SHALL answer with only the Machine_Version and the counts of New_Messages and Unheard_Messages, in a body under 200 bytes.
3. WHEN the Machine_Version has changed, THE Machine_API SHALL answer in the same response with the Tape (without Transcripts) and the Agenda.
4. THE Machine_Version SHALL change on every write to the Shop's Messages or Bookings, by any Channel or Owner_Action, and SHALL be maintained by the database, so no write path can forget it.
5. WHEN a Call ends with a Message, THE Machine_Page SHALL show it on the Tape, with the Message_Light blinking, within 5 seconds of the commit plus the Poll's own round trip (30 seconds while Idle), and its Booking, if any, in the Agenda in the same update.
6. WHILE the Machine_Page is hidden (another tab or the phone screen off), THE Machine_Page SHALL stop polling, and WHEN it becomes visible again it SHALL Poll at once.
7. IF a Poll fails, THEN THE Machine_Page SHALL keep showing the last data, show a small "Offline, retrying" note, and retry with backoff up to 60 seconds. IF a Poll answers `401`, THEN THE Machine_Page SHALL return to the PIN_Gate.
8. THE Poll responses SHALL be sent with `Cache-Control: no-store`.
9. WHEN 15 minutes pass with no pointer, touch or key input on the Machine_Page and no Poll bringing a new Message, THE Machine_Page SHALL become Idle and Poll every 30 seconds. WHEN any such input happens while Idle, THE Machine_Page SHALL Poll at once and return to 5 seconds. WHEN a Poll brings a Message id it has not seen before, THE Machine_Page SHALL leave Idle and return to 5 seconds. Failure backoff (12.7) takes precedence over both intervals.

### Requirement 13: Accessibility

**User Story:** As an Owner who may use a screen reader, a keyboard or large text, I want every part of the machine to work for me, so that the haunted look never locks me out.

#### Acceptance Criteria

1. THE Machine_Page and the PIN_Gate SHALL be fully usable with the keyboard alone, in a logical tab order, with a visible gold focus ring on every control.
2. THE Message_Light's state and the Counter SHALL be available as text ("3 new messages, 1 not played yet") in a polite live region, announced only when the counts change.
3. THE text and its background SHALL have a contrast ratio of at least 4.5:1 for normal text and 3:1 for large text, using only the token pairs that `design.md` allows for each size.
4. WHILE `prefers-reduced-motion` is set, THE Machine_Page SHALL stop the blinking, the flicker, the reel rotation, the line-by-line Transcript and the ghost fade-in, and SHALL show the Message_Light's state as a steady light plus the text of 13.2.
5. THE Message_Light SHALL never flash more than 3 times in any one second.
6. EVERY control SHALL have an accessible name; the tabs SHALL use the ARIA tabs pattern; the move and cancel dialogs SHALL be modal, move focus into the dialog and back to the control that opened it, and close with Escape.
7. THE Machine_Page SHALL mark the language of its content (`lang`) correctly, including Messages stored in a language other than the labels.
8. THE Lighthouse accessibility score of `/machine/peluqueria-lola` SHALL be at least 95, measured both on the PIN_Gate and on the machine after login, on a mobile viewport.
9. THE accessibility contract of the machine SHALL be checked by automated tests that render the PIN_Gate and the machine in a DOM (jsdom with Testing Library): the keyboard order of the controls, a gold focus ring style present on every focusable control, the polite live-region announcement when new Messages arrive (and none when the counts do not change), and, with `prefers-reduced-motion: reduce`, no reel rotation, no blinking or flicker on the Message_Light, and every Transcript line visible.

### Requirement 14: Privacy

**User Story:** As a Caller, I want my name and phone to reach only the shop, so that leaving a message is safe.

#### Acceptance Criteria

1. No Machine_API response and no part of the Machine_Page rendered without a valid Owner_Session SHALL contain a caller name, phone, reason, Transcript or Booking time.
2. THE Owner_Machine SHALL send Transcripts only when a Message is played, never in the Poll.
3. THE Machine_API SHALL never send the Owner_PIN hash, the Owner_Session secret, or any other Shop's data.
4. THE server log of the Owner_Machine SHALL never contain a caller name, phone, reason, Transcript, the PIN, a session token, or a Visitor key.
5. No audio SHALL be captured, recorded or stored by any part of Phantom_Line; the Tape is the Transcript.
6. THE Machine_Page SHALL NOT be cached by the server or a CDN, and its personal data SHALL never be part of a cache key or a cache tag.

### Requirement 15: Correctness properties

**User Story:** As a developer, I want property-based tests for the rules that protect the Owner, so that urgency and moves stay correct for inputs nobody thought of.

#### Acceptance Criteria

1. FOR ALL Caller transcripts, Sector_Packs, Suggested_Urgencies, outcomes and current times, THE Final_Urgency SHALL be at least the Rule_Urgency of 5.3–5.7, and at least the Suggested_Urgency.
2. FOR ALL Caller transcripts into which an `urgent` term of the pack is inserted, in any letter case, with or without accents, and with any surrounding punctuation or spacing, THE Final_Urgency SHALL be `urgent`.
3. FOR ALL sequences of Message arrivals, plays, erases, repeated erases and repeated end-of-Call writes for the same Call, an Erased Message SHALL never be counted as a New_Message again.
4. FOR ALL Shops, current times, Existing_Bookings, Bookings and requested new starts, THE Machine_API SHALL accept a move only if the Booking_Rules accept that start for that Booking's Service with the Booking ignored, and every Move_Slot SHALL be a start the Booking_Rules accept.
5. FOR ALL sequences of accepted caller Bookings and owner moves, no two active Bookings SHALL share a Resource and overlap in time.
6. THE property-based tests SHALL run at least 100 generated cases each, and the time-based ones SHALL cover both 2026 daylight-saving changes in Europe/Madrid.
7. FOR ALL Demo_Shop Tapes, Call and Message ages, Bookings and current times, after Demo_Retention: no New_Message is older than 24 hours; no Call, and no Message, older than 7 days remains; the Tape has at least 3 New_Messages; each Sample_Message is a New_Message at most once; a second run at the same time changes nothing; and FOR ALL Real_Shops, Demo_Retention changes nothing.
8. FOR ALL sequences of Poll timer ticks, inputs, Poll results, failures and visibility changes, the next Poll is scheduled after 5 seconds when not Idle and not failing, after 30 seconds when Idle and not failing, and after the backoff delay when failing; no Poll is sent while the page is hidden.

### Requirement 16: Demo retention and sample messages

**User Story:** As the author of a public demo that judges may open weeks after it was recorded, I want old demo calls to disappear and the machine never to look empty, so that a judge sees a working machine and no stranger's details stay around.

#### Acceptance Criteria

1. Demo_Retention SHALL act on the Demo_Shop only. THE Owner_Machine SHALL never erase, delete or add Messages, Calls or Bookings of a Real_Shop automatically.
2. WHEN Demo_Retention runs, every New_Message of the Demo_Shop created more than 24 hours earlier SHALL become Erased. This is not an Owner_Action and SHALL store no Audit_Record; Requirement 8 applies to it like to any other erase.
3. WHEN Demo_Retention runs, every Call of the Demo_Shop that started more than 7 days earlier, open or ended, SHALL be deleted together with its Message and that Message's Audit_Records. Every Booking of the Demo_Shop that ended more than 7 days earlier SHALL be deleted together with its Audit_Records. A Booking that has not ended that long ago SHALL stay, and lose only its link to a deleted Call.
4. WHEN, after 16.2 and 16.3, the Demo_Shop has fewer than 3 New_Messages, Demo_Retention SHALL add, created at that moment, each Sample_Message that is not currently a New_Message, so that no Sample_Message is ever on the Tape twice.
5. THE 3 Sample_Messages SHALL be fixed in code: one `urgent` (a dye allergy reaction), one booking (a haircut booked for the next open day) and one question (opening hours), each with a short Call and Transcript in the Demo_Shop's first language, a test name marked as an example, and a phone that cannot be dialled. Their Final_Urgency SHALL come from the Urgency_Rules like any other Message's. They SHALL create no Booking and SHALL not appear in the Agenda.
6. Demo_Retention SHALL run after a successful login to the Demo_Shop's machine, when the Demo_Shop's Machine_Page loads with a valid Owner_Session, on a Poll of the Demo_Shop at most once every 10 minutes, and once a day from a scheduled job, so data is deleted at most one day after it turns 7 days old even when nobody opens the machine. THE database SHALL ensure that concurrent requests run it at most once per 10 minutes.
7. IF Demo_Retention fails, THEN the request that triggered it SHALL still answer as if it had not run, and THE server log SHALL record one `demo_retention` JSON line with the error summary and counts only, never a name, phone, reason or Transcript.
8. THE scheduled job's endpoint SHALL refuse every request that does not carry the job's secret, and SHALL return no Shop data.
