# Phantom Line: the whole salon in one simple app (design)

Date: 23 Nov 2026. Author: Claude, from the conversation with Miguel (the owner of the project).
Deadline: the Kiroween submission closes on 4 Dec 2026 at 23:00 Madrid time.

## 1. Intent

Today Phantom Line is a voice receptionist plus an owner panel called the "answering machine". The
panel has three tabs (Tape, Agenda, Clients) and a 7-day view. Miguel wants it to become the one app
a hair salon, or any appointment business, runs on. Phantom Line should be both the hackathon entry
and the product his agency Nece-sites sells. He wants one project, not two.

The owner should have almost nothing to do. The receptionist answers, books and follows up by
itself. The owner opens the app at two moments:

1. **In the morning, to plan the day.** She needs a calendar that is "super visual and easy to read"
   (Miguel's words).
2. **At month end, or whenever she wants, for management and administration.**

Miguel's reaction to a first mock-up with 8 management blocks was "lo veo muy caos" (it looks
chaotic). Simplicity therefore comes before feature count. He also asked what happens to bookings
that do not come through the receptionist, so the app must hold every booking, not only the ones
the receptionist made.

Nece-sites already has a private salon app (`necesites/Plantillas/app-peluqueria`, from 25 Oct
2026, before the hackathon). It is the reference for what salons need: calendar per stylist, client
cards with colour formula and allergies, WhatsApp reminders "1 · Confirmo", reviews (4–5 stars go
to Google, 1–3 to the owner), waitlist that offers a freed slot, dormant clients and birthdays,
cash desk by payment method, and a monthly report with "what your system did for you this month".
**Its code is not copied** (see constraints). The ideas are rewritten here, inside the hackathon
period.

## 2. Goals for 4 December

The owner app has four tabs. Every label and term comes from the shop's sector pack (stylist,
mechanic, teacher…), so it works for all 9 packs.

### 2.1 Today (the morning screen)
- At the top, four big numbers: appointments today, free slots, expected takings today, new
  messages. The messages number opens the existing Tape.
- The day as a **booking book per worker**. Miguel chose layout A over a list: one column per
  worker, each appointment a coloured block (colour by service category) with the client's name,
  service and price. Free gaps are dashed. A red line marks the current time.
- A warning icon on an appointment whose client has an allergy or an important note.
- Day / week switch. Swipe or arrows to change the day.
- **A big + button, always visible:**
  - "New appointment" in three taps: time and worker (pre-filled from the gap tapped), service,
    client (search the existing clients or type a name and phone). It is marked as made by the
    owner (source `manual`), not by the receptionist.
  - "Block time" for a break, a doctor's visit or holidays, for one worker or the whole shop. The
    receptionist never offers a blocked slot.
- Tapping an appointment opens a sheet with: confirm, move, cancel, mark as no-show, **Cobrar**
  (take payment) and the client's card.

### 2.2 Clients
- Search, plus the current client cards: visits, spend, frequency, overdue list.
- New fields: important note / allergies, birthday, consent for promotions (yes/no, with date),
  and sector fields defined by the pack. For hair and beauty, the colour formula (free text per
  visit). For a car workshop, the car and plate. For psychology, nothing extra; the receptionist
  never asks the reason (pack rule).
- History of visits with what was paid.

### 2.3 My business (month end)
- At the top, three numbers that read in 5 seconds: taken, expenses, what is left. Each is compared
  with the previous month.
- A block "what your receptionist did this month": calls answered, appointments it booked, € of
  those appointments, hours of phone saved, gaps refilled. Only real, attributable figures.
- Takings by week (simple bars), by worker, top services, no-shows.
- **Expenses**: add in about 10 seconds (concept, amount, date, category). Fixed expenses (rent)
  repeat every month.
- **"For the accountant"**: download the month's takings and expenses as CSV, and as a printable
  page.

### 2.4 Settings, including "What your receptionist does by itself"
- Shop data: hours, holidays, services and prices, team, FAQ. These are already editable through
  the wizard; the data is reused.
- A list of **switches**, each with one line saying what it does:
  - reminder the day before;
  - ask for a review after the visit;
  - offer a freed slot to the waitlist;
  - win back dormant clients;
  - birthday greeting.
- Each switch produces messages in an **outbox**. In this version every message opens WhatsApp
  (`wa.me` link) with the text ready, and the owner sends it with one tap. There is no automatic
  sending: unofficial APIs risk a ban, as Meta already disabled Miguel's test business portfolio.
  The receptionist already answers by voice 24 h.
- Promotions (dormant clients, birthday) are only prepared for clients with consent, and carry
  "BAJA" to opt out. Reminders and reviews go to everyone (GDPR rules already written in Nece-sites'
  sales material).

### 2.5 Cash desk
- "Cobrar" on an appointment: amount (pre-filled with the price, editable), method (cash, card,
  Bizum, voucher), optional product sale line.
- The day's cash total by method appears on Today. Payments feed My business.

### 2.6 Demo data
`demo:reset` fills the demo shop with a realistic month: bookings from the receptionist and manual
ones, payments, expenses, clients with notes, some messages in the outbox. All of it is marked
"sample" on screen, as the current demo notice does. The video and the judges see a living
business, not empty screens.

## 3. Non-goals (this version)
- Legal invoices. In Spain they must come from certified software (VeriFactu); the app exports
  numbers for the accountant instead.
- Online payments, deposits, card terminals.
- Automatic WhatsApp or SMS sending, and a real phone number. These are the post-hackathon roadmap.
- Stock control, payroll, multi-location, client self-service portal.
- Restaurants and bakeries (tables and orders).

## 4. Anti-goals (a failure even if it works)
- A cluttered screen. Each tab has one job, and the first screen of each reads in 5 seconds.
- The owner having to type a lot. Defaults and pre-filled fields everywhere.
- Invented or inflated numbers. Every figure is computed from stored data, and samples are labelled.
- Any message to a client without consent where consent is required.
- Breaking the voice receptionist. Its conversation tests (property tests B1–B15, N-series) must stay
  green.

## 5. Constraints
- **Hackathon rules.** The project must be built during the submission period, with Kiro, and
  pre-existing work must be disclosed. Therefore:
  - no code from `app-peluqueria` is copied;
  - the submission text says the ideas come from Nece-sites' earlier salon app, rewritten during the
    hackathon;
  - Kiro credits are spent, so Claude implements, and the write-up says so honestly (as it already
    does). The work is still organised as a Kiro spec in `.kiro/specs/salon-system/`
    (requirements, design, tasks) so the spec-driven method stays visible.
- **The repo is public and AGPL-3.0.** Keys, client data and Nece-sites' private app stay out of it.
- **Stack stays as is**: Next.js 16 App Router, TypeScript strict, Tailwind 4, Drizzle on Neon
  (PGlite in tests), Vitest and fast-check. No new heavy dependency; charts in CSS/SVG.
- **Production database migrations need Miguel's OK in chat each time.** Deploys to Vercel are
  already approved.
- **Owner security**: everything stays behind the existing PIN session; every API checks the shop
  and the session; rate limits as today.
- **Time zone** Europe/Madrid everywhere; money in integer cents.
- **Look**: Phantom Line's own identity (warm cream, espresso, gold, retro answering machine), not
  Nece-sites' Marfil & Oro, because the product competes under its own name. Mobile first, and
  tablet on the salon counter.

## 6. Data the design needs (the builder decides the exact schema)
- Bookings: source (receptionist or manual), status (pending, confirmed, done, no_show, cancelled),
  link to client.
- Time blocks: worker or whole shop, start, end, reason.
- Payments: booking (optional), amount, method, product line, time.
- Expenses: concept, category, amount, date, recurring monthly.
- Clients: note/allergies, birthday, promotions consent with date, sector fields (JSON validated by
  the pack's field list).
- Automation settings per shop (switches), and outbox messages (kind, client, text, status
  prepared/sent/dismissed, created).
- The receptionist's booking engine must treat time blocks and manual bookings as busy.

## 7. Left to the builder
Component structure, exact layouts and spacing within the identity, the API shapes, migration
split, how the outbox is generated (on page load or by the existing cron), the property tests'
exact statements, and the order of the work. The order should ship the visible value first: Today,
then cash desk, then My business, then the switches and outbox.

## 8. After the hackathon (recorded, not in scope)
- Nece-sites sells Phantom Line. As the copyright holder Miguel can license it commercially despite
  the AGPL. `app-peluqueria` is then archived (only with his OK) so there is one product.
- Real phone line (call forwarding to a virtual number), official WhatsApp API owned by each
  client, stock.
- Copy protection: register the trademark at the OEPM, plus hidden fingerprints in the code with a
  weekly search for copies.

## 9. Calls made by Claude after the builder check (Miguel: check these)
1. **Booking states without a new enum.** Bookings keep the `confirmed`/`cancelled` status that the
   receptionist's engine and its tests rely on. The other states are derived:
   - *pending*: made by the receptionist and not yet confirmed by the owner (`ownerConfirmedAt` empty,
     as today);
   - *confirmed*: owner-confirmed, or made by the owner;
   - *done*: has a payment;
   - *no-show*: `noShowAt` set;
   - *to collect*: in the past with none of these.

   A new `source` column (`receptionist` | `manual`) is added. A manual booking is confirmed when
   created.
2. **Payments.** "Cobrar" records the payment and so marks the appointment done. A payment may have
   no booking (product sale only).
3. **Bookings and clients.**
   - Bookings get a nullable `client_id`, backfilled by shop and phone.
   - For manual bookings the phone is optional (a walk-in). Without a phone there is no client card
     and no reminder.
   - The receptionist's bookings still require a phone.
4. **Blocks and overlaps.**
   - Blocks are one-off: a start and an end, which may span several days for holidays. Weekly
     repeats are out of scope.
   - A block over existing bookings is allowed, after a warning that lists them.
   - A manual booking may not overlap another booking or a block. The same rule protects the
     receptionist, so the owner never double-books by accident.
   - The receptionist's free-slot search treats blocks as busy.
5. **Fixed expenses** are templates with a start month and an optional end month. A month's
   expenses are the one-off rows of that month plus the templates active that month. Changing a
   fixed amount ends the old template and starts a new one, so past months never change.
6. **Receptionist figures and their formulas.**
   - *Calls answered* = calls of the month.
   - *Appointments it booked* = bookings with source `receptionist` created that month and not
     cancelled.
   - *Their value* = the sum of those bookings' price snapshots.
   - *Phone time saved* = the sum of real call durations. This is the formula the panel already uses.
   - *Gaps refilled* = waitlist entries that ended in a booking. The figure is shown only when it is
     above zero.
7. **Consent.**
   - Promotion consent defaults to *no* and is set by the owner on the client card, with the date.
   - Promotion messages end with "Responde BAJA si no quieres más mensajes". The owner removes the
     consent by hand when someone answers BAJA.
   - Review requests need a Google review link, a new setting. The switch stays off until the link
     is set.
8. **The outbox is generated when the app is opened.**
   - It is idempotent: one reminder per booking, one review request per booking, one birthday
     greeting per client per year, and one win-back per client per lapse.
   - Turning a switch off dismisses the messages of that kind that were waiting.
9. **Sector fields.**
   - Packs get two optional fields: `visitNoteLabel` and `clientFields` (free-text fields only).
   - The visit note is per booking: "Fórmula del color" for hair, beauty and barber; "Trabajo
     realizado" for the car workshop. Psychology has no visit note.
   - Client fields: the car workshop gets "Coche y matrícula". The other packs have none for now.
10. **Workers are the shop's resources.**
    - A one-resource shop shows a one-column book.
    - The week view shows every worker merged, compact, and tapping a day opens the day view.
11. **Demo data.**
    - The new tables follow the existing demo pattern: a `curated` flag, the retention cron cleans up
      visitor rows, and `demo:reset` restores them.
    - The demo shop stays shared behind its public demo PIN.
    - The owner's write APIs have the same rate limits as today's owner actions.
12. **Money.**
    - Bookings store a price snapshot in cents, so later price edits never change past takings.
    - Payments store what was actually collected.
    - The accountant's CSV has the gross amount, plus base and VAT computed with a VAT rate setting
      (21 % by default), marked "IVA incluido, revisar con tu gestor".
