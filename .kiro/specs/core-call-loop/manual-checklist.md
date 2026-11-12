# Manual checklist: Core Call Loop (task 12)

Run by a person in desktop Chrome with a working microphone, plus one real Android phone for check 4. Write the result of every check on its "Result / date" line: **pass** or **fail**, the date, and for a fail what happened (the exact line heard or shown helps most).

## Start the app locally

Needs Node.js 20.19 or newer and a Neon database. Run from the repository root:

```bash
npm install
cp .env.example .env.local        # then fill in the values in an editor; never commit this file
node --env-file=.env.local scripts/migrate.mjs   # applies drizzle/ migrations, including the no-overlap constraint
npm run db:seed                   # creates or updates Peluquería Lola (safe to run twice)
npm run dev
```

Open <http://localhost:3000/call/peluqueria-lola> in Chrome. Chrome allows the microphone on `localhost` without HTTPS. A real phone needs HTTPS, so check 4 on Android uses the deployed Vercel URL with the same path.

`.env.local` needs `GEMINI_API_KEY` and `DATABASE_URL`. `GEMINI_MODEL`, `TURN_LIMIT_PER_VISITOR_PER_MINUTE`, `TURN_LIMIT_GLOBAL_PER_HOUR` and `RATE_LIMIT_SALT` may stay empty to use the defaults.

**Seeing the owner's Message.** The owner's machine screen is the next spec, so for now read the newest Message in the Neon SQL editor:

```sql
SELECT created_at, outcome, caller_name, caller_phone, reason, urgency, agreed, suggested_reply, model_failed
FROM messages WHERE shop_id = 'peluqueria-lola' ORDER BY created_at DESC LIMIT 1;

SELECT starts_at AT TIME ZONE 'Europe/Madrid' AS local_start, resource_id, service_id, status, customer_name
FROM bookings WHERE shop_id = 'peluqueria-lola' ORDER BY created_at DESC LIMIT 1;
```

Use a test name and phone, never a real customer's. If a Call ends with "Perdona, ahora mismo no puedo atenderte bien…", the server terminal shows one `turn_fallback` line with the cause; copy it into the result.

## Already verified

### 0. Full booking over HTTP in typed mode, Spanish and English

Run on 2026-11-12 by scripted HTTP requests to `POST /api/turn` on `next dev`, with real Gemini and real Neon. No browser, no microphone and no speech were involved, so this does not replace checks 1 to 3.

- **Spanish:** asked for a haircut tomorrow at 21:00. The code rejected 21:00 and offered 19:30, 19:15 and 19:00. The call booked Friday 13 November 2026 at 19:30. Outcome `booked`.
- **English:** booked Saturday 14 November 2026 at 11:00. Outcome `booked`.

Result / date: **pass, 2026-11-12** (HTTP, typed mode only)

## To run in Chrome

### 1. Full booking by voice in Spanish (task 12.1)

Steps:
1. Set Chrome's language to Spanish, or leave it and press **ES** on the switch. Open `/call/peluqueria-lola`.
2. Press **Llamar** and allow the microphone when Chrome asks.
3. Say: "Quiero cortarme el pelo mañana a las nueve de la noche." Pick a day when tomorrow is Tuesday to Saturday, or name such a day instead of "mañana".
4. When it offers other times, say: "Vale, a las siete y media."
5. Give a test name and a test phone when asked, one at a time.
6. When it reads the booking back, say: "Sí."
7. Run the two SQL queries above.

Expected:
- The greeting names Peluquería Lola, in a Spanish voice.
- 21:00 is refused and 19:30, 19:15 and 19:00 are offered.
- It asks for one thing per turn and reads back day, time and service before confirming.
- The last reply says what happens next (Lola will see the message), and the page shows the call as ended.
- The transcript shows every turn in order, your lines and the replies, matching what was said.
- The Message has outcome `booked`, your test name and phone, a reason, an urgency, what was agreed and a suggested reply, and `model_failed` is false. The Booking is `confirmed` on `chair-1` or `chair-2` at 19:30 Madrid time.

Result / date: ______________________

### 2. Full booking by voice in English, plus a mid-call language switch (task 12.2)

Steps:
1. Open `/call/peluqueria-lola`, press **EN**, then **Call**.
2. Book a beard trim for next Saturday at 11 in the morning, giving a test name and phone, and say "Yes" to the read-back.
3. Check the Message and Booking with the SQL queries.
4. Press **Call again**, press **ES** on the switch and start in Spanish ("Hola, quería pedir cita").
5. After the first reply, press **EN** on the switch and continue in English ("Actually, can we speak English?").
6. Finish the booking or hang up.

Expected:
- Steps 1–3: the same as check 1 in English, with an English voice, ending in a confirmed 11:00 booking on Saturday and a `booked` Message.
- Step 5: the switch shows EN, the next reply is in English with an English voice, and the microphone keeps listening (now in English) without pressing anything.
- Step 6: hanging up mid-call leaves an `abandoned` Message and no Booking.

Result / date: ______________________

### 3. Microphone denied (task 12.3)

Steps:
1. In Chrome's site settings for the page, set Microphone to **Block**. Reload.
2. Press **Llamar**.
3. Complete a booking by typing every line in the text field and pressing Send.
4. Reset the microphone permission to Ask. Press **Llamar** again, allow it, speak one line, then press **Prefiero escribir** and finish by typing.

Expected:
- Step 2: the Call starts anyway, the greeting appears in the transcript (and is spoken if a voice exists), and the text field is shown. No error screen.
- Step 3: the booking completes exactly as in check 1, with a `booked` Message.
- Step 4: the switch to typing happens in the same Call, the transcript keeps the earlier lines, and the booking completes.

Result / date: ______________________

### 4. 360 px viewport, keyboard and reduced motion (task 12.4)

Steps:
1. In DevTools device mode, set the width to 360 px and open `/call/peluqueria-lola`.
2. Scroll the page sideways and make a short call.
3. Close DevTools device mode and press Tab repeatedly from the top of the page.
4. In DevTools > Rendering, set "Emulate CSS prefers-reduced-motion" to `reduce` and make a short call.
5. Repeat steps 1–2 on a real Android phone in Chrome, on the deployed HTTPS URL.

Expected:
- Steps 1, 2 and 5: no horizontal scroll at any point of the call; the shop name, the Call button, the ES / EN switch and "type instead" are visible without zooming; the transcript text is readable.
- Step 3: every control (language switch, Call, type instead, text field, Send, Hang up) gets a visible gold focus ring, in a sensible order.
- Step 4: no fades or moving decoration; every line appears at once and stays fully visible.

Result / date: ______________________

### 5. Unknown shop (task 12.5)

Steps:
1. Open `/call/no-such-shop`.

Expected:
- The page says the shop was not found: the heading "Este número no existe", then "No encontramos esta tienda. Revisa el enlace que te han dado." and "Shop not found. Please check the link you were given."
- There is no Call button.

Result / date: ______________________
