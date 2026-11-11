---
inclusion: always
---

# Product: Phantom Line

Phantom Line resurrects the 1980s telephone answering machine as the complete AI front desk of a small local business. It is not one more voice bot: every channel a customer uses (a call, a WhatsApp message, a web chat) ends up as a message on the same "tape" and in the same agenda, and the owner runs the whole front desk from one answering-machine screen.

## Problem
Small businesses (hair salons, bakeries, repair shops, small clinics) miss calls every day because the owner is busy serving the customer in front of them. A missed call is usually a lost booking or order, and they cannot afford a receptionist.

## Users
- **Caller:** a customer who calls the shop. Often older and not tech-savvy, so the experience must work by voice alone.
- **Owner:** runs the shop alone or with one or two people. Checks messages between customers, often on a phone.

## The system (what makes it more than a voice agent)
- **One brain, many channels.** The same conversation core serves browser voice, WhatsApp (Meta Cloud API) and web chat. Channels are thin adapters.
- **A real agenda.** Bookings and orders are created, rescheduled and cancelled by customers on any channel and by the owner on the machine. No double bookings. The code decides, never the model.
- **Sector packs.** A plain typed config describes a sector: what a resource is (chair, therapist, table, oven slot), what a booking or order needs, sector rules. Hair salon, physio clinic, restaurant and bakery ship first. A new sector needs no code.
- **The owner's machine.** The tape of messages, today's agenda, and one-tap actions: confirm, move, cancel, reply on WhatsApp with the suggested text.

## What it does (first channel: voice)
1. When nobody picks up, Phantom Line answers by voice in Spanish or English. The caller picks the language with a visible ES / EN switch that defaults to the browser language (speech recognition cannot detect it reliably). A caller who cannot or will not use the microphone can type instead: nobody is ever locked out.
2. It answers questions from the shop's own information only (hours, services, prices, address) and takes bookings or orders inside opening hours.
3. It leaves the owner a "message on the tape": caller name, reason, urgency, what was agreed, and a suggested reply.
4. The owner sees an answering-machine screen: a blinking red light, "You have N new messages", and a tape that plays each call back as a transcript.

## Principles
- Never invent information about the shop. If the answer is not in the shop profile, say so and take a message.
- Never confirm a booking outside opening hours or for a service the shop does not offer.
- Keep calls short and kind. Callers are busy or unsure.
- Owners must understand a message in under 10 seconds.
- Collect only what the booking needs (name, phone, reason, time).

## Halloween theme
"The voices of customers nobody answered come back from the dead." The look is a haunted vintage answering machine in ivory bakelite with gold trim (see `design.md`): tape reels, a flickering red light, faint tape hiss and ghostly fades. Spooky by detail, never by darkness. The theme must never get in the way of usability: high contrast, readable text, works on mobile.

## Success for the demo
A live call in the browser books an appointment, and seconds later the owner's machine blinks with the new message.
