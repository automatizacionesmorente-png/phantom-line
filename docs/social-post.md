# Social post

## X (under 280 characters)

Small shops miss calls while they work. Phantom Line is a haunted 1980s answering machine that answers by voice in Spanish or English, books inside opening hours, and blinks for the owner. Built spec-first with Kiro.

Try it: https://phantom-line-nine.vercel.app
Code: https://github.com/automatizacionesmorente-png/phantom-line
#KiroweenHackathon26

## LinkedIn

The voices of customers nobody answered come back from the dead.

Small salons and bakeries miss calls every day because the owner is busy with the customer in front of them. For Kiroween I built Phantom Line: an ivory and gold 1980s answering machine that works as an AI front desk.

- It answers by voice in Spanish or English, from the shop's own hours, services and prices.
- It books appointments. The model proposes and the code decides: hours, time zone and free chairs are checked in TypeScript, and Postgres blocks double bookings.
- The owner's machine blinks with the new message, plays the call back and shows the booking in the agenda.

I built it with Kiro: 5 specs reviewed before any code, steering files, a builder agent that cannot push or read secrets, hooks, and 64 property-based test files. To prove the tests work, Kiro broke the code on purpose and the properties caught it (every case is logged in NOTAS-KIRO.md). When the contest credits ran out on 17 Nov, Claude helped me finish the last polish.

Try the demo (Peluquería Lola, Madrid): https://phantom-line-nine.vercel.app
Code, specs and steering: https://github.com/automatizacionesmorente-png/phantom-line

#KiroweenHackathon26
