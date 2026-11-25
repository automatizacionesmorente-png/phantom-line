# Requirements Document

## Introduction

The **salon system** turns the owner's side of Phantom Line (until now the answering machine with a Tape, an Agenda and Clients) into the one app a hair salon, or any appointment business, runs on. It is the sixth spec. Source documents: `docs/superpowers/specs/2026-11-23-salon-system-design.md` (the design brief) and `docs/superpowers/plans/2026-11-23-salon-system.md` (the plan).

The owner opens the app at two moments: in the morning to plan the day, and at month end for management. Simplicity comes before feature count: four tabs, each with one job whose first screen reads in 5 seconds.

### Who wrote this part, and where the ideas come from

- **Kiro credits ran out on 17 Nov 2026.** This spec is organised the Kiro way (requirements, design, tasks) so the spec-driven method stays visible, but **Claude (Anthropic's coding assistant) implemented it**, under the owner's direction. It is not Kiro's work.
- **Disclosure of pre-existing ideas.** The ideas (calendar per stylist, client cards with allergies and colour formula, reminders, reviews, dormant clients and birthdays, cash desk by payment method, a monthly report) come from the earlier **private salon app of the Nece-sites team** (the agency of the founder), which dates from 25 Oct 2026, before the hackathon. **No code was copied from it.** Everything here was rewritten during the submission period, in this repository.
- The month shown in the public demo is **sample data**, labelled as such on screen.

## Glossary

- **Owner_App**: the owner's screen at `/machine/[shopId]`, behind the existing PIN session.
- **Booking_Book**: the day view with one column per Worker and a coloured block per booking.
- **Time_Block**: a period (break, visit, holiday) for one Worker or the whole shop in which nothing can be booked.
- **Manual_Booking**: a booking made by the owner, channel `manual`, confirmed when created.
- **Cash_Desk**: the "Cobrar" flow that records a payment against a booking, or a product sale alone.
- **Outbox**: the list of prepared messages that the owner sends with one tap through a `wa.me` link.
- **Promo_Consent**: `promo_consent_at` on a client; required for promotional messages.
- **Sample_Data**: demo records labelled "sample" on screen.

## Requirements

### Requirement 1: Four tabs, one job each

**User Story:** As an owner, I want few screens, so that the app does not look chaotic.

1. THE Owner_App SHALL show four tabs: Today, Clients, My business and Settings.
2. THE Owner_App SHALL take every label and term (worker, service, client) from the shop's sector pack, so that all 9 packs work.
3. THE Owner_App SHALL keep the existing Tape reachable from the new-messages number on Today.
4. THE Owner_App SHALL be mobile first and usable on a tablet at the counter.

### Requirement 2: Today, the morning screen

1. THE Owner_App SHALL show four numbers at the top of Today: appointments today, free slots, expected takings today and new messages.
2. THE Booking_Book SHALL show one column per Worker, one coloured block per booking (colour by service category) with client name, service and price, dashed free gaps and a line at the current time.
3. WHEN a client has an allergy or an important note, THE Booking_Book SHALL show a warning icon on that booking.
4. THE Owner_App SHALL offer a day and week switch, and swipe or arrows to change the day.
5. WHILE the owner is on Today, THE Owner_App SHALL show a big "+" button.
6. WHEN the owner taps a booking, THE Owner_App SHALL open a sheet with confirm, move, cancel, no-show, Cobrar and the client's card.

### Requirement 3: Manual bookings and blocked time

1. WHEN the owner creates a booking from "+", THE Owner_App SHALL ask only for time and worker (pre-filled from the tapped gap), service and client (search, or type name and phone), and SHALL store channel `manual`.
2. WHEN a booking is created by the owner, THE system SHALL confirm it at creation.
3. WHEN the owner blocks time for one Worker or the whole shop, THE receptionist SHALL never offer a slot inside the Time_Block, on any resource.
4. THE receptionist's booking engine SHALL treat Time_Blocks and Manual_Bookings as busy.
5. IF the owner and the receptionist commit the same slot, THEN the second writer SHALL receive 409 `taken` and the Owner_App SHALL say the slot was just taken.
6. WHERE a walk-in gives no phone, THE system SHALL store an empty phone and SHALL NOT create a client row.

### Requirement 4: Cash desk

1. WHEN the owner chooses Cobrar on a booking, THE Cash_Desk SHALL ask for the amount (pre-filled with the price, editable), the method (cash, card, Bizum, voucher) and an optional product line.
2. WHEN a payment is recorded, THE system SHALL mark the booking done.
3. THE Cash_Desk SHALL allow a payment with no booking (product sale only).
4. THE Owner_App SHALL show the day's cash total by method on Today.
5. THE system SHALL keep a visit note per booking, with the sector's label.
6. Money SHALL be stored in integer cents.

### Requirement 5: Clients

1. THE Owner_App SHALL offer client search, and the existing cards with visits, spend, frequency and the overdue list.
2. THE system SHALL store per client: important note or allergies, birthday, Promo_Consent with its date, and the sector fields defined by the pack (validated against the pack's field list).
3. WHEN the sector is psychology, THE receptionist SHALL still never ask for the reason of the visit.
4. THE Owner_App SHALL show the history of visits with what was paid.

### Requirement 6: My business (month end)

1. THE Owner_App SHALL show three numbers at the top: taken, expenses and what is left, each compared with the previous month.
2. THE Owner_App SHALL show "what your receptionist did this month": calls answered, appointments it booked, the euros of those appointments, hours of phone saved and gaps refilled. IF a figure cannot be attributed from stored data, THEN THE Owner_App SHALL NOT show it.
3. THE Owner_App SHALL show takings by week (CSS or SVG bars), by worker, top services and no-shows.
4. THE Owner_App SHALL let the owner add an expense (concept, amount, date, category) in about 10 seconds, and SHALL repeat fixed expenses every month.
5. THE Owner_App SHALL offer "For the accountant": the month's takings and expenses as a CSV and as a printable page.
6. THE system SHALL compute every month and day boundary in the shop's time zone, so that a payment at 00:30 local on 1 December belongs to December and the DST change does not move a payment between months.

### Requirement 7: Settings and what the receptionist does by itself

1. THE Owner_App SHALL show the shop data already editable through the wizard (hours, holidays, services and prices, team, FAQ), reusing that data.
2. THE Owner_App SHALL show one switch per automation with a one-line explanation: reminder the day before, review request after the visit, offer a freed slot, win back dormant clients, birthday greeting.
3. WHEN a switch is on, THE system SHALL prepare messages in the Outbox; opening the app twice SHALL NOT duplicate a message.
4. WHEN a switch is turned off, THE system SHALL dismiss that kind's prepared messages.
5. WHEN the owner taps a prepared message, THE Owner_App SHALL open WhatsApp through a `wa.me` link with the text ready; the owner sends it with one tap.
6. WHEN a confirmed future booking within 72 hours is cancelled, THE Outbox SHALL prepare a free-slot message for up to 3 clients with Promo_Consent, lapsed clients first.
7. THE system SHALL prepare promotional messages (win-back, birthday, free slot) only for clients with Promo_Consent, and SHALL end them with "Responde BAJA si no quieres más mensajes." (es) or "Reply STOP to opt out." (en).
8. THE system SHALL NOT prepare an outbox message for a booking that is no longer valid when the list is read.

### Requirement 8: Demo month

1. WHEN `demo:reset` runs, THE system SHALL fill the demo shop with a realistic month: receptionist and manual bookings, payments, expenses, clients with notes and some Outbox messages.
2. THE Owner_App SHALL label all of it as sample, as the current demo notice does.
3. THE system SHALL clean each new table for the demo shop (`curated=false`) in `applyDemoCutoffs` and for trial shops in `deleteExpired`.

### Requirement 9: Security

1. THE system SHALL check the PIN session before reading anything personal on every new owner route.
2. WHERE a route mutates, THE system SHALL check the origin, require the JSON content type, and limit the body to 4096 characters.
3. THE system SHALL send `Cache-Control: no-store` and turn errors into 503 `unavailable`.
4. IF an id of another shop is used, THEN THE system SHALL answer 404 and change nothing.
5. THE new routes SHALL be listed in `tests/api/machine.nosession.property.test.ts`, so none answers without a session.
6. THE system SHALL record owner actions `book` and `pay` in the audit table.

### Requirement 10: Constraints and non-goals

1. THE system SHALL add no new runtime dependency; charts SHALL be plain CSS or SVG.
2. THE system SHALL keep the receptionist's suites (`tests/conversation/**`, `tests/booking/**`) green after every task.
3. THE system SHALL NOT issue legal invoices (in Spain they must come from certified software, VeriFactu); it exports numbers for the accountant instead.
4. THE system SHALL NOT send WhatsApp or SMS automatically in this version: every message is a one-tap `wa.me` link.
5. THE system SHALL NOT include a real phone line in this version.
6. Out of scope as well: online payments, deposits, card terminals, stock, payroll, multi-location, a client self-service portal, and restaurants and bakeries.
7. THE production database SHALL NOT be migrated without the owner's OK in chat each time.
8. THE Owner_App SHALL use Phantom Line's own identity (warm cream, espresso, gold), not the Nece-sites brand.
