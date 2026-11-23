# Salon System (owner app) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the owner panel ("answering machine") into the one app a salon, or any appointment
business, runs on. It has four tabs (Today, Clients, My business, Settings), plus manual bookings
and time blocks, a cash desk, expenses, the month report and an outbox of WhatsApp messages.

**Architecture:**
- Pure rules go in `lib/salon/*`.
- Persistence goes in a new `createSalonRepository(handle)` (`lib/db/salonRepository.ts`), behind
  the `SalonRepository` port (`lib/salon/types.ts`).
- Use cases go in `lib/salon/handleSalon.ts`. They reuse `OwnerDeps` and `sessionFor` from
  `lib/owner/handleOwner.ts`.
- Thin routes go under `app/api/machine/[shopId]/…`, wired in `app/api/machine/handlers.ts`.
- The UI goes in `components/machine/*`.
- The receptionist's engine is untouched except for one change: busy intervals now include time
  blocks.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Tailwind 4, Drizzle (Neon in production,
PGlite in tests), Zod, Vitest with fast-check and jsdom, lucide-react.

**Spec:** `docs/superpowers/specs/2026-11-23-salon-system-design.md` (sections 1–9). Section 9 is
binding.

## Global Constraints
- Money is in integer cents. Time is `timestamptz`, and every day or month boundary is computed in
  the shop's `timeZone` (Europe/Madrid for the demo).
- Every new owner route:
  - checks the session with `sessionFor(token, shopId, pinSetAt, deps)` before reading anything
    personal;
  - for mutations, uses `checkOrigin`, requires the JSON content type and a body of at most 4096
    characters;
  - sends `Cache-Control: no-store`;
  - turns errors into 503 `unavailable` through `guarded`.
- Every new route is added to `tests/api/machine.nosession.property.test.ts`.
- Each new table has a `curated boolean NOT NULL DEFAULT false`, is cleaned by `applyDemoCutoffs`
  (demo shop, `curated=false`) and by `deleteExpired` (trials), and is truncated in
  `tests/db/pglite.ts` `reset()`.
- Labels come from the sector pack (`shop.vocabulary`, `resourceKind`). Copy lives in
  `machineCopy.ts`-style `Record<Lang, …>` files, with es and en.
- No new runtime dependency. Charts are plain CSS or SVG. Use the colour tokens from
  `app/globals.css`, check text contrast against `tests/design/contrast.test.ts`, and keep tap
  targets at least 44 px (`controlButton.ts`).
- Promotion messages (winback, birthday, gap) go only to clients with `promo_consent_at` set. They
  end with "Responde BAJA si no quieres más mensajes." (es) or "Reply STOP to opt out." (en).
- The receptionist's suites (`tests/conversation/**`, `tests/booking/**`) stay green after every
  task.
- One migration per task that needs one: `drizzle/0009_*`, `0010_*`… The count in
  `tests/db/ownerRepository.test.ts` goes up each time.
- Production migrations: never run them. Task 18 asks Miguel.

## Decisions taken while planning (refine spec §9 without changing it)
- **The "source" of a booking is a channel value.** The `bookings.channel` CHECK gains `'manual'`.
  `source = channel === 'manual' ? 'manual' : 'receptionist'`. No new column.
- **A walk-in without a phone** stores `customer_phone = ''`. `clientUpsert` already skips a phone
  that is not E.164, so no client row is made.
- **Gap offers.** There is no salon waitlist table. When a confirmed future booking within 72 h is
  cancelled, the outbox prepares a "hueco libre" message for up to 3 consenting clients. They are
  picked from the lapsed list first (`lapsedClients`), then by most visits. *Gaps refilled* counts
  the bookings created by a client within 72 h of a `gap` message marked `sent` to the same phone.
- **Owner audit.** `owner_actions_action_ck` gains `'book'` and `'pay'`.

## Review Focus
1. **Two people booking the same slot.** The owner adds a manual booking while the receptionist
   commits the same slot. The second one gets 409 `taken`, and the UI says the slot was just taken
   (Task 4 test `manual booking loses the race with a 409`).
2. **Blocked time.** A block that covers a whole day, or the whole shop, means the receptionist
   offers nothing inside it, on any resource (Task 3 property `no offered slot overlaps a block`).
3. **Month edges.** A payment at 00:30 local on 1 Dec belongs to December, and the DST change on
   25 Oct 2026 does not move a payment between months (Task 7 test `month buckets use shop local
   time`).
4. **Shop isolation.** A booking, payment, expense, block or outbox id from another shop answers 404
   and changes nothing (Tasks 4–8, `cross-shop id is not_found`; nosession property).
5. **Opening the app twice.** Two opens never duplicate an outbox message, and turning a switch off
   dismisses that kind's prepared messages (Task 8 tests `generation is idempotent` and
   `switch off dismisses`).

---

### Task 1: Schema 0009_salon

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `drizzle/0009_salon.sql` and its snapshot/journal (`drizzle-kit generate`, then a hand
  edit for the CHECK changes)
- Modify: `tests/db/pglite.ts`, `tests/db/ownerRepository.test.ts` (count 10, title
  "migrations 0000–0009")
- Test: `tests/db/salonSchema.test.ts`

**Produces:**
- Tables:
  - `time_blocks(id uuid pk default random, shop_id fk NN, resource_id text NULL (null = whole shop), starts_at, ends_at, reason text NN default '' CHECK len<=80, created_at, curated)`
    with CHECK ends>starts;
  - `payments(id, shop_id, booking_id uuid NULL fk bookings UNIQUE, amount_cents int NN CHECK>=0, product_cents int NN default 0 CHECK>=0, product_label text NN default '' CHECK len<=60, method text NN CHECK in (cash,card,bizum,voucher), paid_at tstz NN, created_at, curated)`;
  - `expenses(id, shop_id, concept text NN CHECK 1..80, category text NN CHECK in (rent,products,utilities,staff,other), amount_cents int NN CHECK>0, day date NULL, recurring bool NN default false, start_month text NULL, end_month text NULL, created_at, curated)`
    with CHECK `(recurring AND start_month ~ '^\d{4}-\d{2}$' AND day IS NULL) OR (NOT recurring AND day IS NOT NULL)`;
  - `shop_settings(shop_id text pk fk, automations jsonb NN default '{}', google_review_url text NULL, vat_rate_pct int NN default 21 CHECK 0..30, updated_at)`;
  - `outbox(id, shop_id, kind text NN CHECK in (reminder,review,gap,winback,birthday), dedupe_key text NN, client_id uuid NULL fk, booking_id uuid NULL fk, phone text NN CHECK E.164, language text NN (es|en), body text NN CHECK len<=700, status text NN default 'prepared' CHECK in (prepared,sent,dismissed), created_at, acted_at NULL, curated)`
    with UNIQUE(shop_id, dedupe_key).
- Columns:
  - `bookings`: `client_id uuid NULL fk clients ON DELETE SET NULL`, `price_cents int NULL CHECK>=0`, `visit_note text NN default '' CHECK len<=500`; channel CHECK adds `manual`.
  - `clients`: `birthday text NULL CHECK ~ '^\d{2}-\d{2}$'`, `promo_consent_at tstz NULL`, `fields jsonb NN default '{}'`.
  - `owner_actions` action CHECK adds `book`, `pay`.
- Backfill: `UPDATE bookings b SET client_id = c.id FROM clients c WHERE c.shop_id=b.shop_id AND c.phone=b.customer_phone`.
- Do not add the new tables to the machine_version trigger.

- [ ] **Step 1: Write failing tests** in `tests/db/salonSchema.test.ts`. Each one uses `createTestDb()`:
  - `migrations reach 0009`;
  - `payments reject a second payment for one booking` (23505);
  - `expenses reject a recurring row without start_month` (23514);
  - `bookings accept channel manual with empty phone`;
  - `outbox dedupe_key is unique per shop`;
  - `backfill links existing bookings to clients by phone`, inserting the booking and the client
    before running migration 0009. Use `migrate` up to 0008, then the rest.
- [ ] **Step 2: Run** `npx vitest run tests/db/salonSchema.test.ts`. It must fail.
- [ ] **Step 3: Implement** the schema and the migration. Also extend the `reset()` TRUNCATE list.
- [ ] **Step 4: Run** `npx vitest run tests/db`. It must pass. Then run the full suite: green.
- [ ] **Step 5: Commit** `feat(db): salon tables and booking columns (0009)`.

### Task 2: Sector pack fields

**Files:** Modify `lib/sectors/types.ts` (`SectorPack`, `SectorPackDataSchema`) and the 9 pack
files. Test: `tests/sectors/salonFields.test.ts`.

**Produces:**
- `SectorPack.visitNoteLabel?: Record<Lang,string>`.
- `SectorPack.clientFields?: readonly { id: string; label: Record<Lang,string>; maxLength: number }[]`.
- Values:
  - hair, beauty and barber: `visitNoteLabel` = "Fórmula del color / notas" (es), "Colour formula / notes" (en);
  - car workshop: "Trabajo realizado" / "Work done", and `clientFields` = `[{id:"car", label:"Coche y matrícula"/"Car and plate", maxLength:60}]`;
  - dental and physio: "Notas de la visita" / "Visit notes";
  - tutoring and driving: "Lo trabajado en clase" / "What we covered";
  - psychology: none.

- [ ] **Step 1:** Write the failing test `every pack's fields validate and ids are unique`, plus
  `psychology has no visit note and no client fields`.
- [ ] **Step 2: Run** it. It must fail.
- [ ] **Step 3:** Add the fields.
- [ ] **Step 4: Run** `npx vitest run tests/sectors`. It must pass.
- [ ] **Step 5:** Commit `feat(sectors): visit note label and client fields`.

### Task 3: Time blocks are busy for everyone

**Files:**
- Modify `lib/db/repository.ts` (`listBookings`) and `lib/owner/handleOwner.ts` (`handleSlots`
  uses the same busy list).
- Create `lib/salon/blocks.ts`.
- Test: `tests/salon/blocks.property.test.ts`, `tests/db/blocksBusy.test.ts`.

**Produces:**
`blocksAsBusy(blocks: TimeBlock[], resources: {id:string}[]): ExistingBooking[]`. Each block becomes
one entry per resource, or one for its own resource. Ids are `block:<uuid>:<resourceId>`.
`listBookings(shopId, from, to)` returns confirmed bookings plus overlapping blocks through
`blocksAsBusy`.

**Consumes:** `TimeBlock = { id; resourceId: string | null; start: Temporal.Instant; end: Temporal.Instant; reason: string }`. It is defined in `lib/salon/types.ts` (create the file here; Task 4 adds to it).

- [ ] **Step 1: Write failing tests:**
  - Property `no offered slot overlaps a block`: random blocks, including whole-shop and whole-day
    ones, and a random service. Every slot from `firstSlotsFrom` and `daySlots` is disjoint from
    every block on its resource.
  - DB test `listBookings includes a whole-shop block once per resource`.
- [ ] **Step 2: Run** them. They must fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run tests/salon tests/db tests/conversation tests/booking`. All
  green.
- [ ] **Step 5:** Commit `feat(salon): time blocks are busy time`.

### Task 4: Manual bookings and blocks (API)

**Files:**
- Create `lib/salon/types.ts` (additions), `lib/salon/api.ts` (zod), `lib/salon/handleSalon.ts`,
  `lib/db/salonRepository.ts`.
- Create routes `app/api/machine/[shopId]/bookings/route.ts` (POST) and
  `app/api/machine/[shopId]/blocks/route.ts` (GET, POST), plus
  `app/api/machine/[shopId]/blocks/[blockId]/route.ts` (DELETE).
- Modify `app/api/machine/handlers.ts` and `production.ts`.
- Test: `tests/api/salon.bookings.test.ts`.

**Produces:**
- `SalonRepository` (in `lib/salon/types.ts`) with:
  - `insertManualBooking(b: ManualBooking): Promise<{ok:true,id:string}|{ok:false,reason:'overlap'}>`
    — inserts the booking and the `book` audit row atomically; overlap maps from 23P01;
  - `listBlocks(shopId, from, to)`;
  - `insertBlock(b)`;
  - `deleteBlock(shopId, id): Promise<boolean>`.
- `ManualBooking = {shopId, resourceId, serviceId, start, end, name, phone: string /* E.164 or '' */, priceCents, actor:{session,label}}`.
- `SalonDeps = OwnerDeps & { salon: SalonRepository }`.
- Handlers:
  - `handleCreateBooking(deps, shopId, token, body)`: validates the service and resource against
    the profile, takes `end = start + durationMin`, and checks `checkBooking` against `listBookings`
    (blocks included). It answers 201 `{id}`, 409 `{error:'taken'}` or 422
    `{error:'closed'|'outside_hours'|'blocked'}`.
  - `handleListBlocks`, `handleCreateBlock` (answers `{block, overlapping: AgendaItem[]}`: the
    block is created and the response lists the bookings under it), and `handleDeleteBlock`.
- Zod: `ManualBookingSchema = strictObject({resourceId, serviceId, start: ISO instant, name: 1..60, phone: optional E.164 or Spanish 9 digits normalised to +34})`.
- Zod: `BlockSchema = strictObject({resourceId: string|null, start, end, reason: 0..80})`.
- The client upsert happens when the phone is E.164 (reuse `clientUpsert`). The new booking stores
  `client_id` and `price_cents` from the service.

- [ ] **Step 1: Write failing tests:**
  - `owner books a walk-in without phone`: 201, row has channel `manual`, phone `''`, client_id null;
  - `owner books with a phone and the client is created and linked`;
  - `manual booking loses the race with a 409`: insert a receptionist booking at the same slot
    first;
  - `manual booking inside a block is refused`: 422 `blocked`;
  - `block over bookings is created and lists them`;
  - `cross-shop id is not_found`;
  - `no session is 401`.
- [ ] **Step 2: Run** `npx vitest run tests/api/salon.bookings.test.ts`. It must fail.
- [ ] **Step 3: Implement**, following `handleBookingAction`'s structure.
- [ ] **Step 4: Run** the file, then `tests/api` and the nosession property. All green.
- [ ] **Step 5:** Commit `feat(salon): manual bookings and time blocks`.

### Task 5: Cash desk and visit notes (API)

**Files:**
- Routes `app/api/machine/[shopId]/bookings/[bookingId]/pay/route.ts` (POST) and
  `…/note/route.ts` (POST), and `app/api/machine/[shopId]/payments/route.ts` (POST, for a product
  sale only).
- Handlers in `handleSalon.ts`.
- Repository methods `insertPayment`, `setVisitNote`, `listPayments(shopId, from, to)`.
- Test: `tests/api/salon.payments.test.ts`.

**Produces:**
- `PaySchema = strictObject({amountCents: int 0..1_000_000, method: 'cash'|'card'|'bizum'|'voucher', productCents?: int, productLabel?: 0..60})`.
- `handlePay` refuses:
  - a cancelled booking: 409 `cancelled`;
  - a future booking more than 12 h ahead: 422 `not_yet`;
  - a second payment: 409 `already_paid`.

  It writes the `pay` audit row.
- `handleVisitNote` sets `visit_note` and answers 404 for a cross-shop booking.
- `AgendaItem` (from `lib/owner/poll.ts`) gains `paidCents: number|null`, `source: 'receptionist'|'manual'`, `visitNote: string`, `priceCents: number|null`, `state: 'pending'|'confirmed'|'done'|'no_show'|'to_collect'`.
  The state follows spec §9.1 and is computed in `lib/salon/state.ts`:
  `bookingState({status, ownerConfirmedAt, channel, noShowAt, paid, start, end, now})`.

- [ ] **Step 1: Write failing tests:**
  - in `tests/salon/state.test.ts`, one case per state;
  - `pay marks done and appears in poll`;
  - `second payment is 409 already_paid`;
  - `product sale without booking`;
  - `visit note round-trip and 500-char limit`;
  - `cross-shop is not_found`.
- [ ] **Step 2: Run** them. They must fail.
- [ ] **Step 3: Implement.** Extend the poll agenda query with a LEFT JOIN on `payments`.
- [ ] **Step 4: Run** `tests/api tests/salon tests/owner`. All green.
- [ ] **Step 5:** Commit `feat(salon): cash desk and visit notes`.

### Task 6: Richer client cards (API)

**Files:** Modify `lib/clients/api.ts` (`ClientActionSchema` adds kinds) and
`lib/db/ownerRepository.ts` (`setClientNote` becomes `updateClient`). Modify `lib/clients/book.ts`:
`ClientDto` gains `birthday`, `promoConsentAt`, `fields`, `spentCents`, and history items gain
`paidCents` and `visitNote`. Test: extend `tests/api/machine.clients.test.ts`.

**Produces:** `ClientActionSchema` adds:
- `{action:'birthday', birthday:'MM-DD'|null}`;
- `{action:'consent', consent:boolean}` (sets or clears `promo_consent_at` to now);
- `{action:'fields', fields: Record<string,string>}`, validated against the pack's `clientFields`
  (unknown id: 422; over maxLength: 422).

- [ ] **Step 1: Write failing tests:**
  - `consent on sets the date and off clears it`;
  - `birthday rejects 02-30`;
  - `fields reject an id the pack does not define`;
  - `spentCents sums payments of the client's bookings`.
- [ ] **Step 2: Run** them. They must fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `tests/api tests/clients`. All green.
- [ ] **Step 5:** Commit `feat(clients): birthday, consent, sector fields, spend`.

### Task 7: Month report, expenses and the accountant's export

**Files:**
- Create `lib/salon/month.ts` (pure).
- Routes `app/api/machine/[shopId]/month/route.ts` (GET `?month=YYYY-MM`),
  `…/expenses/route.ts` (GET, POST), `…/expenses/[expenseId]/route.ts` (DELETE, POST to end a
  recurring template), and `…/export/route.ts` (GET `?month=&format=csv`).
- Repository: `listExpenses(shopId, month)`, `insertExpense`, `endRecurring(shopId, id, lastMonth)`,
  `deleteExpense`.
- Test: `tests/salon/month.property.test.ts`, `tests/api/salon.month.test.ts`.

**Produces:**
- `monthReport(input: {month:string, tz:string, payments, expenses, bookings, calls, gapSends, prev?: MonthTotals}): MonthReport`:
  - `{takenCents, expensesCents, leftCents, deltaPct:{taken,expenses,left}|null}`;
  - `weeks: {label, takenCents}[]`;
  - `byWorker: {resourceId, takenCents}[]`;
  - `topServices: {serviceId, count, takenCents}[]` (top 5);
  - `noShows`;
  - `receptionist: {calls, booked, bookedValueCents, phoneSeconds, gapsRefilled}`.

  The formulas are exactly spec §9.6. `bookedValueCents` uses `price_cents`, or the catalogue price
  when that is null.
- `monthExpenses(rows, month)` expands the recurring templates (§9.5).
- `exportCsv(report, payments, expenses, vatPct, lang): string`:
  - header (es): `fecha;tipo;concepto;método;total;base;iva`;
  - `;` separator, comma decimals, UTF-8 BOM;
  - base = round(total / (1 + vat/100)), iva = total − base;
  - footer line "IVA incluido al {vat} %, revisar con tu gestor".

- [ ] **Step 1: Write failing tests:**
  - `month buckets use shop local time`: a payment at 2026-11-30T23:30Z is December in Madrid, and
    one on 2026-10-25 around the DST change stays in October;
  - property `left = taken − expenses for any rows`;
  - `editing a recurring amount keeps past months`;
  - `csv base + iva = total per row`;
  - `receptionist figures follow §9.6` (fixture with known counts);
  - API: `month and export need a session`, `cross-shop expense delete is not_found`.
- [ ] **Step 2: Run** them. They must fail.
- [ ] **Step 3: Implement.** The export route answers `text/csv; charset=utf-8` with
  `Content-Disposition: attachment; filename="phantom-line-{shopId}-{month}.csv"`.
- [ ] **Step 4: Run** `tests/salon tests/api`. All green.
- [ ] **Step 5:** Commit `feat(salon): month report, expenses, accountant export`.

### Task 8: Settings and outbox

**Files:**
- Create `lib/salon/outbox.ts` (pure) and `lib/salon/settings.ts`.
- Routes `app/api/machine/[shopId]/settings/route.ts` (GET, POST), `…/outbox/route.ts` (GET:
  generates, then lists) and `…/outbox/[id]/route.ts` (POST `{action:'sent'|'dismissed'}`).
- Repository: `getSettings`, `saveSettings`, `insertOutbox(rows) ON CONFLICT DO NOTHING`,
  `listOutbox`, `setOutboxStatus`, `dismissPrepared(shopId, kind)`.
- Test: `tests/salon/outbox.property.test.ts`, `tests/api/salon.outbox.test.ts`.

**Produces:**
- `Automations = {reminder:boolean, review:boolean, gap:boolean, winback:boolean, birthday:boolean}`.
  All are false by default.
- `SettingsSchema = strictObject({automations, googleReviewUrl: https URL ≤300 starting with https://g.page/ or https://search.google.com/ or https://www.google.com/ | null, vatRatePct: 0..30})`.
  `review: true` without a URL answers 422 `review_needs_link`.
- `planOutbox(input:{now, tz, shop, settings, bookings, clients, cancellations, existingKeys:Set<string>}): OutboxDraft[]`. Rules and dedupe keys:
  - reminder: confirmed bookings starting tomorrow (local) with an E.164 phone; key
    `reminder:<bookingId>`;
  - review: bookings paid in the last 48 h; key `review:<bookingId>`;
  - gap: cancellations of the last 24 h for a slot within 72 h, up to 3 consenting clients; key
    `gap:<bookingId>:<clientId>`;
  - winback: `lapsedClients` with consent; key `winback:<clientId>:<lastVisitDate>`;
  - birthday: consenting clients whose `birthday` is today (local); key
    `birthday:<clientId>:<year>`.
- Texts in `lib/salon/outboxCopy.ts`, es and en, in the client's language:
  - short, the shop name first;
  - the review text carries the Google URL;
  - promotion kinds end with the opt-out line.
- `whatsappUrl` is reused from `lib/clients/winback.ts`.
- `GET outbox` runs `planOutbox`, inserts with ON CONFLICT DO NOTHING, and lists the prepared
  messages first.
- `saveSettings` with a kind switched off calls `dismissPrepared` for that kind.

- [ ] **Step 1: Write failing tests:**
  - `generation is idempotent`: two GETs leave one row per key;
  - `switch off dismisses`;
  - `no promotion without consent`;
  - property `every draft has an E.164 phone and a body ≤700 chars ending with the opt-out line when promotional`;
  - `review needs link`;
  - `cross-shop outbox id is not_found`.
- [ ] **Step 2: Run** them. They must fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `tests/salon tests/api`. All green.
- [ ] **Step 5:** Commit `feat(salon): automations settings and outbox`.

### Task 9: Four tabs

**Files:** Modify `components/machine/ViewTabs.tsx`, `useStoredView.ts`, `MachineScreen.tsx` and
`machineCopy.ts`. Test: update `tests/components/machine/*` that pin tabs.

**Produces:**
- `MachineView = "today"|"clients"|"business"|"settings"|"tape"`. The tab bar shows four tabs:
  Hoy, Clientes, Mi negocio, Ajustes (en: Today, Clients, My business, Settings).
- `tape` is opened from Today's messages tile, and a "Volver" link returns to Today.
- `useStoredView` defaults to `today` and whitelists the five values.
- The old Agenda tab content moves into Today (Task 10).

- [ ] **Step 1:** Write failing tests: `four tabs in order`, `messages tile opens the tape and back returns`, `stored view survives reload`.
- [ ] **Step 2: Run** them. They must fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run tests/components`. All green.
- [ ] **Step 5:** Commit `feat(machine): four tabs`.

### Task 10: Today: the booking book

**Files:**
- Create `components/machine/today/TodayView.tsx`, `KpiRow.tsx`, `DayBook.tsx`, `WeekStrip.tsx`,
  `BookingSheet.tsx` and `todayCopy.ts`.
- Create `lib/salon/dayLayout.ts` (pure).
- Test: `tests/salon/dayLayout.property.test.ts`, `tests/components/machine/today.test.tsx`.

**Produces:**
- `dayLayout({date, tz, hours, resources, items, blocks, now}): {startMin, endMin, columns: {resourceId, entries: {kind:'booking'|'block'|'free', topPct, heightPct, item?}[]}[], nowPct: number|null}`.
  Free entries are the gaps of at least `slotStepMin` inside opening hours.
- KPIs: appointments today, free slots, expected takings today (price of non-cancelled bookings
  today), new messages (the `tapeCounts` new count).
- Below the book, a "Caja de hoy" strip with today's collected total by method (cash, card, Bizum,
  voucher). It comes from `GET /api/machine/[shopId]/payments?day=YYYY-MM-DD`, which Task 5 adds to
  its payments route (session-checked, shop-scoped). Test: `cash strip sums today's payments by
  method`.
- Colours by category: a fixed map of 6 tints over the tokens. Unknown categories rotate through
  them.
- The allergy icon (lucide `TriangleAlert`) shows when the linked client's note is not empty.
- `BookingSheet` actions:
  - existing: confirm, move (MoveDialog), cancel (CancelDialog), no-show;
  - new: Cobrar (PayDialog, Task 11) and the visit note;
  - client card link.
- Day navigation: arrows and swipe. `WeekStrip` shows 7 days with their counts; tapping a day
  selects it.

- [ ] **Step 1: Write failing tests:**
  - property `entries in a column never overlap and stay within 0–100 %`;
  - `now line only on today`;
  - component: `shows one column per resource with names from the pack`, `free gap opens the new
    booking dialog pre-filled`, `allergy icon on a client with a note`.
- [ ] **Step 2: Run** them. They must fail.
- [ ] **Step 3: Implement.** Data comes from the poll agenda (8 days) plus `GET blocks` for the
  window.
- [ ] **Step 4: Run** `tests/salon tests/components`. All green.
- [ ] **Step 5:** Commit `feat(machine): today booking book`.

### Task 11: The + button, the new-booking and block dialogs, and the pay dialog

**Files:**
- Create `components/machine/today/AddButton.tsx`, `NewBookingDialog.tsx`, `BlockDialog.tsx`,
  `PayDialog.tsx` and `components/machine/salonApi.ts` (fetch wrappers in the style of
  `bookingApi.ts`).
- Test: `tests/components/machine/addFlows.test.tsx`.

**Produces:**
- The new-booking dialog has three steps:
  1. time and worker, pre-filled;
  2. service (big buttons, with the price);
  3. client: a search over `getClients`, or a name with an optional phone.

  A 409 shows "Ese hueco se acaba de ocupar" and reloads.
- The block dialog has: worker or "Todo el local", from/to (whole-day quick picks), reason chips
  (Descanso, Médico, Vacaciones, Otro). It shows the overlapping bookings that come back.
- The pay dialog has: the amount pre-filled from the price, the method as 4 big buttons, and
  "Añadir producto" (optional label and amount).

- [ ] **Step 1: Write failing tests:**
  - `new booking in three taps posts the right body`;
  - `409 shows taken and refreshes`;
  - `block whole shop for a day`;
  - `pay with bizum marks done`.
- [ ] **Step 2: Run** them. They must fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `tests/components`. All green.
- [ ] **Step 5:** Commit `feat(machine): add booking, block time, take payment`.

### Task 12: Clients UI

**Files:** Modify `components/machine/ClientCard.tsx` and `ClientsView.tsx`. Test: extend
`tests/components/machine/clients*.test.tsx`.

**Produces:**
- The card shows:
  - the warning note at the top, highlighted;
  - birthday (day/month pickers);
  - consent switch with its date;
  - the pack's `clientFields`;
  - spend total;
  - visit history with paid amount and visit note (labelled with `visitNoteLabel`).
- There is a search box at the top of the list.

- [ ] **Step 1: Write failing tests:** `consent switch posts consent`, `car pack shows Coche y
  matrícula`, `psychology shows no visit note`, `search filters by name and phone`.
- [ ] **Step 2: Run** them. They must fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. All green.
- [ ] **Step 5:** Commit `feat(machine): richer client cards`.

### Task 13: My business UI

**Files:** Create `components/machine/business/BusinessView.tsx`, `MonthHeader.tsx`, `Bars.tsx`,
`ExpensesList.tsx`, `ExpenseDialog.tsx` and `businessCopy.ts`. The existing `WeekPanel` is replaced
by this view (remove it and its tests only once this view covers its figures). Test:
`tests/components/machine/business.test.tsx`.

**Produces:**
- Month picker (previous and next).
- Three big numbers with their change against last month (▲/▼, coloured).
- The "Lo que ha hecho tu recepcionista" block. Its `gapsRefilled` is hidden when it is 0.
- Takings by week as SVG bars. By worker and top services as simple ranked lists.
- Expenses list with "+ Gasto" (concept, amount, category chips, "Se repite cada mes").
- "Descargar para la gestoría" (link to the export route).
- Every figure has a `title` with its formula, like `savedFormula` today.

- [ ] **Step 1: Write failing tests:** `shows taken, expenses, left from the API`, `hides gaps
  refilled at zero`, `recurring expense posts recurring with start month`, `export link has month`.
- [ ] **Step 2: Run** them. They must fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. All green.
- [ ] **Step 5:** Commit `feat(machine): my business view`.

### Task 14: Settings UI and outbox

**Files:** Create `components/machine/settings/SettingsView.tsx`, `AutomationSwitches.tsx`,
`OutboxList.tsx` and `settingsCopy.ts`. Test: `tests/components/machine/settings.test.tsx`.

**Produces:**
- Switches, each with a one-line explanation.
- Google review link field, VAT %.
- "Mensajes listos para enviar": a count on the tab. Each message is a card with the client, kind,
  text and a "Enviar por WhatsApp" button that opens `whatsappUrl` in a new tab and then posts
  `sent`, plus "Descartar".
- A read-only summary of the shop data (hours, services, team), with a note that changes go through
  "Volver a nacer".

- [ ] **Step 1: Write failing tests:** `review switch disabled without link`, `send opens wa.me and
  marks sent`, `dismiss removes the card`.
- [ ] **Step 2: Run** them. They must fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. All green.
- [ ] **Step 5:** Commit `feat(machine): settings and outbox`.

### Task 15: Demo month and retention

**Files:** Modify `lib/demo/curated.ts` (`buildCuratedSet`), `lib/demo/reset.ts`,
`lib/db/ownerRepository.ts` (`applyDemoCutoffs`) and `lib/db/trialRepository.ts`
(`deleteExpired`). Tests: `tests/db/demoReset.test.ts`, `demoRetention.test.ts`,
`trialSweep.test.ts`.

**Produces:**
- The curated set adds, relative to `now`:
  - about 30 days of past bookings across both resources (about 70 % paid, 3 no-shows, both
    sources);
  - this month's expenses (rent recurring at 900 €, products, utilities);
  - 2 blocks;
  - clients with consent, birthdays (one today), notes and allergies;
  - settings with reminder and review on and a sample Google link;
  - prepared outbox rows.

  All of it is `curated=true`. Numbers must be plausible for a 2-chair salon (about 6–7 k € a
  month).
- Retention and trial sweep delete the new tables' rows (`curated=false` for the demo shop; all
  rows for expired trials) in FK order.

- [ ] **Step 1: Write failing tests:**
  - `reset rebuilds a month with payments and expenses`;
  - `retention deletes visitor payments, blocks and outbox but keeps curated`;
  - `trial sweep deletes new tables`.
- [ ] **Step 2: Run** them. They must fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `tests/db`. All green.
- [ ] **Step 5:** Commit `feat(demo): a living month for the demo shop`.

### Task 16: Kiro spec and docs

**Files:**
- Create `.kiro/specs/salon-system/{requirements.md,design.md,tasks.md}` (EARS-style requirements
  mirroring the spec, design summary, tasks mirroring this plan with checkboxes ticked as done).
- Modify `README.md`, `docs/submission.md`, `docs/submission-checklist.md`, `docs/video-script.md`
  and `docs/impact.md`. Add the honest disclosure: "ideas from Nece-sites' earlier private salon
  app (Oct 2026); no code reused; implemented by Claude during the submission period".

- [ ] **Step 1:** Write the files.
- [ ] **Step 2:** Run `npx vitest run tests/docs` if it exists. Otherwise run the full suite.
- [ ] **Step 3:** Commit `docs: salon system spec, submission and video`.

### Task 17: Whole-branch verification

- [ ] **Step 1:** Run the full suite, `npx tsc --noEmit`, `npm run lint` and `npm run build`. All
  green.
- [ ] **Step 2:** Run a local dev server against PGlite or a local DB (no production DB). Click
  through Today, new booking, block, pay, Clients, My business and Settings in the browser pane, at
  mobile 375 px and at desktop. Screenshot each.
- [ ] **Step 3:** Fix what this turns up (each fix with a test), then commit.

### Task 18: Production (with Miguel)

- [ ] **Step 1:** Ask Miguel in chat for OK to apply 0009 (and any later migrations) to production
  Neon. Wait.
- [ ] **Step 2:** After the OK: `node --env-file=.env.local scripts/migrate.mjs`, then
  `npm run demo:reset -- --allow-remote`.
- [ ] **Step 3:** Push, wait for CI to pass, then deploy (clean `git archive` copy, then
  `vercel deploy --prod --yes`).
- [ ] **Step 4:** Check live:
  - a receptionist booking still works (`/api/turn`);
  - the demo shop panel shows the month;
  - the `/nacer` trial shop works with empty new tables.
