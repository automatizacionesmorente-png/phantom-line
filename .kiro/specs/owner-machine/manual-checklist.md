# Manual checklist: Owner Machine (task 12)

The owner runs this against the **deployed app on Vercel, with the Neon database**. Kiro wrote it and does not run it: it never touches the real database. Write the result of every check on its "Result / date" line: **pass** or **fail**, the date, and for a fail what happened (the exact text shown, a screenshot name, or the log line helps most).

Use a test name and a test phone in every call, never a real customer's. The demo shop is public.

## Read this first: the demo PIN must have 6 digits

The requirements define the Owner_PIN as **6 digits** (glossary, and 2.6). The code follows that in three places:

- the seed (`seedOwnerPin` in `lib/db/seed.ts`) sets no PIN when `DEMO_OWNER_PIN` is not exactly 6 digits, and prints `DEMO_OWNER_PIN is not exactly 6 digits: the shop's machine PIN was not set`;
- the landing page shows the PIN only when it is exactly 6 digits (`app/page.tsx`);
- the PIN_Gate's field is labelled "PIN de 6 cifras" / "6-digit PIN".

A 4-digit PIN such as **1980 will not work**: the machine would say "Este contestador aún no está configurado" and the landing page would show no PIN. Before check 1, either pick a 6-digit `DEMO_OWNER_PIN` (for example one that still contains 1980), or change the requirement and the code first in a separate task. This checklist does not decide that for you.

## 1. Before the run (task 12.1, human steps)

Run from the repository root on your own machine. Node loads `.env.local` itself; the scripts never print its values. Point `DATABASE_URL` in `.env.local` at the **Neon production database** only for steps 1 and 3, and only if that is the database Vercel uses.

1. **Migrations.** `node --env-file=.env.local scripts/migrate.mjs`. This applies every migration not yet applied. The owner-machine migrations are `drizzle/0003_owner_machine.sql` and `drizzle/0004_machine_triggers.sql` (tasks.md says "0002 and 0003": natural-voice took 0002 first, see design.md "As built in task 8"). If `0002_voice_cache.sql` is not on Neon yet, it is applied too. Expected output: `migrations applied in N ms`.
2. **Vercel environment variables** (Project → Settings → Environment Variables, Production): `OWNER_SESSION_SECRET` (at least 32 random characters; shorter makes login answer `503`), `DEMO_OWNER_PIN` (6 digits, see above), `CRON_SECRET` (random). `PIN_LIMIT_PER_VISITOR_PER_15MIN` and `PIN_LIMIT_PER_SHOP_PER_HOUR` may stay unset to use the defaults (5 and 30). Then **redeploy**: the landing page reads `DEMO_OWNER_PIN` at build time, and Vercel captures `CRON_SECRET` at build time of the production deployment.
3. **Seed.** Put the same 6-digit PIN in `.env.local` as `DEMO_OWNER_PIN`, then `npm run db:seed`. Expected output: `shop "peluqueria-lola" updated (already existed)` (or `created`) and `machine PIN set from DEMO_OWNER_PIN`, or `machine PIN unchanged` on a second run. The PIN and its hash are never printed.
4. **Cron job.** In the Vercel dashboard (Project → Settings → Cron Jobs) one job is listed: `/api/cron/demo-retention`, schedule `0 4 * * *` (once a day, 04:00 UTC; Hobby runs it any time within that hour).

Results:
- Migrations: ______________________
- Vercel variables set and redeployed: ______________________
- Seed output: ______________________
- Cron job listed: ______________________

## 2. Chrome desktop (task 12.2)

Open two windows side by side: window A for the machine, window B for the call. Open DevTools in window A (Network tab, filter `api/machine`).

Steps and expected results:

1. Open `/`. **Expected:** the "Try the demo: Peluquería Lola" card shows "Call Peluquería Lola →", "Open the answering machine", "Owner PIN:" with the 6 digits, and "Demo: do not leave real personal data".
   Result / date: ______________________
2. Press "Open the answering machine". **Expected:** the PIN_Gate shows the shop name, "Demo: no dejes datos personales reales", a PIN field, an optional name field and "Abrir el contestador", and nothing else: no counter, no light, no message. Type a wrong PIN once: "Ese PIN no abre este contestador." Type the right PIN and a name (for example "Mike"). **Expected:** the machine opens: the ivory body with the two reels, the light, the counter ("Tienes N mensajes nuevos" or "No tienes mensajes nuevos"), the "Cinta" and "Agenda" tabs.
   Result / date: ______________________
3. In window B open `/call/peluqueria-lola` and make a full booking (by voice or typed) for a day in the next 7 days. Note the time of the last reply. Watch window A without touching it. **Expected:** within about 5 seconds of the call ending (one Poll, plus the round trip), the light starts blinking, the counter goes up by one, the Caveat note "llamaron mientras atendías…" is shown, and the new Message is first on the Tape with the "Sin escuchar" mark. In "Agenda", the Booking is on its day at the booked time. Write down the seconds you measured.
   Result / date / seconds: ______________________
4. Back on "Cinta", press **Escuchar**. **Expected:** the reels turn while the Transcript appears line by line, then stop; the lines match the call; "Sin escuchar" goes away and the light stops blinking when nothing unplayed is left.
   Result / date: ______________________
5. Press **Siguiente** (moves to the next Message or says "Fin de la cinta."), **Copiar respuesta** (paste somewhere: it is the suggested reply), and **Borrar** on one Message. **Expected:** the erased Message leaves the Tape at once and does not come back after a reload.
   Result / date: ______________________
6. In "Agenda", on the new Booking: **Confirmar**, then **Mover** to another free time in the dialog, then **Cancelar** ("Sí, cancelar"). **Expected:** after each, the row shows its new state and who did it ("Confirmada por Mike", "Movida por Mike", "Cancelada por Mike"); the moved row sits on its new day and time; the Tape's "Acordado" line for that Message follows the Booking as it is now.
   Result / date: ______________________
7. Idle Poll: leave window A visible and do not touch the page (no mouse over it, no keys) for 15 minutes. **Expected:** in the Network tab, `GET /api/machine/peluqueria-lola?since=…` every 5 s at first, then every 30 s after 15 minutes. Then press one key on the page. **Expected:** a Poll is sent at once, and the 5 s rhythm returns. Switch to another tab for a minute: no Polls while hidden.
   Result / date: ______________________

## 3. Android phone, Chrome (task 12.3)

On the deployed HTTPS URL. If possible, also check at 360 px in DevTools device mode first.

1. Open `/`, then the machine, log in with the PIN.
2. On the same phone (or a second one) make one booking call on `/call/peluqueria-lola`.

**Expected:** no horizontal scroll on the landing page, the call page or the machine, in both tabs and with a dialog open; every control (tabs, Escuchar, Siguiente, Borrar, Copiar respuesta, Confirmar, Mover, Cancelar, the time buttons in the move dialog) is easy to hit with a thumb; the Demo_Notice is visible without scrolling on the call page (before pressing "Llamar") and on the machine.

Result / date: ______________________

## 4. Keyboard only (task 12.4)

Chrome desktop, no mouse. Start on the PIN_Gate.

1. Tab: PIN field → name field → "Abrir el contestador". Log in with Enter.
2. On the machine, Tab: language switch → "Bloquear" → the tab list (one stop; ArrowRight / ArrowLeft switch between "Cinta" and "Agenda") → Escuchar → the tape cards. After Escuchar, Siguiente, Borrar and Copiar respuesta are reachable too.
3. In "Agenda", reach a row's Mover with Tab and press Enter. In the dialog, choose a time with the keyboard, then press **Escape**. Do the same with Cancelar, and Escape.

**Expected:** every control can be reached and used; the gold focus ring is visible on every one of them; focus never lands on something invisible; the move and cancel dialogs take focus when they open, keep it inside while open, close with Escape, and focus returns to the Mover or Cancelar button that opened them. (These dialog checks are manual because jsdom 29 has no `showModal()`; see design.md.)

Result / date: ______________________

## 5. VoiceOver (task 12.5)

macOS Safari (Cmd+F5) or iOS Safari. Machine labels in English (press EN), with at least one Spanish Message on the Tape.

1. Leave VoiceOver on the machine and make a booking call from another device.
2. Play the new Message and read the Transcript with VoiceOver.
3. Read a tape card.

**Expected:** when the call arrives, VoiceOver announces the count once, in the form "1 new message, 1 not played yet" (it does not repeat it on Polls that change nothing); the counter is read as text; the played Transcript is read in full; the urgency badge and the channel ("Call") are read as words, not as colours or icons; the Spanish reason, reply and Transcript are read with a Spanish voice although the labels are English.

Result / date: ______________________

## 6. Reduced motion (task 12.6)

Turn on the OS setting (macOS: System Settings → Accessibility → Display → Reduce motion; Android: Remove animations), reload the machine with at least one unplayed Message, and press Escuchar.

**Expected:** the light is on and steady (no blink, no flicker), the reels do not turn, the whole Transcript appears at once, and new Messages appear without the fade.

Result / date: ______________________

## 7. Lighthouse accessibility, at least 95 (task 12.7)

Chrome DevTools → Lighthouse, mode Navigation, device **Mobile**, category Accessibility only, on `/machine/peluqueria-lola`.

1. Logged out (the PIN_Gate).
2. Logged in (the machine), with **"Clear storage" unchecked** so the session cookie stays.

**Expected:** both scores 95 or more. Write both down, and any failing audit by name.

- PIN_Gate score: ______
- Machine score: ______
- Result / date: ______________________

## 8. Demo_Retention on the real demo and Neon usage (task 12.8)

1. Erase Messages until fewer than 3 are left, then reload the machine. **Expected:** the 3 sample Messages are on the Tape, each marked "Ejemplo" ("Sample" with EN labels), with no duplicates.
   Result / date: ______________________
2. Vercel → the project → Logs, filter `demo_retention`. **Expected:** lines like `{"event":"demo_retention","step":…,"outcome":"ok","counts":{…}}` after a login and after the daily cron run, with counts only: no name, phone, reason, transcript or PIN.
   Result / date: ______________________
3. Neon usage: note the project's compute usage (Neon console, the project's usage / billing page) at the start of a day, leave one machine tab visible all day, and note it again 24 hours later.
   **Compare with:** Neon Free allows 100 CU-hours per project per month and scales to zero only after 5 idle minutes (task 1.6, read 2026-11-15). The design's estimate is about 6 CU-hours for a visible tab open 24 hours at 0.25 CU, which would use up the month in about 16–17 days; the daily cron adds about 0.6 CU-hours a month. If the measured day is close to 6 CU-hours, decide between the two options in design.md ("Neon compute and the Idle Poll"): pause polling after a long Idle, or keep the Poll and watch usage.
   - CU-hours at start: ______  24 h later: ______  used in one day: ______
   - Result / date: ______________________

## After the run

Each section maps to one sub-task of task 12 in `tasks.md` (section 1 is 12.1, section 8 is 12.8). Tick a sub-task only when every "Result / date" line of its section says **pass**; tick task 12 when 12.1–12.8 are all ticked. For a fail, open a fix task with the line's text, and run the section again after the fix.
