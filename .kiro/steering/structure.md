---
inclusion: always
---

# Project structure

```
app/
  call/[shopId]/page.tsx      caller side: the "phone" in the browser
  machine/[shopId]/page.tsx   owner side: the answering machine (static shell + MachineGate in <Suspense>)
  api/turn/route.ts           voice channel adapter: one conversation turn, caller text -> receptionist reply
  api/machine/[shopId]/...    owner adapter: PIN session, the Poll, play/erase a message,
                              confirm/move/cancel a booking, move slots (logic in api/machine/handlers.ts)
  api/cron/demo-retention/    daily demo-shop retention, guarded by CRON_SECRET
lib/
  conversation/               the channel-agnostic core: handleTurn (the one function every channel calls),
                              pure decideTurn, field re-derivation, caller matching, rate-limit decisions, owner message
  booking/                    pure booking rules (hours, slots, resources, services) - no I/O, fully tested
  sectors/                    sector packs: one plain typed config per kind of business, zod-validated, plus the registry
  receptionist/               prompt building, model call, zod schemas, spoken phrases, fallbacks
  voice/                      browser side of the voice channel: pure call-loop reducer and the speech port
                              (Web Speech, typed-only, and a fake for tests)
  messages/                   pure: code-decided urgency, tape order and counts, agreed text, current reply
  owner/                      the owner side: pure PIN, session, limits, agenda, moves, poll and tape reducers,
                              demo retention rules; handleOwner and demoRetention reach I/O only through ports
  db/                         Drizzle schema, queries (repository and owner repository), seed
drizzle/                      generated migrations plus custom SQL migrations (e.g. the no-overlap constraint, triggers)
components/
  machine/                    tape reels, red light, counter, tape and agenda views, dialogs, PIN gate
  call/                       call button, language switch, live transcript, typed input
tests/                        unit and property-based tests mirroring lib/; DOM tests in tests/components/
```

## Conventions
- Business logic in `lib/` is pure and testable. Pages and routes stay thin. Code that does I/O receives its dependencies (repository, model client, clock) as parameters.
- Channel adapters (voice now, WhatsApp and web chat later) only identify the sender, validate their payload, load the shop and call `lib/conversation`. They never contain booking logic.
- One component per file, PascalCase names. Utilities in camelCase.
- Every new rule in `lib/booking/` comes with a property-based test.
