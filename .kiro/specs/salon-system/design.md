# Design Document

Follows `docs/superpowers/specs/2026-11-23-salon-system-design.md` and the plan `docs/superpowers/plans/2026-11-23-salon-system.md`. This file is the short version; the plan has the file-level detail.

## Overview

The owner machine keeps its PIN session, polling and audited actions. It gains four tabs and the data behind them. The receptionist (`handleTurn`, `lib/booking`) is not rewritten: it only learns that Time_Blocks and manual bookings are busy time.

## Data (migration `0009_salon`, one migration)

- New tables: `time_blocks`, `payments`, `expenses`, `shop_settings`, `outbox`. Each has `curated boolean NOT NULL DEFAULT false`, a shop foreign key, and is cleaned for the demo shop and for trials.
- `bookings`: new nullable `client_id` (backfilled by shop and phone), `price_cents`, `visit_note`; the `channel` check gains `manual`.
- `clients`: new `birthday`, `promo_consent_at`, `fields` (JSON validated by the sector pack).
- `owner_actions`: the action check gains `book` and `pay`. `voice_cache` shop foreign key changed so deleting a shop does not fail.

## Decisions

1. **Booking states are derived, no new enum.** pending = receptionist-made and not owner-confirmed; confirmed = owner-confirmed or manual; done = has a payment; no-show = `noShowAt` set; to collect = past with none of these. The receptionist's `confirmed`/`cancelled` status and its tests stay as they are.
2. **Source is the channel.** `source = channel === 'manual' ? 'manual' : 'receptionist'`.
3. **Two writers, one slot.** Manual bookings go through the same Postgres exclusion constraint as the receptionist's; the loser gets 409 `taken`.
4. **Time in shop time zone.** Day and month boundaries use the shop's IANA zone; money is integer cents.
5. **Attributable figures only.** "What your receptionist did" counts only what stored data proves. Gaps refilled = bookings created by a client within 72 h of a `gap` message marked `sent` to the same phone.
6. **Outbox is idempotent.** A pure planner (`lib/salon/outbox.ts`) turns the data into drafts, each with a dedupe key that is unique per shop, so running it again when the app is opened writes nothing new; switching a kind off dismisses its prepared messages; stale bookings are dropped at list time; promotions need Promo_Consent and carry the opt-out line.
7. **No automatic sending.** Each message is a `wa.me` link the owner taps. Unofficial APIs risk a ban and the official API is post-hackathon.

## API (all under `/api/machine/[shopId]`, behind the session)

`bookings`, `bookings/[id]` (move, confirm, cancel, no-show), `bookings/[id]/slots`, `bookings/[id]/pay`, `bookings/[id]/note`, `blocks`, `blocks/[id]`, `payments`, `clients`, `clients/[id]`, `month`, `expenses`, `expenses/[id]`, `export` (CSV and printable), `settings`, `outbox`, `outbox/[id]`, `week`, plus the existing session, messages and poll routes. Every route follows the Global Constraints of the plan (session first, origin and JSON checks on writes, 4096-character body, `no-store`, errors as 503 through `guarded`) and is in the no-session property test.

## UI

Four tabs from one shell. Today is the booking book with one column per worker, the "+" button and three sheets (new booking, block time, pay). Clients adds search, notes, birthday, consent and sector fields. My business has three headline numbers, the receptionist block, CSS/SVG bars, expenses and the accountant export. Settings has the shop summary, the automation switches and the Outbox. Copy lives in `Record<Lang, ...>` files with es and en; colours come from `app/globals.css` and are checked by the contrast test; tap targets are at least 44 px.

## Correctness properties and review focus

1. No offered slot overlaps a Time_Block (property, any resource).
2. Manual booking loses a race with 409.
3. Month buckets use shop local time, including 1 Dec 00:30 and the 25 Oct 2026 DST change.
4. A cross-shop id answers 404 and changes nothing; no new route answers without a session.
5. Outbox generation is idempotent, and a switch off dismisses prepared messages.
6. The receptionist's conversation and booking suites stay green.

## Not built (stated, not promised)

Legal invoices or VeriFactu, automatic WhatsApp or SMS, a real phone number, online payments, stock, payroll, multi-location, a client portal, restaurants and bakeries.
