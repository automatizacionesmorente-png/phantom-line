---
inclusion: fileMatch
fileMatchPattern: ["lib/sectors/**", "lib/booking/**", "lib/receptionist/**", "tests/**"]
---

# Sector packs

A sector pack is a plain typed config (`lib/sectors/<id>.ts`) that tells the same engine how a kind of business works. Adding a sector must never need new engine code. Every pack is validated with zod at startup, and every pack gets the same property-based tests.

## What a pack defines
- **unit**: what is booked. `appointment` (a person's time), `table` (seats for a time), or `order` (items for a pickup time).
- **resources**: what can be busy at the same time (chairs, therapists, tables by size, an oven's capacity per hour). Two bookings may overlap only if they use different resources.
- **catalog shape**: services with duration and price, menu items with price and preparation time, or table sizes.
- **required fields**: what the receptionist must collect before confirming, in the order it asks for them.
- **rules**: sector-specific checks, all pure functions (see below).
- **vocabulary**: how the receptionist and the owner screen name things in Spanish and English ("cita" / "reserva" / "encargo"), plus the urgent and today terms per language that the code uses to decide a message's urgency (the model only suggests it).
- **sensitive topics**: what the receptionist must never advise on, and must turn into a message for the owner instead.

## The first four packs

| Pack | Unit | Resources | Must collect | Sector rules | Never |
|---|---|---|---|---|---|
| **Hair salon** (Peluquería Lola) | appointment | chairs; some services need a specific stylist | service, day and time, name, phone | the service must fit before the session closes | promise a result ("te quedará rubio platino") |
| **Physio / small clinic** | appointment | therapists, rooms | reason (one line, no diagnosis), first visit or follow-up, day and time, name, phone | first visits last longer; urgent pain is flagged urgent for the owner, never triaged by the AI | any medical advice; storing anything beyond the one-line reason |
| **Restaurant** | table | tables by size | party size, day and time, name, phone, allergies (free text, passed on as-is) | party size must fit an available table; a booking takes a slot of fixed length; large groups go to the owner as a message | confirm a group larger than the biggest table |
| **Bakery / orders** | order | kitchen capacity per pickup hour | items and quantities, pickup day and time, name, phone | an order needs its preparation time before pickup; capacity per hour is never exceeded | invent an item or a price not in the catalog |

## Rules for writing packs
- The model proposes and the code decides: every rule above is code, never just a sentence in a prompt.
- A pack's text for the receptionist comes from the pack's vocabulary, so the hair salon never says "table".
- Every pack ships with a seed shop for the demo and with fixtures for the tests.
- Property tests run over all packs: no accepted booking ever breaks a pack rule, double-books a resource, or falls outside opening hours.
