---
inclusion: always
---

# Project structure

```
app/
  call/[shopId]/page.tsx      caller side: the "phone" in the browser
  machine/[shopId]/page.tsx   owner side: the answering machine
  api/turn/route.ts           one conversation turn: caller text -> receptionist reply
  api/messages/route.ts       list and mark messages
lib/
  booking/                    pure booking rules (hours, slots, services) - no I/O, fully tested
  receptionist/               prompt building, model call, zod schemas, fallbacks
  db/                         Drizzle schema and queries
components/
  machine/                    tape reels, red light, message list
  call/                       call button, live transcript
tests/                        unit and property-based tests mirroring lib/
```

## Conventions
- Business logic in `lib/` is pure and testable. Pages and routes stay thin.
- One component per file, PascalCase names. Utilities in camelCase.
- Every new rule in `lib/booking/` comes with a property-based test.
