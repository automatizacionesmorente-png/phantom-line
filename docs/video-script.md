# Video script: Phantom Line (target 2:40, hard limit 2:50)

Narration is the owner's voice, in English. During the Spanish call, the subtitles show the Spanish words as spoken, with an English translation on a second line, so both kinds of viewer can follow. Every receptionist line below comes from the code (`lib/receptionist/phrases.ts`) or from a test that pins it (`tests/api/turn.booking.test.ts`, `tests/api/turn.realCall.test.ts`). The model only reads what the caller said.

| # | Segment | Time | Length |
|---|---|---|---|
| 1 | Hook | 0:00–0:05 | 5 s |
| 2 | Problem | 0:05–0:20 | 15 s |
| 3 | Live call in Spanish | 0:20–1:00 | 40 s |
| 4 | Owner's machine blinking | 1:00–1:25 | 25 s |
| 5 | English call | 1:25–1:45 | 20 s |
| 6 | How Kiro built it | 1:45–2:30 | 45 s |
| 7 | Close | 2:30–2:40 | 10 s |

## Before recording (or the call will not work the first time)

1. **Record on a Monday to Friday.** Lola is open Tuesday to Saturday, 10:00–14:00 and 17:00–20:00 (Europe/Madrid). Both calls say "mañana" / "tomorrow", and the 19:30 offer only exists if tomorrow is an open day.
2. **Clear the demo agenda for tomorrow evening.** If 19:30, 19:15 or 19:00 is taken on both chairs, the offer changes. TODO (owner): remove the test bookings from the demo database (BACKLOG item 1, "demo reset", is not built yet).
3. **The demo PIN must be 6 digits.** With a 4-digit PIN such as 1980, the machine says "Este contestador aún no está configurado" (owner-machine manual checklist).
4. **Use Chrome** on desktop for both calls; Safari has no speech recognition yet. Allow the microphone once before recording.
5. **Window layout:** window A is `/machine/peluqueria-lola`, already unlocked with the PIN. Window B is `/call/peluqueria-lola`. Put them side by side for segment 4.
6. **Do a dry run** of each call a few minutes before. The free-tier model sometimes answers 503. If a reply is "Perdona, ahora mismo no puedo atenderte bien…", hang up and call again. Do not cut the take mid-call.
7. **Wording can vary.** Some replies have two approved variants, picked from the call id, so the take may say either one. Both are listed below.

---

## 1. Hook (0:00–0:05)

- **Shot:** close-up of the ivory machine with the terracotta light blinking and the reels still.
- **On screen:** "The voices of customers nobody answered… come back."
- **Narration:** "Every missed call at a small shop is a customer who hung up."

## 2. Problem (0:05–0:20)

- **Shot:** stock or self-shot footage of a salon owner cutting hair while a phone rings unanswered. Cut to the landing page `/`.
- **On screen:** "Small shops miss calls every day. A receptionist costs more than they earn."
- **Narration:** "Lola runs her salon alone. When she is cutting hair, nobody picks up, and that booking is gone. Phantom Line answers for her: by voice, in Spanish or English, with her real hours and prices."

## 3. Live call in Spanish (0:20–1:00)

> **This call is a haircut (corte), not "corte + degradado".** The deployed demo profile has three services: corte, tinte and barba. Degradado and two services in one sentence come from the front-desk-brain spec (0 of 14 tasks done). The "corte + degradado" version is under "Swap-in once front-desk-brain lands" below; use it only after that spec's tasks 2, 4, 5, 6, 8, 9 and 10 are ticked and the new seed is on Neon.

- **Shot:** window B full screen. ES selected on the language switch. Press **Llamar** / Call. The transcript fills in as the call goes.
- **On screen (corner tag):** "Live call · real Gemini · real database"

Say exactly these lines, and wait for each reply to finish before speaking.

| Who | What is said (Spanish subtitle) | English subtitle |
|---|---|---|
| Receptionist | "¡Hola! Estás llamando a Peluquería Lola, soy su asistente virtual. ¿En qué te puedo ayudar?" (or "¡Hola! Has llamado a Peluquería Lola. Te atiende su asistente virtual, ¿qué necesitas?") | "Hi! You've reached Peluquería Lola, I'm its virtual assistant. How can I help?" |
| **You say** | **"Quiero cortarme el pelo mañana a las nueve de la noche."** | "I'd like a haircut tomorrow at nine at night." |
| Receptionist | "Mañana a las nueve ya hemos cerrado. ¿Te viene bien a las siete y media? También tengo a las siete y cuarto o a las siete." | "Tomorrow at nine we're already closed. Does half past seven suit you? I also have quarter past seven or seven." |
| **You say** | **"Vale, a las siete y media."** | "OK, half past seven." |
| Receptionist | "Genial, mañana a las siete y media tengo hueco. ¿Me dices tu nombre?" (or "Vale, mañana a las siete y media me cuadra. ¿A nombre de quién lo pongo?") | "Great, tomorrow at half past seven is free. What's your name?" |
| **You say** | **"Ana García."** | |
| Receptionist | "Perfecto. ¿Me dejas un teléfono de contacto?" (or "Muy bien. ¿Y un teléfono por si hay que avisarte?") | "Perfect. Can you leave a contact number?" |
| **You say** | **"Seis uno dos, tres cuatro cinco, seis siete ocho."** | "Six one two, three four five, six seven eight." |
| Receptionist | "Te apunto un corte mañana [día] a las siete y media, a nombre de Ana García. Tu teléfono es el seis uno dos, tres cuatro cinco, seis siete ocho, ¿vale?" | "I'm booking you a haircut tomorrow at half past seven, for Ana García. Your number is six one two, three four five, six seven eight, right?" |
| **You say** | **"Sí."** | "Yes." |
| Receptionist | "¡Hecho! Te esperamos mañana [día] a las siete y media. Lola verá tu mensaje y te confirma." (or "¡Listo, apuntado para mañana [día] a las siete y media! Lola verá tu mensaje y te confirma.") | "Done! See you tomorrow at half past seven. Lola will see your message and confirm." |

`[día]` is tomorrow's weekday ("mañana miércoles"). If the receptionist reads back only "mañana", that is fine too.

- **Narration (over the 21:00 → 19:30 moment, about 8 s):** "I asked for nine at night. The model only reads what I said. The code checks the hours, sees both chairs, and offers the nearest free time."
- **On screen at that moment:** "The model proposes. The code decides."

## 4. Owner's machine blinking (1:00–1:25)

- **Shot:** cut to the two windows side by side, or straight to window A. Within about 5 seconds of the call ending (one Poll), the light starts blinking and the counter goes up.
- **On screen:** what the machine itself shows, for example "Tienes 1 mensaje nuevo" (the count depends on the tape; do not overlay a number the machine does not show).
- **Actions:**
  1. Point at the blinking light and the counter (3 s).
  2. Press **PLAY**. The reels turn and the transcript of the call appears (6 s).
  3. Show the tape card: caller Ana García, the reason, the urgency badge, what was agreed ("Cita de corte … 19:30 (Sillón 1)", or Sillón 2) and the suggested reply in handwriting (6 s).
  4. Open the **Agenda** tab: the 19:30 haircut on tomorrow's day (5 s).
- **Narration:** "Seconds later, Lola's answering machine blinks. One tap plays the call back. She sees who called, what was agreed and a reply she can send, and the booking is already in her agenda. Double bookings are blocked by the database itself."

## 5. English call (1:25–1:45)

- **Shot:** window B, switch to **EN**, press Call. Cut between replies to keep it under 20 s: show the greeting, the 9 pm rejection and the final confirmation; speed-ramp the name and phone turns.
- **On screen:** "Same brain, in English."

| Who | What is said |
|---|---|
| Receptionist | "Hi! You've reached Peluquería Lola, I'm the salon's virtual assistant. How can I help?" (or "Hello! This is Peluquería Lola. You're talking to the salon's virtual assistant, what do you need?") |
| **You say** | **"I'd like a haircut tomorrow at nine in the evening."** |
| Receptionist | "Tomorrow at nine we're already closed. Does half past seven work for you? I also have …" (the last free times may differ, because the Spanish call just took one chair at 19:30) |
| **You say** | **"OK, half past seven then."** |
| Receptionist | "Great, tomorrow at half past seven works. Can I have your name?" (or "Okay, tomorrow at half past seven is free. What name should I put it under?") |
| **You say** | **"John Smith."** |
| Receptionist | "Perfect. Can I have a contact number?" |
| **You say** | **"Six one two, three four five, six seven eight."** |
| Receptionist | The read-back: "I'll put you down for a haircut tomorrow … at half past seven, under John Smith. Your number is …, right?" |
| **You say** | **"Yes please."** |

- **Narration (short, over the confirmation):** "English callers get the same rules, the same agenda, and a second chair."
- **Note:** after the Spanish call took one chair at 19:30, the English 19:30 goes on the other chair. Both chairs are then full at 19:30, so do not run a third take for the same time.
- **TODO (owner):** the English neural voice is not chosen yet (natural-voice task 2.4). Until it is, listen to the dry run and decide whether the English voice is good enough for the video.

## 6. How Kiro built it (1:45–2:30)

Four shots, about 11 s each. Record them as screen captures in Kiro (IDE or `kiro-cli`).

**6a. A spec (1:45–1:56)**
- **Shot:** scroll `.kiro/specs/core-call-loop/requirements.md` (EARS lines), then `design.md`'s numbered correctness properties, then `tasks.md` with ticked boxes.
- **On screen:** "5 specs · reviewed by a human before any code"
- **Narration:** "Every feature started as a Kiro spec. I reviewed each one like a shop owner, and Kiro found where my own changes contradicted its requirements."

**6b. A property that caught a real bug (1:56–2:07)**
- **Shot:** the N7 row of the catch log in `.kiro/specs/natural-voice/tasks.md`, highlighted: the English read-back for "María del Carmen Pérez García" ran to 26 words.
- **On screen:** "Property N7 found a 26-word sentence. The 25-word limit would have cut off the caller's name."
- **Narration:** "Fifty-five properties check the rules on thousands of random cases. This one found a read-back so long that the caller's name would have been cut off."

**6c. A hook firing (2:07–2:19)**
- **Shot:** in a builder session, ask Kiro: *"Remove the fit check (step 5) from `lib/booking/rules.ts`, then restore it."* After the write, the `booking-properties` hook prints "booking properties FAILED after your write to lib/booking. Fix the code, never the property:" with P3's shrunk counterexample. After the restore it prints "booking properties after your write: green".
- **On screen:** "Hook: every write to the booking rules runs their properties"
- **Narration:** "Hooks keep Kiro honest. Break a booking rule, and the properties fail on the same write."
- **TODO (owner):** this run has not been recorded yet (jury-polish task 2.5). The counterexample on screen must be the one the hook actually prints. For reference, the earlier mutation proof shrank to a 158-minute service at 09:14 in a session closing at 09:15.

**6d. The MCP (2:19–2:30)**
- **Shot:** `.kiro/settings/mcp.json` with the Context7 server, then a Kiro chat asking Context7 for a current doc (for example the `@google/genai` interactions API) and the answer.
- **On screen:** "MCP: current docs before memory"
- **Narration:** "Through MCP, Kiro reads current docs before it writes code. Docs changed more than six of its first choices."
- **TODO (owner):** in the logged sessions, Context7 calls failed at the permission step. Record a real successful call for this shot. If the `phantom-booking` MCP server (jury-polish task 3) is built by then, show it answering `check_slot` for tomorrow at 21:00 instead.

## 7. Close (2:30–2:40)

- **Shot:** the machine, light blinking, the reels turning slowly; fade to the landing page.
- **On screen:** "Phantom Line · Try it: DEMO_URL · Code and specs: REPO_URL · #KiroweenHackathon26"
- **Narration:** "Phantom Line. Nobody hangs up on a silent shop again."

---

## Swap-in once front-desk-brain lands: "corte + degradado" (segment 3)

Use this only when front-desk-brain tasks 2, 4, 5, 6, 8, 9 and 10 are ticked, and the Rich_Profile seed has been run on Neon (task 14). The lines come from the spec's regression case, Real_Call_2026_11_16 (task 10.1), not from a run.

| Who | What is said | English subtitle |
|---|---|---|
| **You say** | **"Hola Lola, quería cortarme el pelo y hacerme un degradado."** | "Hi Lola, I'd like a haircut and a fade." |
| Receptionist | "… son cincuenta minutos y veinticuatro euros. ¿Te viene bien [first free slot]? …" | "… that's fifty minutes and twenty-four euros. Does [slot] suit you? …" |
| **You say** | **"Sí."** | "Yes." |
| Receptionist | asks for the name | |
| **You say** | **"Me llamo Ana."** | "My name is Ana." |
| Receptionist | asks for the phone | |
| **You say** | **"Seis uno dos, tres cuatro cinco, seis siete ocho."** | |
| Receptionist | read-back with "Corte de hombre + Degradado" and the total price | |
| **You say** | **"Sí."** | |

TODO (owner): once task 10.1 passes, copy its exact First_Offer text into this table. The offered slot depends on the recording day and the agenda.
