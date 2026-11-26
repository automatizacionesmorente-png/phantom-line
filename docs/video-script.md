# Video script: Phantom Line (target 2:52, hard limit 2:55)

Narration is the owner's voice, in English. During the Spanish call, subtitles show the Spanish words as spoken with an English line below. Receptionist lines come from the code and some have two wordings, so read the subtitles from the take, not from this file. Updated 25 Nov 2026 for the salon-system branch (the segment below needs the new tabs on the live demo, so record after the production step).

| # | Segment | Time | Length |
|---|---|---|---|
| 1 | Hook | 0:00-0:08 | 8 s |
| 2 | Problem | 0:08-0:20 | 12 s |
| 3 | Guided path and Spanish call | 0:20-0:58 | 38 s |
| 4 | The machine blinks | 0:58-1:18 | 20 s |
| 4b | The salon app: Today, Clients, My business, Settings | 1:18-1:52 | 34 s |
| 5 | English call | 1:52-2:06 | 14 s |
| 6 | How Kiro built it | 2:06-2:24 | 18 s |
| 7 | Kiro, then Claude (honest line) | 2:24-2:34 | 10 s |
| 8 | /startup | 2:34-2:46 | 12 s |
| 9 | Close | 2:46-2:52 | 6 s |

Total 2:52, under the 2:55 limit. The salon app is now the second half of the story, so it gets 34 s; the English call, Kiro and /startup segments below are shortened to fit (cut their last sentence first if a take runs long).

## Before recording

1. **Record Tuesday to Saturday.** Lola is open Tuesday to Saturday, 10:00-14:00 and 17:00-20:00 (Europe/Madrid). "Tomorrow at 9 pm" needs tomorrow to be an open day. The 19:30 offer needs free chairs.
2. **Reset the demo** first: `npm run demo:reset -- --allow-remote` (owner's call, it touches the live database). It clears test bookings and restores the curated set.
3. **Chrome on desktop** for both calls (speech recognition). Allow the microphone once beforehand.
4. **Layout:** window A is `/machine/peluqueria-lola` unlocked with PIN 198000 (public demo PIN). Window B is `/call/peluqueria-lola`. Side by side for segment 4. Show the PIN gate for one second in a separate take if you want it on screen.
5. **Dry run** each call a few minutes before. If a reply is the "can't help right now" fallback, hang up and call again; never cut a take mid-call.
6. **No music**, or royalty-free only (the rules ban copyrighted music).

## 1. Hook (0:00-0:08)

- **Shot:** close-up of the ivory machine, terracotta light blinking, reels still.
- **On screen:** "An 80s answering machine, brought back from the dead."
- **Narration:** "Every missed call at a small shop is a customer who hung up. So we brought the answering machine back."

## 2. Problem (0:08-0:20)

- **Shot:** self-shot footage of a salon chair and a phone ringing, cut to the landing page `/`.
- **Narration:** "Lola runs her salon alone. While she cuts hair, nobody picks up and the booking is gone. Phantom Line answers for her, by voice, in Spanish or English, with her real hours and prices."

## 3. Guided path and Spanish call (0:20-0:58)

- **Shot:** window B. First 4 s on the "Try it in 30 seconds" strip (call, PIN, watch the light). Then ES selected, press **Llamar**. Transcript fills as the call goes.
- **On screen (corner):** "Live call · real Gemini · real database"

| Who | Say / happens |
|---|---|
| **You say** | **"Hola, quería cortarme el pelo y hacerme un degradado mañana a las nueve de la noche."** |
| Receptionist | Names the combined service with duration and price, says nine is closed, offers 19:30 and nearby times |
| **You say** | **"Vale, a las siete y media."** |
| Receptionist | Asks the name; you say **"Ana García"**; asks the phone; you say **"seis uno dos, tres cuatro cinco, seis siete ocho"** |
| Receptionist | Reads the booking back with day, time and phone |
| **You say** | **"Sí."** and the receptionist confirms |

- **Narration (over the 21:00 to 19:30 moment):** "I asked for nine at night. The model only reads what I said. The code checks hours and chairs, and offers the nearest free time."
- **On screen then:** "The model proposes. The code decides."
- Speed-ramp the name and phone turns if the call runs long.

## 4. The machine blinks (0:58-1:18)

- **Shot:** both windows, then window A. Within about 5 s of hanging up (one poll) the light blinks and the counter rises.
- **Actions:** point at the light and counter (3 s); press **PLAY**, reels turn, transcript appears (6 s); show the card: caller, reason, urgency badge, what was agreed, suggested reply (6 s); open **Today** and show the booking in its column (5 s).
- **Narration:** "Seconds later Lola's machine blinks. One tap plays the call back. She sees who called, what was agreed and a reply she can send, and the booking is already in her day. The database itself refuses double bookings."

## 4b. The salon app (1:18-1:52, 34 s)

- **Shot (phone-sized window, one continuous take, about 8 s per tab):**
  1. **Today:** the booking book, one column per stylist, coloured blocks, dashed free gaps, the red now-line. Tap the **+**, then **New appointment**, tap a free gap and show the three steps (do not finish a real booking). Close it.
  2. **Clients:** open one card: allergy note, birthday, consent switch, colour formula in the history.
  3. **My business:** taken, expenses, what is left against last month; the block "what your receptionist did this month"; tap **For the accountant** (CSV).
  4. **Settings:** the five switches and one prepared WhatsApp message; tap **Send on WhatsApp** only to show it opens, then come back.
- **On screen:** "Sample data: a demo month."
- **Narration (about 80 words, 150 per minute):** "Lola's app is more than a tape. In the morning she sees her day, one column per stylist, and adds or blocks time with one tap. Each client has a card: allergies, birthday, colour formula. At month end she sees what came in, what went out, what her receptionist did, and sends it to her accountant. Five switches prepare reminders and reviews; she sends each with one tap on WhatsApp, nothing automatic. Sample data, a demo month."
- Do not show a real client phone, and do not claim invoices or automatic sending.

## 5. English call (1:52-2:06)

- **Shot:** window B, switch to **EN**, press Call. Show the greeting, the 9 pm rejection with an offer, and the confirmation; speed-ramp the name and phone.
- **You say:** **"I'd like a men's haircut tomorrow at nine in the evening."**, then **"Half past seven, then."**, **"John Smith"**, the phone, **"Yes please."**
- **On screen:** "Same brain, in English."
- **Narration:** "English callers get the same rules, the same agenda and a second chair."
- **Note:** after the Spanish call took one chair at 19:30, the English 19:30 goes on the other chair. Do not record a third take for the same time without a reset.

## 6. How Kiro built it (2:06-2:24)

Screen captures, about 8 s each.

- **Spec:** scroll `.kiro/specs/core-call-loop/requirements.md` (EARS lines), then a design with numbered properties. **Narration:** "Every feature started as a Kiro spec. I reviewed each like a shop owner, and Kiro found where my own changes contradicted its requirements."
- **Property:** `NOTAS-KIRO.md` row of 2026-11-12, "mutation proof". **On screen:** "Break a rule on purpose: property P3 shrinks to a 158-minute service at 09:14." **Narration:** "Property tests check the rules on thousands of random cases, and Kiro broke the code on purpose to prove they work."
- **Steering and hooks:** flash `.kiro/steering/` and `.kiro/hooks/booking-properties.json`. **On screen:** "Steering · specs · hooks · property tests".
- Do not show a Context7 call: no successful call has been logged.

## 7. Kiro, then Claude (2:24-2:34)

- **Shot:** `NOTAS-KIRO.md` scrolled to the 2026-11-22 row, then the git log with "Written by Claude (Kiro credits exhausted)".
- **On screen:** "Kiro: 5-16 Nov. Claude: after the credits ran out."
- **Narration (10 s, read as is):** "Kiro built the core until its credits ran out on the seventeenth of November. The rest, the judge guide, the startup page, the QA fixes and the salon app, was written by Claude under my direction, and every commit says so. The salon ideas come from our agency's earlier private app; no code was copied."

## 8. /startup (2:34-2:46)

- **Shot:** `/startup`: the problem numbers, the cost per call, the planned Salon plan, the waitlist form (do not submit a real email on camera).
- **On screen:** "Sourced numbers. Planned price, not market-tested."
- **Narration:** "Phantom Line is also a startup: about four cents a call, a planned price, not market-tested, and every number cites its source. I'm Miguel Morente, a student at UFV Madrid."

## 9. Close (2:46-2:52)

- **Shot:** the machine, light blinking, reels turning slowly; fade to the demo URL.
- **On screen:** "Phantom Line · phantom-line-nine.vercel.app · #KiroweenHackathon26"
- **Narration:** "Phantom Line. Nobody hangs up on a silent shop again."
